import fs from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { logger } from "../logger.js";

const AI_CHAT_DIR = path.join(process.cwd(), "uploads", "ai-chat");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function startAiChatCleanupCron() {
  // Run daily at midnight
  cron.schedule("0 0 * * *", async () => {
    try {
      const exists = await fs.access(AI_CHAT_DIR).then(() => true).catch(() => false);
      if (!exists) return;

      const files = await fs.readdir(AI_CHAT_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(AI_CHAT_DIR, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > MAX_AGE_MS) {
          await fs.unlink(filePath).catch((err) => logger.error(err, "AI chat cleanup: failed to unlink file"));
        }
      }
    } catch (err) {
      logger.error(err, "AI Chat Cleanup Error");
    }
  });
}
