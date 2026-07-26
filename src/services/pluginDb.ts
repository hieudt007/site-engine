import { prisma } from "../db.js";
import { Prisma } from "@prisma/client";

// Các thao tác ghi (write) mà Plugin bị cấm gọi trên các core models (qua ORM)
const writeOperations = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
];

const coreModelsLowerCase = Prisma.dmmf.datamodel.models.map(m => (m.dbName || m.name).toLowerCase());

// CREATE INDEX co cau truc khac han cac cau con lai: ten bang KHONG dung ngay sau tu khoa, ma
// dung sau "ON" (vd CREATE UNIQUE INDEX IF NOT EXISTS idx_name ON "TableName" (...)) - phai tach
// regex rieng, khong the gop chung vao tableRegex (von gia dinh "tu khoa + ten bang" lien nhau).
const CREATE_INDEX_TABLE_RE = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?[a-z0-9_]+"?\s+on\s+"?([a-z0-9_]+)"?/ig;
const WRITE_TABLE_RE = /(?:insert\s+into|update|delete\s+from|drop\s+table|alter\s+table|truncate\s+table|create\s+table(?:\s+if\s+not\s+exists)?)\s+"?([a-z0-9_]+)"?/ig;

async function checkSqlSecurity(sql: string, pluginSlug: string) {
   const lowerSql = sql.toLowerCase();
   // Chỉ chặn các thao tác Ghi (DML/DDL) trên các bảng Core. Read-only được phép.
   const isWrite = /^(insert|update|delete|drop|create|alter|truncate)\b/.test(lowerSql.trim());

   if (isWrite) {
       const plugin = await prisma.plugin.findUnique({ where: { slug: pluginSlug } });
       const allowedTables = (plugin?.allowedTables || []).map((t: string) => t.toLowerCase());

       const matchedTables: string[] = [];
       for (const re of [WRITE_TABLE_RE, CREATE_INDEX_TABLE_RE]) {
         re.lastIndex = 0;
         let match;
         while ((match = re.exec(sql)) !== null) {
           matchedTables.push(match[1].toLowerCase());
         }
       }

       for (const tableName of matchedTables) {
           if (coreModelsLowerCase.includes(tableName)) {
               throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm thao tác GHI vào bảng Core: ${tableName}`);
           }

           if (!allowedTables.includes(tableName)) {
               throw new Error(`[Plugin Security] Plugin "${pluginSlug}" không có quyền thao tác GHI trên bảng động: ${tableName}. Cần khai báo trong allowedTables.`);
           }
       }
   }
}

// Cho phep plugin doc/ghi 1 "ban ghi" cua rieng no trong SiteConfig.pluginSettings (namespaced
// theo pluginSlug) MA KHONG mo quyen ghi toan bang SiteConfig - quyen bang (getPluginDb() o duoi)
// giu nguyen, van chan hoan toan nhu moi core model khac. Day la DUONG DUY NHAT plugin duoc dung
// de dung toi field nay - khong co API nao khac.
export async function getPluginSiteSetting(pluginSlug: string, key: string): Promise<unknown> {
  const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" }, select: { pluginSettings: true } });
  const settings = (config?.pluginSettings as Record<string, Record<string, unknown>> | null) || {};
  return settings[pluginSlug]?.[key];
}

// Doc-merge-ghi trong 1 transaction (khoa row) de 2 plugin ghi dong thoi khong de ghi de mat du
// lieu cua nhau - field pluginSettings la JSON blob nguyen khoi, Prisma khong merge tung key.
export async function setPluginSiteSetting(pluginSlug: string, key: string, value: unknown): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const config = await tx.siteConfig.findUnique({ where: { id: "singleton" }, select: { pluginSettings: true } });
    const settings = { ...(config?.pluginSettings as Record<string, Record<string, unknown>> | null || {}) };
    settings[pluginSlug] = { ...(settings[pluginSlug] || {}), [key]: value };
    await tx.siteConfig.update({ where: { id: "singleton" }, data: { pluginSettings: settings as Prisma.InputJsonValue } });
  });
}

export async function deletePluginSiteSetting(pluginSlug: string, key: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const config = await tx.siteConfig.findUnique({ where: { id: "singleton" }, select: { pluginSettings: true } });
    const settings = { ...(config?.pluginSettings as Record<string, Record<string, unknown>> | null || {}) };
    if (!settings[pluginSlug]) return;
    const scoped = { ...settings[pluginSlug] };
    delete scoped[key];
    settings[pluginSlug] = scoped;
    await tx.siteConfig.update({ where: { id: "singleton" }, data: { pluginSettings: settings as Prisma.InputJsonValue } });
  });
}

export function getPluginDb(pluginSlug: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model !== "PluginRecord" && writeOperations.includes(operation)) {
            throw new Error(`[Plugin Security] Plugin "${pluginSlug}" không có quyền thay đổi dữ liệu của bảng Core (${model}) qua ORM. Vui lòng dùng Raw SQL để thao tác với bảng động.`);
          }
          
          if (model === "PluginRecord" && writeOperations.includes(operation)) {
            if (operation === "create") {
               if ((args as any).data && (args as any).data.pluginSlug !== pluginSlug) {
                   throw new Error(`[Plugin Security] Plugin "${pluginSlug}" chỉ được thao tác trên PluginRecord của chính nó.`);
               }
            }
          }
          
          return query(args);
        }
      }
    },
    client: {
      async $executeRawUnsafe(query: string, ...values: any[]) {
        await checkSqlSecurity(query, pluginSlug);
        return prisma.$executeRawUnsafe(query, ...values);
      },
      async $executeRaw(query: TemplateStringsArray, ...values: any[]) {
        await checkSqlSecurity(query.join(" "), pluginSlug);
        return prisma.$executeRaw(query, ...values);
      },
      async $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T> {
        await checkSqlSecurity(query, pluginSlug);
        return prisma.$queryRawUnsafe(query, ...values);
      },
      async $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<T> {
        await checkSqlSecurity(query.join(" "), pluginSlug);
        return prisma.$queryRaw(query, ...values);
      }
    }
  });
}
