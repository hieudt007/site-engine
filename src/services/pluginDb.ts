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

async function checkSqlSecurity(sql: string, pluginSlug: string) {
   const lowerSql = sql.toLowerCase();
   // Chỉ chặn các thao tác Ghi (DML/DDL) trên các bảng Core. Read-only được phép.
   const isWrite = /^(insert|update|delete|drop|create|alter|truncate)\b/.test(lowerSql.trim());
   
   if (isWrite) {
       const plugin = await prisma.plugin.findUnique({ where: { slug: pluginSlug } });
       const allowedTables = (plugin?.allowedTables || []).map((t: string) => t.toLowerCase());
       
       const tableRegex = /(?:insert\s+into|update|delete\s+from|drop\s+table|alter\s+table|truncate\s+table)\s+"?([a-z0-9_]+)"?/ig;
       let match;
       while ((match = tableRegex.exec(sql)) !== null) {
           const tableName = match[1].toLowerCase();
           
           if (coreModelsLowerCase.includes(tableName)) {
               throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm thao tác GHI vào bảng Core: ${match[1]}`);
           }
           
           if (!allowedTables.includes(tableName)) {
               throw new Error(`[Plugin Security] Plugin "${pluginSlug}" không có quyền thao tác GHI trên bảng động: ${match[1]}. Cần khai báo trong allowedTables.`);
           }
       }
   }
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
