import fs from "node:fs";
import path from "node:path";

// Port TS cua BM25 search trong skill ui-ux-pro-max (scripts/core.py), CUNG mot ban port da co
// san ben lead-base (app/Services/UiUxSearchService.php, dung cho AI landing page). Data CSV copy
// nguyen tu resources/data/uiux/ ben lead-base sang assets/data/uiux/ o day (commit theo source,
// khong tai lai tu skill moi lan build). Dung de tra dung phan style/mau/font lien quan nhet vao
// prompt AI theme chat khi 'thiet ke lai toan site' (mode=redesign), thay vi de model tu bia design
// system moi lan.
const DATA_ROOT = path.join(process.cwd(), "assets", "data", "uiux");
const K1 = 1.5;
const B = 0.75;

type Row = Record<string, string>;

interface DomainConfig {
  file: string;
  searchCols: string[];
  outputCols: string[];
}

// Chi port domain thuc su dung cho redesign theme (product/style/color/typography + reasoning) -
// landing/motion/ux khong lien quan toi viec chon mau/font cho theme nhieu trang.
const CSV_CONFIG: Record<string, DomainConfig> = {
  style: {
    file: "styles.csv",
    searchCols: ["Style Category", "Keywords", "Best For", "Type", "AI Prompt Keywords"],
    outputCols: [
      "Style Category", "Type", "Keywords", "Primary Colors", "Effects & Animation", "Best For",
      "Complexity", "AI Prompt Keywords", "CSS/Technical Keywords", "Implementation Checklist", "Design System Variables",
    ],
  },
  product: {
    file: "products.csv",
    searchCols: ["Product Type", "Keywords", "Primary Style Recommendation", "Key Considerations"],
    outputCols: ["Product Type", "Keywords", "Primary Style Recommendation", "Secondary Styles", "Landing Page Pattern", "Dashboard Style (if applicable)", "Color Palette Focus"],
  },
  color: {
    file: "colors.csv",
    searchCols: ["Product Type", "Notes"],
    outputCols: [
      "Product Type", "Primary", "On Primary", "Secondary", "On Secondary", "Accent", "On Accent",
      "Background", "Foreground", "Card", "Card Foreground", "Muted", "Muted Foreground", "Border",
      "Destructive", "On Destructive", "Ring", "Notes",
    ],
  },
  typography: {
    file: "typography.csv",
    searchCols: ["Font Pairing Name", "Category", "Mood/Style Keywords", "Best For", "Heading Font", "Body Font"],
    outputCols: ["Font Pairing Name", "Category", "Heading Font", "Body Font", "Mood/Style Keywords", "Best For", "Google Fonts URL", "CSS Import", "Notes"],
  },
};

const STOPWORDS = new Set([
  "to", "in", "on", "at", "is", "of", "by", "or", "an", "if", "no", "so",
  "do", "be", "we", "it", "as", "the", "and", "for", "are", "was",
]);

const SYNONYMS: Record<string, string> = {
  "e-commerce": "ecommerce",
  "dark-mode": "dark",
  darkmode: "dark",
  "light-mode": "light",
  lightmode: "light",
  a11y: "accessibility",
  nav: "navigation",
  "sign-up": "signup",
  "log-in": "login",
  colour: "color",
  colours: "colors",
  customisation: "customization",
  organisation: "organization",
  behaviour: "behavior",
  "ux/ui": "ux ui",
};

interface DomainIndex {
  termFreqs: Map<string, number>[];
  docLengths: number[];
  avgdl: number;
  idf: Map<string, number>;
}

const rowsCache = new Map<string, Row[]>();
const indexCache = new Map<string, DomainIndex>();

// Parser CSV RFC4180 toi thieu (quote "", dau phay/newline trong o co quote) - cac file nguon co
// cot dai kieu "Implementation Checklist" chua nhieu dau phay trong 1 o, khong the split("\n")/
// split(",") don gian duoc.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function loadRows(domain: string, file: string): Row[] {
  const cached = rowsCache.get(domain);
  if (cached) return cached;

  const filePath = path.join(DATA_ROOT, file);
  const raw = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");
  const table = parseCsv(raw).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const [header, ...dataRows] = table;
  if (!header) return [];

  const rows: Row[] = dataRows.map((cols) => {
    const row: Row = {};
    header.forEach((col, i) => {
      row[col] = cols[i] ?? "";
    });
    return row;
  });

  rowsCache.set(domain, rows);
  return rows;
}

function tokenize(text: string): string[] {
  let normalized = text.toLowerCase();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    normalized = normalized.split(from).join(to);
  }
  normalized = normalized.replace(/[^\w\s]/gu, " ");

  return normalized
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function buildIndex(domain: string, rows: Row[], searchCols: string[]): DomainIndex {
  const cached = indexCache.get(domain);
  if (cached) return cached;

  const termFreqs: Map<string, number>[] = [];
  const docLengths: number[] = [];
  const docFreqs = new Map<string, number>();

  for (const row of rows) {
    const text = searchCols.map((c) => row[c] ?? "").join(" ");
    const tokens = tokenize(text);
    docLengths.push(tokens.length);

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    termFreqs.push(tf);

    for (const token of tf.keys()) {
      docFreqs.set(token, (docFreqs.get(token) ?? 0) + 1);
    }
  }

  const n = rows.length;
  const idf = new Map<string, number>();
  for (const [token, freq] of docFreqs) {
    idf.set(token, Math.log((n - freq + 0.5) / (freq + 0.5) + 1));
  }

  const avgdl = n > 0 ? docLengths.reduce((a, b) => a + b, 0) / n : 0;
  const index: DomainIndex = { termFreqs, docLengths, avgdl, idf };
  indexCache.set(domain, index);
  return index;
}

function search(query: string, domain: keyof typeof CSV_CONFIG, top: number): Row[] {
  const config = CSV_CONFIG[domain];
  const rows = loadRows(domain, config.file);
  if (rows.length === 0) return [];

  const index = buildIndex(domain, rows, config.searchCols);
  const queryTokens = tokenize(query);
  const scores: { docId: number; score: number }[] = [];

  rows.forEach((_, docId) => {
    let score = 0;
    const docLen = index.docLengths[docId];
    const termFreqs = index.termFreqs[docId];

    for (const token of queryTokens) {
      const idf = index.idf.get(token);
      if (idf === undefined) continue;
      const tf = termFreqs.get(token) ?? 0;
      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + (B * docLen) / (index.avgdl || 1));
      score += (idf * numerator) / denominator;
    }

    if (score > 0) scores.push({ docId, score });
  });

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, top).map(({ docId }) => {
    const row: Row = {};
    for (const col of config.outputCols) {
      const value = (rows[docId][col] ?? "").trim();
      if (value !== "") row[col] = value;
    }
    return row;
  });
}

interface ReasoningRule {
  pattern: string;
  stylePriority: string[];
  colorMood: string;
  antiPatterns: string;
}

function findReasoningRule(category: string): Row | null {
  const categoryLower = category.toLowerCase();
  const reasoning = loadRows("reasoning", "ui-reasoning.csv");

  for (const rule of reasoning) {
    if ((rule.UI_Category ?? "").toLowerCase() === categoryLower) return rule;
  }
  for (const rule of reasoning) {
    const uiCat = (rule.UI_Category ?? "").toLowerCase();
    if (uiCat && (categoryLower.includes(uiCat) || uiCat.includes(categoryLower))) return rule;
  }
  for (const rule of reasoning) {
    const uiCat = (rule.UI_Category ?? "").toLowerCase();
    const keywords = uiCat.replace(/[/-]/g, " ").split(/\s+/).filter(Boolean);
    for (const kw of keywords) {
      if (kw && categoryLower.includes(kw)) return rule;
    }
  }
  return null;
}

function applyReasoning(category: string): ReasoningRule {
  const rule = findReasoningRule(category);
  if (!rule) {
    return { pattern: "Hero + Features + CTA", stylePriority: ["Minimalism", "Flat Design"], colorMood: "Professional", antiPatterns: "" };
  }
  return {
    pattern: rule.Recommended_Pattern ?? "",
    stylePriority: (rule.Style_Priority ?? "").split("+").map((s) => s.trim()).filter(Boolean),
    colorMood: rule.Color_Mood ?? "",
    antiPatterns: rule.Anti_Patterns ?? "",
  };
}

function selectBestStyle(results: Row[], priorityKeywords: string[]): Row {
  if (results.length === 0) return {};
  if (priorityKeywords.length === 0) return results[0];

  for (const priority of priorityKeywords) {
    const priorityLower = priority.trim().toLowerCase();
    if (!priorityLower) continue;
    for (const result of results) {
      const styleName = (result["Style Category"] ?? "").toLowerCase();
      if (styleName && (priorityLower.includes(styleName) || styleName.includes(priorityLower))) {
        return result;
      }
    }
  }

  let best: { score: number; row: Row } = { score: 0, row: results[0] };
  for (const result of results) {
    let score = 0;
    const styleName = (result["Style Category"] ?? "").toLowerCase();
    const keywordsField = (result.Keywords ?? "").toLowerCase();
    const resultStr = Object.values(result).join(" ").toLowerCase();

    for (const kw of priorityKeywords) {
      const kwLower = kw.trim().toLowerCase();
      if (!kwLower) continue;
      if (styleName && styleName.includes(kwLower)) score += 10;
      else if (keywordsField && keywordsField.includes(kwLower)) score += 3;
      else if (resultStr.includes(kwLower)) score += 1;
    }

    if (score > best.score) best = { score, row: result };
  }

  return best.score > 0 ? best.row : results[0];
}

export interface DesignSystem {
  category: string;
  style: Row;
  color: Row;
  typography: Row;
  colorMood: string;
  antiPatterns: string;
}

// Port pipeline 2-hop cua design_system.py (skill goc)/UiUxSearchService::resolveDesignSystem():
// 1) tim category qua products.csv, 2) tra cheo ui-reasoning.csv de lay style uu tien DA DUYET
// SAN cho dung nganh do, 3) search style CO BIAS theo priority thay vi search doc lap (tranh ra
// ket qua mau thuan voi query, vd query "minimalist" nhung ra style "bubbly/playful").
export function resolveDesignSystem(query: string): DesignSystem {
  const productResults = search(query, "product", 1);
  const category = productResults[0]?.["Product Type"] ?? "General";

  const reasoning = applyReasoning(category);
  const priorityQuery = reasoning.stylePriority.slice(0, 2).join(" ");
  const styleResults = search(`${query} ${priorityQuery}`.trim(), "style", 3);
  const bestStyle = selectBestStyle(styleResults, reasoning.stylePriority);

  let colorResults = search(category, "color", 2);
  if (colorResults.length === 0) colorResults = search(query, "color", 2);

  const typographyResults = search(query, "typography", 2);

  return {
    category,
    style: bestStyle,
    color: colorResults[0] ?? {},
    typography: typographyResults[0] ?? {},
    colorMood: reasoning.colorMood,
    antiPatterns: reasoning.antiPatterns,
  };
}

export function formatDesignSystem(designSystem: DesignSystem): string {
  const blocks = [`### Ngành nghề nhận diện\nCategory: ${designSystem.category}`];

  if (Object.keys(designSystem.style).length) {
    const lines = ["### Design style gợi ý (đã ưu tiên theo ngành)"];
    for (const [key, value] of Object.entries(designSystem.style)) lines.push(`${key}: ${value}`);
    blocks.push(lines.join("\n"));
  }

  if (Object.keys(designSystem.color).length) {
    const lines = ["### Bảng màu (design tokens)"];
    for (const [key, value] of Object.entries(designSystem.color)) lines.push(`${key}: ${value}`);
    blocks.push(lines.join("\n"));
  }

  if (Object.keys(designSystem.typography).length) {
    const lines = ["### Font pairing"];
    for (const [key, value] of Object.entries(designSystem.typography)) lines.push(`${key}: ${value}`);
    blocks.push(lines.join("\n"));
  }

  const notes: string[] = [];
  if (designSystem.colorMood) notes.push(`Color mood gợi ý: ${designSystem.colorMood}`);
  if (designSystem.antiPatterns) notes.push(`TRÁNH (anti-patterns cho ngành này): ${designSystem.antiPatterns}`);
  if (notes.length) blocks.push(`### Lưu ý khi thiết kế\n${notes.join("\n")}`);

  return blocks.join("\n\n");
}
