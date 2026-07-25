import fs from "node:fs/promises";
import path from "node:path";

export interface AgentSkill {
  slug: string;
  name: string;
  description: string;
}

const SKILLS_DIR = path.join(process.cwd(), "src", "agent-skills");

export async function getAllAgentSkills(): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const fullPath = path.join(SKILLS_DIR, entry.name);
        const content = await fs.readFile(fullPath, "utf-8");
        const slug = entry.name.replace(".md", "");

        // Parse frontmatter
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match) {
          const frontmatter = match[1];
          const nameMatch = frontmatter.match(/name:\s*(.+)/);
          const descMatch = frontmatter.match(/description:\s*(.+)/);
          if (nameMatch && descMatch) {
            skills.push({
              slug,
              name: nameMatch[1].trim(),
              description: descMatch[1].trim()
            });
          }
        }
      }
    }
  } catch (e) {
    // Thư mục chưa tồn tại hoặc lỗi đọc
  }
  return skills;
}

export async function getAgentSkillContent(slug: string): Promise<string | undefined> {
  try {
    const fullPath = path.join(SKILLS_DIR, `${slug}.md`);
    const content = await fs.readFile(fullPath, "utf-8");
    // Strip frontmatter
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      return match[1].trim();
    }
    return content.trim(); // Return raw if no frontmatter
  } catch (e) {
    return undefined;
  }
}
