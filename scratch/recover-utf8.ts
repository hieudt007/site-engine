import { execSync } from "child_process";
import fs from "fs";

const commit = "26a6470";
try {
  const aiChatCode = execSync(`git show ${commit}:src/routes/admin/aiChat.ts`, { encoding: "utf8" });
  fs.writeFileSync("src/routes/admin/aiChat.ts", aiChatCode, "utf8");
  console.log("Recovered aiChat.ts");

  const widgetCode = execSync(`git show ${commit}:views/admin/components/ai-chat-widget.liquid`, { encoding: "utf8" });
  fs.writeFileSync("views/admin/components/ai-chat-widget.liquid", widgetCode, "utf8");
  console.log("Recovered widget.liquid");
} catch (e) {
  console.error("Error recovering:", e.message);
}
