import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS, THEME_ASSET_FILES, THEME_BUNDLE_OUTPUTS, pageGroupKey } from "../../services/themeContract.js";
import { ensureThemeMd, readThemeMd, updateIntentSection, updateAppliedSection, buildEditThemeMemory } from "../../services/themeMemory.js";
import { classifyChatMessage, editThemeFiles, ChatHistoryItem, EditFileResult } from "../../services/themeChat.js";
import { rebuildThemeAssets } from "../../services/themeAssetBundler.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");
const HISTORY_LIMIT = 3;
// Classify duoc tu chon BAT KY file nao trong 54 file (18 .liquid + 18 css + 18 js rieng tung
// trang) - khong con bat buoc theo cap, AI tu quyet dinh dung file can dong den.
const SELECTABLE_FILES = new Set([...THEME_FILE_CONTRACTS.map((c) => c.file), ...THEME_ASSET_FILES.map((a) => a.file)]);
// Xem file (GET /file, chi de hien thi) duoc phep xem them ca 2 file build output (read-only -
// khong the chon sua truc tiep qua chat).
const VIEWABLE_FILES = new Set([...SELECTABLE_FILES, ...THEME_BUNDLE_OUTPUTS]);

const chatSchema = z.object({
  message: z.string().min(1),
  // URL TUYET DOI (frontend tu ghep window.location.origin + Media.url sau khi upload qua
  // /admin/api/media) - AI goi qua API se tu tai anh, can truy cap duoc tu ben ngoai.
  imageUrl: z.string().url().optional(),
});

function sseWrite(reply: import("fastify").FastifyReply, event: Record<string, unknown>): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

const HEARTBEAT_INTERVAL_MS = 15000;

// Nhieu nhom file chay TUAN TU (moi nhom 1 lan goi AI rieng) co the khien tong thoi gian 1 luot
// chat keo dai tren 1 phut - trong luc DOI 1 lan goi AI don le, khong co byte nao duoc gui ra, de
// bi proxy phia truoc (Nginx, mac dinh proxy_read_timeout 60s neu khong cau hinh rieng) tuong ket
// noi "chet" ma tu ngat. Gui 1 dong comment SSE (bat dau bang ":") moi 15s trong luc cho - khong
// anh huong logic client (EventSource/reader bo qua dong comment) nhung giu byte lien tuc chay qua
// proxy, tranh bi ngat giua chung.
async function withHeartbeat<T>(reply: import("fastify").FastifyReply, task: Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_INTERVAL_MS);
  try {
    return await task;
  } finally {
    clearInterval(timer);
  }
}

// Chat editor AI cho theme da tao (chi CustomTheme agent-generated, giong dieu kien cua "Sua tung
// file" trong themeCustomize.ts) — kien truc 2 lan goi AI + streaming tien trinh qua 1 request
// duy nhat (khong can job/polling, xem thao luan thiet ke: classify -> [edit] -> cap nhat THEME.md).
export async function registerThemeChatRoutes(app: FastifyInstance): Promise<void> {
  // Noi dung 1 file that tren dia - dung cho o giua trang editor rieng (khong phai qua chat, chi
  // xem/tham khao). Chi cho phep file nam trong hop dong/asset list (KNOWN_FILES) - tranh path
  // traversal doc file bat ky ngoai thu muc theme.
  app.get<{ Params: { slug: string }; Querystring: { file?: string } }>(
    "/admin/api/themes/:slug/file",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const file = request.query.file;
      if (!file || !VIEWABLE_FILES.has(file)) {
        return reply.code(400).send({ error: "Tên file không hợp lệ" });
      }
      const content = await fs.readFile(path.join(THEMES_ROOT, request.params.slug, file), "utf-8").catch(() => null);
      if (content === null) {
        return reply.code(404).send({ error: "Không tìm thấy file" });
      }
      return { file, content };
    },
  );

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
    const { message, imageUrl } = parsed.data;

    const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
    if (!customTheme) {
      return reply.code(404).send({ error: "Chỉ chat sửa được theme do AI tạo" });
    }
    const agent = await prisma.agent.findFirst({ where: { purpose: "design", isActive: true } });
    if (!agent) {
      return reply.code(422).send({ error: "Chưa có Agent nào bật với mục đích 'Tuỳ chỉnh giao diện' — vào Quản trị → AI Agent kiểm tra lại." });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      await prisma.themeChatMessage.create({ data: { slug, role: "user", content: message, imageUrl } });

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
      const classified = await withHeartbeat(reply, classifyChatMessage(agent, themeMd, history, message, imageUrl));

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

      const validFiles = classified.files.filter((f) => SELECTABLE_FILES.has(f));
      if (!validFiles.length) {
        const fallback = "Xin lỗi, tôi chưa xác định được cần sửa file nào — bạn nói rõ hơn giúp tôi nhé.";
        await prisma.themeChatMessage.create({ data: { slug, role: "assistant", content: fallback } });
        sseWrite(reply, { step: "done", mode: "chat", reply: fallback });
        reply.raw.end();
        return;
      }

      // Reply cua lan goi 1 (classify) chi hien TAM THOI tren frontend (bao "da hieu yeu cau, dang
      // lam") - KHONG luu vao lich su chat, vi tin tom tat that su (SUMMARY cua nhom cuoi, hoac ban
      // du phong o duoi) moi la tin dai dien chinh thuc cho luot chat nay.
      sseWrite(reply, { step: "reply", reply: classified.reply });

      // Nhom cac file AI chon lai theo TUNG TRANG (vd cart.liquid + assets/sources/cart.css cung
      // 1 nhom "cart") - moi nhom la 1 LAN GOI AI RIENG, chay TUAN TU (khong song song): sau moi
      // nhom, cap nhat ngay THEME.md ("Da ap dung") roi doc lai truoc khi sang nhom tiep theo, de
      // nhom sau biet nhom truoc vua doi gi (tranh MEMORY_UPDATE cua nhom sau ghi de mat thong tin
      // nhom truoc).
      const groups = new Map<string, string[]>();
      for (const file of validFiles) {
        const key = pageGroupKey(file);
        const list = groups.get(key) ?? [];
        list.push(file);
        groups.set(key, list);
      }
      const groupEntries = [...groups.entries()];
      sseWrite(reply, { step: "files", label: `Sẽ sửa: ${validFiles.join(", ")}`, files: validFiles, groups: groupEntries.length });
      // Danh sach buoc (theo dung thu tu se chay TUAN TU) de frontend biet truoc TOAN BO ke hoach -
      // frontend tu quyet dinh hien timeline (>=3 buoc) hay 1 dong trang thai ghi de (<3 buoc).
      sseWrite(reply, { step: "plan", tasks: groupEntries.map(([groupKey]) => groupKey) });

      const allResults: EditFileResult[] = [];
      const changeNotes: string[] = [];
      let assetsChanged = false;
      let currentThemeMd = themeMd;
      let aiSummary: string | null = null;

      for (let i = 0; i < groupEntries.length; i++) {
        const [groupKey, groupFiles] = groupEntries[i];
        const isLastGroup = i === groupEntries.length - 1;
        sseWrite(reply, { step: "group_start", group: groupKey, index: i, total: groupEntries.length, label: `AI đang sửa "${groupKey}"...` });

        try {
          const fileContents: Record<string, string> = {};
          for (const file of groupFiles) {
            const filePath = path.join(THEMES_ROOT, slug, file);
            const content = await fs.readFile(filePath, "utf-8").catch(() => "");
            fileContents[file] = content; // rong neu file nguon CSS/JS chua tung duoc tao - van hop le
          }

          const groupResult = await withHeartbeat(
            reply,
            editThemeFiles(agent, buildEditThemeMemory(currentThemeMd), message, classified.reply, fileContents, isLastGroup, changeNotes, imageUrl),
          );

          for (const result of groupResult.files) {
            allResults.push(result);
            if (result.skipped) continue;
            if (result.ok && result.content !== undefined) {
              const filePath = path.join(THEMES_ROOT, slug, result.file);
              await fs.mkdir(path.dirname(filePath), { recursive: true }); // assets/sources/ co the chua ton tai
              await fs.writeFile(filePath, result.content, "utf-8");
              if (result.file.startsWith("assets/sources/")) assetsChanged = true;
            }
            sseWrite(reply, { step: "validating", file: result.file, ok: result.ok, errors: result.errors });
          }

          if (groupResult.changeNote) changeNotes.push(groupResult.changeNote);
          if (isLastGroup && groupResult.summary) aiSummary = groupResult.summary;

          if (groupResult.memoryUpdate) {
            await updateAppliedSection(slug, groupResult.memoryUpdate);
            currentThemeMd = await readThemeMd(slug);
          }

          const groupFailed = groupResult.files.some((r) => !r.ok);
          sseWrite(reply, { step: "group_done", group: groupKey, index: i, ok: !groupFailed });
        } catch (groupErr) {
          // 1 nhom loi (vd API mang) KHONG duoc lam mat tien trinh cac nhom da xong truoc do - ghi
          // nhan loi cho dung nhom nay, cac nhom con lai (neu co) van tiep tuc chay binh thuong.
          for (const file of groupFiles) {
            allResults.push({ file, ok: false, errors: [(groupErr as Error).message] });
          }
          sseWrite(reply, { step: "validating", file: groupKey, ok: false, errors: [(groupErr as Error).message] });
          sseWrite(reply, { step: "group_done", group: groupKey, index: i, ok: false });
        }
      }

      if (assetsChanged) {
        sseWrite(reply, { step: "bundling", label: "Đang gộp lại CSS/JS..." });
        await rebuildThemeAssets(slug);
      }

      const okFiles = allResults.filter((r) => r.ok && !r.skipped).map((r) => r.file);
      const failedFiles = allResults.filter((r) => !r.ok);

      // AI tu tong hop (SUMMARY cua nhom cuoi) la uu tien - chi dung khi THUC SU co (nhom cuoi
      // khong loi va AI khong quen viet). Neu khong, ve ban tom tat co hoc lam luoi an toan, luon
      // co ket qua du xay ra gi.
      let summary = aiSummary;
      if (!summary) {
        const summaryParts = [];
        if (okFiles.length) summaryParts.push(`Đã sửa xong: ${okFiles.join(", ")}.`);
        if (failedFiles.length) {
          summaryParts.push(
            `Không sửa được: ${failedFiles.map((f) => `${f.file} (${f.errors.join("; ")})`).join("; ")} — giữ nguyên bản cũ.`,
          );
        }
        if (!okFiles.length && !failedFiles.length) {
          summaryParts.push("Kiểm tra kỹ nhưng thấy các file liên quan chưa cần đổi gì.");
        }
        summary = summaryParts.join(" ");
      } else if (failedFiles.length) {
        // Van giu bao loi ky thuat rieng ngay ca khi da co SUMMARY tu AI (SUMMARY co the khong
        // biet het cac nhom khac bi loi do than no cung la 1 nhom co the bi loi).
        summary += ` (Không sửa được: ${failedFiles.map((f) => f.file).join(", ")} — giữ nguyên bản cũ.)`;
      }

      await prisma.themeChatMessage.create({ data: { slug, role: "assistant", content: summary } });
      sseWrite(reply, { step: "done", mode: "edit", reply: summary, files: allResults });
      reply.raw.end();
    } catch (err) {
      sseWrite(reply, { step: "error", label: (err as Error).message });
      reply.raw.end();
    }
  });
}
