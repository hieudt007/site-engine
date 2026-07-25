# Runbook — site-engine

Vận hành production của `site-engine` không nằm trong repo này — mỗi instance chạy trên VPS, được `lead-base` (Laravel) provision và quản lý (xem `docs/tech_doc.md` §2, §4, §8). File này tóm tắt các thao tác vận hành thường gặp cho đúng repo `site-engine`; phần thuộc `lead-base` chỉ ghi chú tham chiếu, không lặp lại chi tiết.

## 1. Kiến trúc triển khai (tóm tắt)

- Repo này **không tự deploy** — nó build ra 1 artifact `site-engine.zip`, artifact đó được `lead-base` bung thành 1 instance mới mỗi khi tenant tạo Website.
- Mỗi instance: 1 process Node (`systemd` unit `site-engine-instance@{domain}`), 1 DB Postgres riêng, 1 file `.env` riêng tại `/var/www/{domain}/.env`.
- Chi tiết đầy đủ: `docs/tech_doc.md` §2–§8.

## 2. Health check

```
GET /health  →  { "status": "ok" }
```

Route định nghĩa ở [server.ts:101](../src/server.ts#L101) — không kiểm tra DB, chỉ xác nhận process Fastify còn sống. Nếu cần xác nhận DB còn kết nối được, kiểm tra qua 1 route admin bất kỳ (yêu cầu session) hoặc query trực tiếp Postgres.

## 3. Build & release (từ máy dev, repo `site-engine`)

```bash
npm run release   # = scripts/build-release.sh: npm run build + đóng gói dist/+prisma/+views/+themes/+assets/+package.json → site-engine.zip
```

Sau khi có `site-engine.zip`, copy/commit thủ công sang `lead-base/resources/site-engine/site-engine.zip` — bước này **chưa tự động hoá** (quyết định lúc release, xem comment đầu `scripts/build-release.sh`). `lead-base` dùng nguyên zip đó cho **mọi** lần tạo Website tiếp theo — không build lại mỗi lần tạo.

## 4. Update 1 instance đang chạy (dev/test only)

`scripts/deploy-instance.sh` — **không phải luồng chính thức** tạo Website (luồng chính thức dùng `site-engine.zip` qua `WebsiteProvisionService.php`). Chỉ dùng để cập nhật code 1 instance đã tồn tại trên VPS, chạy trực tiếp trong thư mục instance đó:

```bash
cd /var/www/{domain} && bash scripts/deploy-instance.sh
```

Script tự chạy: `git pull` → `npm ci` → `npm run build` → `npx prisma migrate deploy` → `chown` về user `site-engine` → `systemctl restart site-engine-instance@{domain}`.

Giả định trước khi chạy: thư mục instance là git clone (không phải unzip từ `site-engine.zip`), đã có sẵn `.env` riêng của instance đó — script không đụng vào `.env`.

## 5. Common issues

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Process không start, log báo `Missing required env var: X` | Thiếu biến bắt buộc trong `.env` | Xem `docs/ENV.md`, bổ sung biến, khởi động lại unit |
| `EACCES`/ghi `.env` thất bại lúc provision | VPS mount `/etc` read-only | `.env` đã cố tình đặt trong `/var/www/{domain}/.env` (không phải `/etc/`) đúng vì lý do này — nếu vẫn lỗi, kiểm tra quyền ghi thư mục app, không phải `/etc` |
| Route thương mại (`/products`, `/cart`, `/admin/orders`, ...) trả 404 dù đã cấu hình | `SiteConfig.siteType = "blog"` — site đang ở chế độ blog thuần, chặn toàn bộ route thương mại theo prefix (xem [server.ts:105-155](../src/server.ts#L105-L155)) | Kiểm tra `SiteConfig.siteType` trong DB của đúng instance; đổi sang loại site có thương mại nếu đây là site bán hàng |
| Đổi rate-limit / lỗi 429 hàng loạt | `@fastify/rate-limit` đăng ký `global: false` — chỉ áp dụng ở route khai báo riêng | Kiểm tra route cụ thể đang set rate-limit gì, không phải cấu hình global |
| Migration mới không lên production | Instance dùng `prisma migrate deploy` (không tạo migration mới), không phải `migrate dev` | Migration phải được tạo và commit ở máy dev (`npm run prisma:migrate`) trước, rồi mới `deploy` lên instance |

## 6. Rollback

Chưa có cơ chế rollback tự động (blue-green, versioned zip, ...) — hiện tại `lead-base` chỉ giữ **1 bản** `site-engine.zip` mới nhất. Để rollback 1 instance cụ thể sau `deploy-instance.sh`:

1. `git log` trong thư mục instance để tìm commit trước đó.
2. `git checkout <commit-cũ>` (hoặc `git reset --hard` nếu chấp nhận mất thay đổi local — cẩn trọng, đây là thao tác phá huỷ).
3. Lặp lại các bước build/migrate/restart trong `scripts/deploy-instance.sh` thủ công (lưu ý: nếu migration mới đã `deploy` lên DB, rollback code không tự rollback schema — cần đánh giá migration có an toàn để giữ nguyên không trước khi checkout lùi).

## 7. Escalation

Không có kênh alerting/oncall được cấu hình trong repo này (chưa tích hợp Sentry/logging tập trung — `docs/tech_doc.md` không đề cập). Nếu phát hiện sự cố production, liên hệ trực tiếp người vận hành VPS/`lead-base`.
