import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Agent } from "@prisma/client";
import { prisma } from "../../db.js";

export const themeTestEmitter = new EventEmitter();
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_BUNDLE_OUTPUTS, getSelectableFiles, getViewableFiles } from "../../services/themeContract.js";
import { readThemeMd, updateAppliedSection } from "../../services/themeMemory.js";
import { validateThemeFile } from "../../services/themeValidator.js";
import { 
  ChatHistoryItem, 
  buildAgentSystemPrompt, 
  buildAgentUserPrompt, 
  parseAgentResponse,
  applyReplacements,
  retryUntilValid,
  callAiAgent
} from "../../services/themeChat.js";
import { rebuildThemeAssets } from "../../services/themeAssetBundler.js";
import { resolveDesignSystem, formatDesignSystem } from "../../services/uiuxSearch.js";
import { callTestAgent, callReviewAgent } from "../../services/themeTester.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");
const HISTORY_LIMIT = 5;
const MAX_AGENT_STEPS = 15;
const HEARTBEAT_INTERVAL_MS = 15000;

const chatSchema = z.object({
  message: z.string().min(1),
  imageUrl: z.string().url().optional(),
});

function sseWrite(reply: import("fastify").FastifyReply, event: Record<string, unknown>): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

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

async function runAgentLoop(
  reply: import("fastify").FastifyReply,
  slug: string,
  agent: Agent,
  message: string,
  history: ChatHistoryItem[],
  imageUrl?: string
): Promise<string> {
  let themeMd = await readThemeMd(slug);
  let contextFiles: Record<string, string> = {};
  let observations: string[] = [];
  let completedSubtasks: string[] = [];
  let assetsChanged = false;
  let finalReply = "";
  
  const systemPrompt = await buildAgentSystemPrompt(slug);

  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    sseWrite(reply, { step: "thinking", label: `Agent đang suy nghĩ (Bước ${step}/${MAX_AGENT_STEPS})...` });
    
    const userPrompt = buildAgentUserPrompt(themeMd, message, history, contextFiles, observations, completedSubtasks, Boolean(imageUrl));
    const rawResponse = await withHeartbeat(reply, callAiAgent(agent, systemPrompt, userPrompt, imageUrl));
    
    const actions = parseAgentResponse(rawResponse);
    if (actions.length === 0) {
      finalReply = "Tôi đang gặp khó khăn trong việc xử lý yêu cầu này (Không gọi được Tool nào). Bạn có thể mô tả rõ hơn không?";
      break;
    }

    let shouldBreak = false;
    let stepObservations: string[] = [];
    let justFinishedSubtask = false;

    for (const action of actions) {
      switch (action.type) {
        case "FINISH_SUBTASK": {
          sseWrite(reply, { step: "tool", label: `Đã xong chặng: ${action.payload.summary}` });
          completedSubtasks.push(`ĐÃ XONG: ${action.payload.summary}`);
          contextFiles = {};
          observations = [];
          stepObservations = []; 
          stepObservations.push(`Đã dọn dẹp bộ nhớ. VIỆC TIẾP THEO CẦN LÀM NGAY: ${action.payload.nextTask}`);
          justFinishedSubtask = true;
          break;
        }
        case "LIST_FILES": {
          sseWrite(reply, { step: "tool", label: `Đang lấy danh sách file...` });
          const SELECTABLE_FILES = await getSelectableFiles(slug);
          stepObservations.push(`LIST_FILES:\n${Array.from(SELECTABLE_FILES).join("\n")}`);
          break;
        }
        case "READ_FILES": {
          sseWrite(reply, { step: "tool", label: `Đang đọc file: ${action.payload.files.join(", ")}` });
          const SELECTABLE_FILES = await getSelectableFiles(slug);
          for (const file of action.payload.files) {
            if (file.includes("..") || !/\.(liquid|css|js)$/.test(file)) {
              stepObservations.push(`READ_FILES: Lỗi bảo mật, file "${file}" không hợp lệ (chỉ cho phép .liquid, .js, .css và không chứa '..').`);
              continue;
            }
            if (!SELECTABLE_FILES.has(file) && !file.startsWith("addons/")) {
              stepObservations.push(`READ_FILES: Lỗi, file "${file}" không tồn tại hoặc không được phép đọc.`);
              continue;
            }
            const isAddon = file.startsWith("addons/");
            const filePath = isAddon ? path.join(process.cwd(), "src", file) : path.join(THEMES_ROOT, slug, file);
            const content = await fs.readFile(filePath, "utf-8").catch(() => "");
            contextFiles[file] = content;
            stepObservations.push(`READ_FILES: Đã nạp thành công file "${file}" vào ngữ cảnh.`);
          }
          break;
        }
        case "SEARCH_CODE": {
          sseWrite(reply, { step: "tool", label: `Đang tìm kiếm: ${action.payload.query}` });
          const query = action.payload.query.toLowerCase();
          const matchedFiles: string[] = [];
          const SELECTABLE_FILES = await getSelectableFiles(slug);
          for (const f of SELECTABLE_FILES) {
            try {
              const content = await fs.readFile(path.join(THEMES_ROOT, slug, f), "utf-8");
              if (content.toLowerCase().includes(query)) {
                matchedFiles.push(f);
              }
            } catch (err) {}
          }
          stepObservations.push(`SEARCH_CODE [${query}]: Tìm thấy trong các file: ${matchedFiles.join(", ")}`);
          break;
        }
        case "REPLACE_CODE": {
          const file = action.payload.file;
          sseWrite(reply, { step: "tool", label: `Đang sửa file: ${file}` });
          
          if (file.includes("..") || !/\.(liquid|css|js)$/.test(file)) {
            stepObservations.push(`REPLACE_CODE: Lỗi bảo mật, file "${file}" không hợp lệ.`);
            continue;
          }

          if (!contextFiles[file]) {
            stepObservations.push(`REPLACE_CODE: Lỗi, bạn phải READ_FILES file "${file}" trước khi có thể sửa nó.`);
            continue;
          }

          const { success, newContent, errors } = applyReplacements(contextFiles[file], action.payload.blocks);
          if (!success) {
            stepObservations.push(`REPLACE_CODE cho "${file}" THẤT BẠI: ${errors.join("; ")}`);
            continue;
          }

          const validation = await validateThemeFile(slug, file, newContent);
          if (!validation.ok) {
            sseWrite(reply, { step: "tool", label: `Validation lỗi ở ${file}, đang cho AI tự sửa lại...` });
            const retryResult = await withHeartbeat(reply, retryUntilValid(slug, agent, file, newContent, validation.errors));
            if (!retryResult.ok) {
              stepObservations.push(`REPLACE_CODE cho "${file}" LỖI VALIDATION NGHIÊM TRỌNG: ${retryResult.errors.join("; ")}. Cập nhật BỊ HỦY BỎ.`);
              continue;
            }
            contextFiles[file] = retryResult.content!;
          } else {
            contextFiles[file] = newContent;
          }

          const isAddon = file.startsWith("addons/");
          const filePath = isAddon ? path.join(process.cwd(), "src", file) : path.join(THEMES_ROOT, slug, file);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, contextFiles[file], "utf-8");
          if (!isAddon && file.startsWith("assets/sources/")) assetsChanged = true;
          if (isAddon && file.includes("/assets/")) assetsChanged = true;

          stepObservations.push(`REPLACE_CODE cho "${file}" THÀNH CÔNG.`);
          break;
        }
        case "UPDATE_THEME_MEMORY": {
          sseWrite(reply, { step: "tool", label: `Đang cập nhật ghi nhớ phong cách...` });
          await updateAppliedSection(slug, action.payload.memoryUpdate);
          themeMd = await readThemeMd(slug);
          stepObservations.push(`UPDATE_THEME_MEMORY: Đã ghi nhận phong cách mới vào THEME.md.`);
          break;
        }
        case "GET_PLUGIN_CONTRACTS": {
          sseWrite(reply, { step: "tool", label: `Đang lấy hợp đồng các Plugin đang bật...` });
          const pluginContractLines: string[] = [];
          try {
            const activePlugins = await prisma.plugin.findMany({ where: { enabled: true } });
            for (const plugin of activePlugins) {
              const manifestPath = path.join(process.cwd(), "src", "addons", plugin.slug, "manifest.json");
              try {
                const manifestContent = await fs.readFile(manifestPath, "utf-8");
                const manifest = JSON.parse(manifestContent);
                if (manifest.themeContracts) {
                  for (const [file, rules] of Object.entries(manifest.themeContracts)) {
                    pluginContractLines.push(`[Plugin: ${manifest.name} - File ${file}]: ${rules}`);
                  }
                }
              } catch (err) {}
            }
          } catch (err) {}
          
          if (pluginContractLines.length > 0) {
            stepObservations.push(`GET_PLUGIN_CONTRACTS:\n${pluginContractLines.join("\n")}`);
          } else {
            stepObservations.push(`GET_PLUGIN_CONTRACTS: Hiện không có Plugin nào yêu cầu chèn giao diện (không có hợp đồng).`);
          }
          break;
        }
        case "GET_DESIGN_SYSTEM": {
          sseWrite(reply, { step: "tool", label: `Đang tra cứu UI/UX: ${action.payload.styleQuery}` });
          const ds = resolveDesignSystem(action.payload.styleQuery);
          const dsText = formatDesignSystem(ds);
          stepObservations.push(`GET_DESIGN_SYSTEM [${action.payload.styleQuery}]:\n${dsText}`);
          break;
        }
        case "REPLY_TO_USER": {
          sseWrite(reply, { step: "test_request", payload: { page: "home" } });
          const testPayload: any = await new Promise((resolve) => {
             themeTestEmitter.once(`test-result-${slug}`, resolve);
          });
          
          let qaFailed = false;

          const testerAgent = await prisma.agent.findFirst({ where: { key: "tester", isActive: true } });
          if (testerAgent) {
             sseWrite(reply, { step: "tool", label: `Đang nhờ Kỹ sư QA (Tester) kiểm tra code...` });
             try {
               const testResult = await callTestAgent(testerAgent, action.payload.message, testPayload.errors);
               if (testResult.status === "REJECT") {
                  let obsMsg = `TEST LỖI: ${testResult.feedback}`;
                  if (testPayload.errors && testPayload.errors.length > 0) {
                     obsMsg += `\nLOG TRÌNH DUYỆT:\n${testPayload.errors.join("\n")}`;
                  }
                  obsMsg += `\nYÊU CẦU: Sửa lỗi bằng REPLACE_CODE và gọi lại REPLY_TO_USER.`;
                  stepObservations.push(obsMsg);
                  qaFailed = true;
               }
             } catch (err) {
               action.payload.message += "\n\n(Chưa test)";
             }
          }
          
          if (!qaFailed) {
            const reviewAgent = await prisma.agent.findFirst({ where: { key: "reviewer", isActive: true } });
            if (reviewAgent && testPayload.screenshot) {
               sseWrite(reply, { step: "tool", label: `Đang nhờ Giám đốc Mỹ thuật (Reviewer) xem lại thiết kế...` });
               try {
                 const reviewResult = await callReviewAgent(reviewAgent, action.payload.message, testPayload.screenshot);
                 if (reviewResult.status === "REJECT") {
                    stepObservations.push(`REVIEW LỖI: ${reviewResult.feedback}\nYÊU CẦU: Chỉnh lại UI/UX bằng REPLACE_CODE và gọi lại REPLY_TO_USER.`);
                    qaFailed = true;
                 }
               } catch (err) {
                 action.payload.message += "\n\n(Chưa review)";
               }
            }
          }
          
          if (qaFailed) {
             break; // Continue the loop!
          }

          finalReply = action.payload.message;
          shouldBreak = true;
          break;
        }
      }
    }

    if (!justFinishedSubtask) {
      observations.push(`BƯỚC ${step}: ` + stepObservations.join(" | "));
    }

    if (shouldBreak) break;
    if (step === MAX_AGENT_STEPS) {
      finalReply = "Hệ thống đã đạt giới hạn vòng lặp tối đa. Quá trình tự động sửa đổi bị tạm dừng để đảm bảo an toàn.";
    }
  }

  if (assetsChanged) {
    sseWrite(reply, { step: "bundling", label: "Đang gộp lại CSS/JS..." });
    await rebuildThemeAssets(slug);
  }

  return finalReply;
}

export async function registerThemeChatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { file?: string } }>(
    "/admin/api/themes/:slug/file",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const file = request.query.file;
      const viewableFiles = await getViewableFiles(request.params.slug);
      if (!file || !viewableFiles.has(file)) {
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
      const rows = await prisma.adminChatHistory.findMany({
        where: { entityId: request.params.slug },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      const messages: any[] = [];
      for (const row of rows) {
        messages.push({
          id: `u_${row.id}`,
          role: "user",
          content: row.userMessage,
          imageUrl: row.imageUrl
        });
        if (row.assistantResponse) {
          messages.push({
            id: `a_${row.id}`,
            role: "assistant",
            content: row.assistantResponse,
            createdAt: row.createdAt
          });
        }
      }
      const themeMd = await readThemeMd(request.params.slug);
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
    const agent = await prisma.agent.findFirst({ where: { key: "design", isActive: true } });
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
      const chatRow = await prisma.adminChatHistory.create({
        data: {
          userId: request.session.get("userId") as number,
          entityId: slug,
          userMessage: message,
          imageUrl,
          status: "pending"
        }
      });

      const recentRows = await prisma.adminChatHistory.findMany({
        where: { entityId: slug },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        skip: 1,
      });
      const history: ChatHistoryItem[] = [];
      for (const m of recentRows.reverse()) {
        history.push({ role: "user", content: m.userMessage });
        if (m.assistantResponse) history.push({ role: "assistant", content: m.assistantResponse });
      }

      const finalReply = await runAgentLoop(reply, slug, agent, message, history, imageUrl);

      await prisma.adminChatHistory.update({
        where: { id: chatRow.id },
        data: { assistantResponse: finalReply, status: "success" }
      });
      
      sseWrite(reply, { step: "done", mode: "chat", reply: finalReply });
      reply.raw.end();
      
    } catch (err) {
      sseWrite(reply, { step: "error", label: (err as Error).message });
      reply.raw.end();
    }
  });

  app.post<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/chat/confirm-redesign",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { slug } = request.params;
      const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
      if (!customTheme) return reply.code(404).send({ error: "Chỉ chat sửa được theme do AI tạo" });
      
      const agent = await prisma.agent.findFirst({ where: { key: "design", isActive: true } });
      if (!agent) return reply.code(422).send({ error: "Chưa bật Agent design." });

      const lastMessage = await prisma.adminChatHistory.findFirst({ where: { entityId: slug }, orderBy: { createdAt: "desc" } });
      const meta = lastMessage && lastMessage.metadata ? JSON.parse(lastMessage.metadata) : {};
      if (!lastMessage || !lastMessage.assistantResponse || !meta.redesignBrief) {
        return reply.code(422).send({ error: "Không có đề xuất thiết kế lại nào đang chờ xác nhận." });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        const redesignPrompt = [
          "BẮT BUỘC: Hãy Redesign toàn bộ website theo đúng Brief trong THEME.md.",
          "BẠN PHẢI CHIA NHỎ VIỆC THÀNH CÁC SUBTASK VÀ SỬ DỤNG TOOL FINISH_SUBTASK ĐỂ ĐI TỪNG CHẶNG:",
          "- Nhóm 1 (Khung xương cơ bản): layout.liquid, header.liquid, footer.liquid, components/common/cart-drawer.liquid",
          "- Nhóm 2 (Component Sản phẩm): Các file trong components/product/* (media, info, purchase, content, related, card)",
          "- Nhóm 3 (Trang Sản phẩm & Thanh toán): product-list.liquid, product-category.liquid, checkout.liquid, order-confirmation.liquid",
          "- Nhóm 4 (Blog & Bài viết): blog-list.liquid, blog-category.liquid, blog-detail.liquid, blog-password.liquid",
          "- Nhóm 5 (Global Pages): 404.liquid, search.liquid, components/common/breadcrumb.liquid, components/common/pagination.liquid",
          "",
          "TUYỆT ĐỐI không gọi REPLY_TO_USER cho đến khi đã hoàn thành cả 5 nhóm trên bằng FINISH_SUBTASK."
        ].join("\n");

        const confirmRow = await prisma.adminChatHistory.create({
          data: { userId: request.session.get("userId") as number, entityId: slug, userMessage: redesignPrompt, status: "pending" }
        });

        const finalReply = await runAgentLoop(reply, slug, agent, redesignPrompt, []);

        await prisma.adminChatHistory.update({
          where: { id: confirmRow.id },
          data: { assistantResponse: finalReply, status: "success" }
        });

        sseWrite(reply, { step: "done", mode: "chat", reply: finalReply });
        reply.raw.end();
      } catch (err) {
        sseWrite(reply, { step: "error", label: (err as Error).message });
        reply.raw.end();
      }
    },
  );

  app.post<{ Params: { slug: string }; Body: { html: string; errors: string[]; screenshot?: string | null } }>(
    "/admin/api/themes/:slug/chat/test-result",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { slug } = request.params;
      const { html, errors, screenshot } = request.body;
      
      themeTestEmitter.emit(`test-result-${slug}`, { html, errors, screenshot });
      
      return reply.send({ success: true });
    }
  );
}
