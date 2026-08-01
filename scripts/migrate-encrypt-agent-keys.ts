// Chay 1 LAN sau khi trien khai fix ma hoa Agent.apiKey / SiteConfig.aiProviderKeys - ma hoa lai
// bat ky gia tri nao dang o dang PLAINTEXT (chua tung ma hoa) bang nodeCrypt.ts (AES-256-GCM,
// bien moi truong NODE_ENCRYPTION_KEY). Dung heuristic "thu giai ma, that bai = con la plaintext"
// - an toan vi ciphertext base64 that KHONG BAO GIO decrypt thanh cong voi mot key khac/du lieu
// khong phai ciphertext, con applying encryptNodeString() 2 lan (da ma hoa roi ma hoa tiep) se
// vinh vien khong the decrypt lai duoc dung (script se tu bo qua nho check nay).
//
// Chay thu truoc (khong ghi gi vao DB, chi in ra so dong se doi):
//   npx tsx scripts/migrate-encrypt-agent-keys.ts --dry-run
// Chay that:
//   npx tsx scripts/migrate-encrypt-agent-keys.ts
import { prisma } from "../src/db.js";
import { encryptNodeString, decryptNodeString } from "../src/nodeCrypt.js";

const isDryRun = process.argv.includes("--dry-run");

type MigrateResult = { migrated: number; alreadyEncrypted: number; skippedEmpty: number };

function emptyResult(): MigrateResult {
  return { migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 };
}

function isAlreadyEncrypted(value: string): boolean {
  try {
    decryptNodeString(value);
    return true;
  } catch {
    return false;
  }
}

async function migrateAgentApiKeys(): Promise<MigrateResult> {
  const result = emptyResult();
  const rows = await prisma.agent.findMany({ where: { apiKey: { not: null } }, select: { id: true, apiKey: true } });
  for (const row of rows) {
    if (!row.apiKey) {
      result.skippedEmpty++;
      continue;
    }
    if (isAlreadyEncrypted(row.apiKey)) {
      result.alreadyEncrypted++;
      continue;
    }
    result.migrated++;
    if (!isDryRun) {
      await prisma.agent.update({ where: { id: row.id }, data: { apiKey: encryptNodeString(row.apiKey) } });
    }
  }
  return result;
}

async function migrateSiteConfigProviderKeys(): Promise<MigrateResult> {
  const result = emptyResult();
  const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  const keys = (config?.aiProviderKeys as Record<string, string> | null) || {};
  const nextKeys: Record<string, string> = {};
  let changed = false;

  for (const [provider, value] of Object.entries(keys)) {
    if (!value) {
      result.skippedEmpty++;
      nextKeys[provider] = value;
      continue;
    }
    if (isAlreadyEncrypted(value)) {
      result.alreadyEncrypted++;
      nextKeys[provider] = value;
      continue;
    }
    result.migrated++;
    nextKeys[provider] = encryptNodeString(value);
    changed = true;
  }

  if (changed && !isDryRun) {
    await prisma.siteConfig.update({ where: { id: "singleton" }, data: { aiProviderKeys: nextKeys } });
  }
  return result;
}

async function main() {
  console.log(`=== Ma hoa Agent.apiKey / SiteConfig.aiProviderKeys (${isDryRun ? "DRY RUN, khong ghi DB" : "CHAY THAT"}) ===\n`);

  const tasks: Array<[string, () => Promise<MigrateResult>]> = [
    ["Agent.apiKey", migrateAgentApiKeys],
    ["SiteConfig.aiProviderKeys", migrateSiteConfigProviderKeys],
  ];

  for (const [label, task] of tasks) {
    const result = await task();
    console.log(`${label}: migrated=${result.migrated} already_encrypted=${result.alreadyEncrypted} skipped_empty=${result.skippedEmpty}`);
  }

  console.log("\n=== Xong ===");
  if (isDryRun) {
    console.log("Dry-run OK. Chay lai KHONG kem --dry-run de ghi that vao DB.");
  } else {
    console.log("Migrate that thanh cong.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
