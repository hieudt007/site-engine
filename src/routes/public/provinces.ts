import { FastifyInstance } from "fastify";
import { VN_PROVINCES } from "../../services/shipping.js";

// Danh sach tinh/thanh dung chung - checkout (dropdown chon tinh) VA admin settings-shipping
// (multi-select tao rule) deu goi endpoint nay, tranh 2 noi tu liet ke rieng roi lech chinh ta.
export async function registerProvincesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/provinces", async () => {
    return { provinces: VN_PROVINCES };
  });
}
