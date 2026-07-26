import fs from "fs";
const path = "C:\\Users\\hieud\\.gemini\\antigravity-ide\\brain\\bb56f7a8-f01d-4f2b-a949-e8ad08a57945\\.system_generated\\logs\\transcript.jsonl";
const content = fs.readFileSync(path, "utf-8");
const lines = content.split("\n");
const found = new Set();
for (const line of lines) {
  if (line.includes("action\\\":") || line.includes("action\":")) {
    const matches = line.match(/"action"\s*:\s*"([^"]+)"/g) || line.match(/\\\"action\\\"\s*:\s*\\\"([^"]+)\\\"/g);
    if (matches) {
      matches.forEach(m => found.add(m));
    }
  }
}
console.log(Array.from(found).join("\n"));
