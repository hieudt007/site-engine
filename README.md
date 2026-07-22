# site-engine

CMS + thương mại điện tử đứng độc lập cho tenant LeadBase: blog, sản phẩm, giỏ hàng/thanh toán, vận chuyển, theme tuỳ biến qua AI chat — mỗi website chạy 1 instance riêng (DB + `/admin` riêng), đăng nhập qua OAuth LeadBase, quản lý provisioning từ LeadBase. Xem chi tiết thiết kế trong `docs/`.

## Stack

Node 22 · TypeScript (ESM) · Fastify 5 · Prisma + PostgreSQL · LiquidJS (theme public **và** admin UI đều server-render, không React/Vite — theme phải sửa được ngay không qua bước build, để AI chat/trình sửa inline chỉnh xong là thấy kết quả liền).

## Chạy local

```bash
cp .env.example .env        # điền DATABASE_URL, SITE_ENGINE_SECRET, LEADBASE_API_URL...
npm install
npm run prisma:migrate
npm run dev                  # backend :3040 (tsx watch, loại trừ themes/uploads/debug-ai)
```

## Lệnh khác

| Lệnh | Việc làm |
|---|---|
| `npm run build` | `prisma generate` + `tsc` |
| `npm run release` | Đóng gói `site-engine.zip` (dist/prisma/views/themes/assets/package.json) — LeadBase unzip thẳng vào thư mục instance của website mới (`WebsiteProvisionService.php`) |
| `npm test` | vitest |
| `npm run prisma:deploy` | `prisma migrate deploy` — dùng lúc deploy VPS |

## Tính năng chính

- **Nội dung**: bài viết/trang tĩnh, danh mục, media library (có `alt`), lịch sử chỉnh sửa (revision), SEO (Schema.org/JSON-LD, sitemap.xml, RSS), custom field tự do cho admin.
- **Sản phẩm**: đồng bộ 1 chiều từ LeadBase (giá/tồn/trạng thái), site tự quản nội dung hiển thị (excerpt/mô tả/ảnh/SEO/**thông số sản phẩm**), có biến thể, rating tổng hợp.
- **Giỏ hàng & thanh toán**: COD / chuyển khoản / VNPay (redirect + IPN, bật/tắt + cấu hình qua `/admin/settings/payment`), phí vận chuyển theo tỉnh/thành + ngưỡng miễn phí (`/admin/settings/shipping`), giao tận nơi hoặc nhận tại cửa hàng (`/admin/stores`), mã giảm giá (`/admin/coupons`). Đơn hàng gửi ngược LeadBase qua API ký HMAC.
- **`SiteConfig.siteType = 'blog'`**: chặn hẳn toàn bộ route thương mại (public lẫn admin), kể cả gõ đúng URL — dùng cho site chỉ viết blog, không bán hàng.
- **Theme**: Liquid + Tailwind, sửa trực tiếp qua trình inline click-to-edit (nội dung tĩnh) hoặc AI chat (redesign cả site — tự tra bảng màu/font/phong cách theo đúng ngành hàng qua `services/uiuxSearch.ts`, cùng kho dữ liệu UI/UX dùng chung với AI landing page bên LeadBase).
- **Bảo mật phiên**: 1 tài khoản chỉ đăng nhập được 1 thiết bị — đăng nhập mới tự đăng xuất phiên cũ (giống LeadBase).
- **Tracking**: Google Analytics / Facebook Pixel / script tuỳ chỉnh khác, cấu hình tại Settings chung.

## Tài liệu thiết kế

- [`docs/PRD.md`](docs/PRD.md) — vấn đề, phạm vi, tiêu chí thành công.
- [`docs/architecture.md`](docs/architecture.md) — ranh giới LeadBase ↔ site-engine, luồng dữ liệu.
- [`docs/system_design.md`](docs/system_design.md) — schema DB, API contract 2 chiều, state machine SSL.
- [`docs/tech_doc.md`](docs/tech_doc.md) — stack, cấu trúc thư mục, quy ước code, setup VPS.
- [`docs/task_list.md`](docs/task_list.md) — lộ trình implement theo phase.

> Các doc trên mô tả thiết kế ban đầu — một số phần (thanh toán/vận chuyển/coupon, blog site-type, tracking pixel, single-device login) đã triển khai sau khi các doc này viết, có thể chưa được cập nhật đầy đủ trong đó.
