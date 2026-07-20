import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS, THEME_ASSET_FILES } from "../../services/themeContract.js";
import { ensureThemeMd, readThemeMd, updateIntentSection, updateAppliedSection } from "../../services/themeMemory.js";
import { classifyChatMessage, editThemeFiles, ChatHistoryItem } from "../../services/themeChat.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");
const HISTORY_LIMIT = 3;
const KNOWN_FILES = new Set([...THEME_FILE_CONTRACTS.map((c) => c.file), ...THEME_ASSET_FILES.map((a) => a.file)]);

const chatSchema = z.object({
  message: z.string().min(1),
  agentId: z.string().min(1),
});

function sseWrite(reply: import("fastify").FastifyReply, event: Record<string, unknown>): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Chat editor AI cho theme da tao (chi CustomTheme agent-generated, giong dieu kien cua "Sua tung
// file" trong themeCustomize.ts) — kien truc 2 lan goi AI + streaming tien trinh qua 1 request
// duy nhat (khong can job/polling, xem thao luan thiet ke: classify -> [edit] -> cap nhat THEME.md).
export async function registerThemeChatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/chat/history",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const customTheme = await prisma.customTheme.findUnique({ where: { slug: request.params.slug } });
      if (!customTheme) {
        return reply.code(404).send({ error: "Không tìm thấy theme" });
      }
      const messages = await prisma.themeChatMessage.findMany({
        where: { slug: request.params.slug },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      const themeMd = await ensureThemeMd(request.params.slug);
      return { messages, themeMd };
    },
  );

  app.post<{ Params: { slug: string } }>("/admin/api/themes/:slug/chat", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const { slug } = request.params;
    const { message, agentId } = parsed.data;

    const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
    if (!customTheme) {
      return reply.code(404).send({ error: "Chỉ chat sửa được theme do AI tạo" });
    }
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return reply.code(404).send({ error: "Không tìm thấy agent" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      await prisma.themeChatMessage.create({ data: { slug, role: "user", content: message } });

      const recentRows = await prisma.themeChatMessage.findMany({
        where: { slug },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT + 1, // +1 vi ban ghi user vua tao cung nam trong nay, bo no khi build history
        skip: 1,
      });
      const history: ChatHistoryItem[] = recentRows
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const themeMd = await ensureThemeMd(slug);

      sseWrite(reply, { step: "classify", label: "Đang phân tích yêu cầu..." });
      const classified = await classifyChatMessage(agent, themeMd, history, message);

      if (classified.intentUpdate) {
        await updateIntentSection(slug, classified.intentUpdate);
        sseWrite(reply, { step: "intent_updated", label: "Đã ghi nhận định hướng thiết kế mới" });
      }

      if (classified.mode === "chat") {
        await prisma.themeChatMessage.create({ data: { slug, role: "assistant", content: classified.reply } });
        sseWrite(reply, { step: "done", mode: "chat", reply: classified.reply });
        reply.raw.end();
        return;
      }

      const validFiles = classified.files.filter((f) => KNOWN_FILES.has(f));
      if (!validFiles.length) {
        const fallback = "Xin lỗi, tôi chưa xác định được cần sửa file nào — bạn nói rõ hơn giúp tôi nhé.";
        await prisma.themeChatMessage.create({ data: { slug, role: "assistant", content: fallback } });
        sseWrite(reply, { step: "done", mode: "chat", reply: fallback });
        reply.raw.end();
        return;
      }

      sseWrite(reply, { step: "files", label: `Sẽ sửa: ${validFiles.join(", ")}`, files: validFiles });

      const fileContents: Record<string, string> = {};
      for (const file of validFiles) {
        const filePath = path.join(THEMES_ROOT, slug, file);
        const content = await fs.readFile(filePath, "utf-8").catch(() => null);
        if (content !== null) fileContents[file] = content;
      }

      sseWrite(reply, { step: "editing", label: "AI đang sửa file..." });
      const editResult = await editThemeFiles(agent, themeMd, history, message, fileContents);

      for (const result of editResult.files) {
        if (result.ok && result.content !== undefined) {
          await fs.writeFile(path.join(THEMES_ROOT, slug, result.file), result.content, "utf-8");
        }
        sseWrite(reply, { step: "validating", file: result.file, ok: result.ok, errors: result.errors });
      }

      if (editResult.memoryUpdate) {
        await updateAppliedSection(slug, editResult.memoryUpdate);
      }

      const okFiles = editResult.files.filter((r) => r.ok).map((r) => r.file);
      const failedFiles = editResult.files.filter((r) => !r.ok);
      const summaryParts = [classified.reply];
      if (okFiles.length) summaryParts.push(`Đã sửa xong: ${okFiles.join(", ")}.`);
      if (failedFiles.length) {
        summaryParts.push(
          `Không sửa được: ${failedFiles.map((f) => `${f.file} (${f.errors.join("; ")})`).join("; ")} — giữ nguyên bản cũ.`,
        );
      }
      const summary = summaryParts.join(" ");

      await prisma.themeChatMessage.create({ data: { slug, role: "assistant", content: summary } });
      sseWrite(reply, { step: "done", mode: "edit", reply: summary, files: editResult.files });
      reply.raw.end();
    } catch (err) {
      sseWrite(reply, { step: "error", label: (err as Error).message });
      reply.raw.end();
    }
  });
}
