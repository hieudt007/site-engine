# Environment Variables — site-engine

Nguồn gốc: `.env.example` (dev) — file `.env` thật của mỗi instance production do `lead-base` sinh ra lúc bung Website (xem `docs/tech_doc.md` §6). Không commit `.env` thật vào git.

<!-- AUTO-GENERATED: .env.example -->
| Biến | Bắt buộc | Mô tả | Ví dụ |
|------|----------|-------|-------|
| `PORT` | Không (mặc định `3040`) | Cổng Fastify lắng nghe. Production: do Laravel cấp riêng/instance. | `3040` |
| `DATABASE_URL` | Có | Connection string PostgreSQL (Prisma). Production: 1 DB riêng/website. | `postgresql://postgres:postgres@localhost:5432/site_engine_dev` |
| `SITE_ENGINE_SECRET` | Có | Secret HMAC dùng ký/verify request 2 chiều với LeadBase (đơn hàng, đồng bộ sản phẩm) — xem `src/security.ts`. Production: sinh ngẫu nhiên riêng/website, KHÔNG dùng chung giá trị dev. | `dev-secret-change-me` |
| `LEADBASE_API_URL` | Có | Domain LeadBase của tenant tương ứng (cùng VPS ở production). | `http://localhost:8000` |
| `LEADBASE_OAUTH_CLIENT_ID` | Có | OAuth client ID (PKCE, không cần secret) dùng cho đăng nhập admin qua LeadBase. | `dev-oauth-client-id` |
| `SESSION_SECRET` | Có | Ký cookie session admin. Tối thiểu 32 ký tự. | `dev-session-secret-change-me-32chars-minimum` |
| `CUSTOMER_SESSION_SECRET` | Có | Ký cookie session khách hàng — plugin riêng, không dùng chung với `SESSION_SECRET`. | `dev-customer-session-secret-change-me` |
| `SMS_PROVIDER` | Không (để trống ở dev) | Nhà cung cấp SMS cho OTP — nhà cung cấp cụ thể chưa chốt (TBD, xem `docs/tech_doc.md` §6). | *(để trống)* |
| `SMS_API_KEY` | Không (để trống ở dev) | API key của nhà cung cấp SMS. | *(để trống)* |
| `SMS_API_SECRET` | Không (để trống ở dev) | API secret của nhà cung cấp SMS. | *(để trống)* |
<!-- /AUTO-GENERATED -->

## Ghi chú

- Không có secret riêng theo từng mục đích (đơn hàng vs đồng bộ sản phẩm) — cả 2 chiều dùng chung 1 `SITE_ENGINE_SECRET`/instance (lý do: quan hệ 2 phía cố định LeadBase ↔ đúng 1 Website, xem `docs/tech_doc.md` §6).
- `config.ts` throw lỗi nếu thiếu biến bắt buộc lúc khởi động — không có fallback ngầm cho các biến bắt buộc.
- Ba biến `SMS_*` để trống được ở dev vì OTP provider chưa chốt; khi bật flow OTP thật cần điền đủ.
