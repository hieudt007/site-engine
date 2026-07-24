import { prisma } from "../db.js";

// Các thao tác ghi (write) mà Plugin bị cấm gọi trên các core models
const writeOperations = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
];

export function getPluginDb(pluginSlug: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model !== "PluginRecord" && writeOperations.includes(operation)) {
            throw new Error(`[Plugin Security] Plugin "${pluginSlug}" không có quyền thay đổi dữ liệu của bảng ${model}. Core models là read-only đối với Plugin.`);
          }
          
          if (model === "PluginRecord" && writeOperations.includes(operation)) {
            // Tuỳ chọn: Bắt buộc plugin chỉ thao tác trên PluginRecord của chính nó nếu có trường pluginSlug ở top level args
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
      async $executeRawUnsafe() {
        throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm sử dụng truy vấn SQL thô ($executeRawUnsafe).`);
      },
      async $executeRaw() {
        throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm sử dụng truy vấn SQL thô ($executeRaw).`);
      },
      async $queryRawUnsafe() {
        throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm sử dụng truy vấn SQL thô ($queryRawUnsafe).`);
      },
      async $queryRaw() {
        throw new Error(`[Plugin Security] Plugin "${pluginSlug}" bị cấm sử dụng truy vấn SQL thô ($queryRaw).`);
      }
    }
  });
}
