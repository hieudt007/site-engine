# Contributing — site-engine

Xem `docs/tech_doc.md` để hiểu kiến trúc tổng thể trước khi đọc file này. File này chỉ nói về quy trình dev hàng ngày (setup, chạy, test, code style).

## 1. Yêu cầu môi trường

- Node >= 22 (khai báo ở `package.json` `engines`)
- PostgreSQL (local hoặc container) — cần 1 database rỗng cho `DATABASE_URL`

## 2. Setup lần đầu

```bash
npm install
cp .env.example .env      # rồi chỉnh DATABASE_URL/SITE_ENGINE_SECRET/... cho máy dev, xem docs/ENV.md
npm run prisma:migrate    # tạo schema + chạy migration lên DB local
```

## 3. Scripts

<!-- AUTO-GENERATED: package.json scripts -->
| Lệnh | Mô tả |
|------|-------|
| `npm run dev` | Chạy dev server (`tsx watch`, hot reload), tự load `.env`, bỏ qua `themes/`, `uploads/`, `debug-ai/` khỏi watch |
| `npm run build` | `prisma generate` + biên dịch TypeScript (`tsc -p tsconfig.json`) ra `dist/` |
| `npm run start` | Chạy bản đã build (`node dist/server.js`) — dùng ở production/VPS |
| `npm run prisma:migrate` | `prisma migrate dev` — tạo migration mới + áp dụng lên DB local |
| `npm run prisma:deploy` | `prisma migrate deploy` — áp dụng migration có sẵn (production/VPS, không tạo migration mới) |
| `npm run release` | `scripts/build-release.sh` — build + đóng gói `site-engine.zip` (xem `docs/tech_doc.md` §2) |
| `npm test` | Chạy test suite bằng Vitest (`vitest run`) |
<!-- /AUTO-GENERATED -->

## 4. Testing

Framework: **Vitest** (`npm test`). Hiện repo chưa có file test nào — theo `docs/tech_doc.md` §9, các phần bắt buộc phải có test trước khi coi là xong:
- HMAC sign/verify cả 2 chiều (`src/security.ts`) — timestamp window, tamper detection.
- Đăng nhập admin (OAuth callback) và seed admin.
- Flow OTP (rate-limit, sai code, hết hạn).

Chạy test: `npm test`. Chưa cấu hình coverage command riêng — nếu cần số coverage, thêm `vitest run --coverage` (cần cài `@vitest/coverage-v8` trước).

## 5. Code style

- TypeScript ESM (`"type": "module"` trong `package.json`) — import nội bộ dùng đuôi `.js` (biên dịch từ `.ts`).
- Validate mọi input từ bên ngoài (body/query) bằng `zod`.
- Không log secret/HMAC ra console hay file.
- Không có khái niệm multi-tenant trong code (xem `docs/tech_doc.md` §7) — mỗi instance chỉ phục vụ đúng 1 website.
- Comment trong repo hiện tại chủ yếu bằng tiếng Việt — giữ nguyên convention này khi thêm code mới.

## 6. Trước khi mở PR / commit vào nhánh chung

- `npm run build` chạy sạch (không lỗi TypeScript).
- `npm test` pass.
- Không có `console.log` còn sót trong code sắp commit.
- Không hardcode secret (API key, `SITE_ENGINE_SECRET`, ...) — luôn qua `.env`/`src/config.ts`.
- Nếu đổi route hoặc biến môi trường, cập nhật `docs/tech_doc.md` §6 hoặc `docs/ENV.md` tương ứng.
