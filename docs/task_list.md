# Task List — site-engine

Thứ tự phase theo phụ thuộc kỹ thuật (không phải độ ưu tiên kinh doanh) — mỗi phase kết thúc ở trạng thái chạy được, verify được, trước khi sang phase kế. Nhắc lại mô hình (`architecture.md` §1): repo này build ra **1 gói zip** nhúng trong `lead-base`; Laravel **tự bung** thành N app độc lập (mỗi Website 1 app + 1 DB riêng), không có process trung gian nào. Nhiều mục dưới đây (đánh dấu **[lead-base]**) là việc thực hiện ở repo `lead-base`, không phải repo này — liệt kê để biết thứ tự phụ thuộc.

## Phase 0 — Khung dự án
- [ ] `package.json`, TypeScript config, Fastify server rỗng (`GET /health`).
- [ ] `src/security.ts` — port sign/verify HMAC từ `facebook-gateway/src/security.ts`, viết test.
- [ ] `prisma/schema.prisma` theo `system_design.md` §1, chạy migration đầu tiên trên Postgres local.
- [ ] `scripts/build-release.sh` — build + đóng gói `site-engine.zip` (`tech_doc.md` §2).

## Phase 1 — Bung được 1 app thật bằng tay (chưa tự động hoá, chưa domain/SSL)
- [ ] **[lead-base]** Model `Website` (Laravel, registry — `system_design.md` §2), migration.
- [ ] **[lead-base]** `WebsiteProvisionService.php` (mirror `LandingDomainProvisionService`): bung `site-engine.zip` vào `/var/www/site-engine/{websiteId}`, `npm ci --omit=dev`, `createdb`, sinh `SITE_ENGINE_SECRET` ngẫu nhiên lưu `Website.secret`, ghi `.env`, `prisma migrate deploy`.
- [ ] Chạy thử app vừa bung bằng tay (`node dist/server.js` với `.env` vừa sinh) — xác nhận app chạy độc lập, đọc đúng DB riêng, không đụng gì tới DB LeadBase hay app khác.
- [ ] **[lead-base]** Màn hình danh sách Website + nút "Tạo Website" gọi `WebsiteProvisionService`.

**Verify Phase 1**: bấm "Tạo Website" ở LeadBase → thư mục app mới xuất hiện trên VPS + DB mới tạo → chạy tay app đó, `curl localhost:{port}/health` trả về OK → không có bảng nào lẫn dữ liệu website khác (khác DB vật lý).

## Phase 2 — systemd + domain (Cloudflare Full mode, không Certbot)
- [ ] `systemd/site-engine-instance@.service` (`tech_doc.md` §5) — thay chạy tay ở Phase 1 bằng `systemctl enable --now site-engine-instance@{websiteId}`.
- [ ] **[lead-base]** `scripts/site-engine-provision-domain.sh` — chỉ 2 action `nginx <domain> <port>` (vhost dùng chung 1 cert Cloudflare Origin CA), `remove` (`system_design.md` §3) — **không có action `ssl`/Certbot**.
- [ ] **[lead-base]** `WebsiteProvisionService` gọi tiếp bước systemd + nginx sau khi DB/migrate xong (nối tiếp luồng Phase 1, vẫn cùng 1 service, không tách API).
- [ ] **[lead-base]** UI: nút "Tạo Website" giờ chạy xong luôn (không cần bước "Xin SSL" riêng như Landing Page) — trạng thái chỉ còn `status` (`provisioning`/`running`/`failed`).
- [ ] VPS: chuẩn bị theo `tech_doc.md` §8 (Node, Postgres quyền tạo/xoá DB, systemd unit, sudoers, user hệ thống riêng).

**Verify Phase 2**: gắn domain thật (đã trỏ nameserver Cloudflare + DNS record) vào 1 Website mới → bấm "Tạo Website" → app chạy dưới systemd (không SSH tay) → domain truy cập HTTPS được **ngay, không cần bước SSL riêng**.

## Phase 3 — Blog + đăng nhập tenant vào 1 app

**Đã chốt**: editor bài viết là UI riêng trong chính app đã bung (`architecture.md` §6) — cần làm session/bàn giao định danh TRƯỚC UI soạn bài.

- [ ] `plugins/session.ts` + route `GET /sso?token=...` verify token HMAC từ LeadBase (`system_design.md` §5.1, dùng `SITE_ENGINE_SECRET` của đúng instance — `tech_doc.md` §6), tạo `Session`.
- [ ] **[lead-base]** Nút "Quản lý nội dung" trong màn hình Website → tra registry lấy đúng URL app → phát token ngắn hạn `{tenantId, userId, userName, permissions, exp}`, redirect sang `{app_url}/sso`.
- [ ] **[lead-base]** Thêm permission `manage-website-content`, `view-website-content` vào `RolePermissionSeeder.php` (`system_design.md` §5.2).
- [ ] Middleware bảo vệ `/admin/*`: yêu cầu session hợp lệ + đúng `permissions`.
- [ ] Model `Post` + CRUD trực tiếp trong app qua UI vừa có session.
- [ ] UI soạn bài: list + editor (rich text — thư viện TBD).
- [ ] Route public `/blog`, `/blog/:slug`.

## Phase 4 — Sản phẩm + giỏ hàng + tài khoản khách hàng
- [ ] `routes/public/products-sync.ts` — `POST /api/products/sync`, verify HMAC (`SITE_ENGINE_SECRET`), tạo `ProductCache` mới (`publishStatus='draft'`) khi `action=create`, chỉ cập nhật `price/salePrice/stock/leadbaseStatus` khi `action=update` (`system_design.md` §4.2, `architecture.md` §5).
- [ ] `/admin/products` — UI xem danh sách (kể cả `draft`), sửa nội dung hiển thị (tên/mô tả/ảnh/SEO), nút Xuất bản (`system_design.md` §8).
- [ ] **[lead-base]** `ProductSyncService.php` — gọi `POST {website.domain}/api/products/sync` mỗi khi sản phẩm đổi (tạo/sửa), ký HMAC `Website.secret`, xử lý retry/queue khi Website đang down (`system_design.md` §4.2, TBD cơ chế retry cụ thể trước khi bắt đầu mục này).
- [ ] Route public `/products`, `/products/:id` (chỉ đọc `ProductCache.publishStatus='published'`).
- [ ] Giỏ hàng (session/cookie phía khách hàng, không cần DB riêng cho cart trước khi checkout).
- [ ] Chọn nhà cung cấp SMS OTP thật (`system_design.md` §6.4 #1), quyết định ngưỡng rate-limit (#2).
- [ ] Model `Customer`/`CustomerOtp`/`CustomerSession` + `otpService.ts` + route `POST /auth/otp/request`, `POST /auth/otp/verify` (`system_design.md` §6.2).
- [ ] `POST /cart/checkout` → tạo `CartOrder` (status `pending`), gán `customerId` nếu đã đăng nhập.
- [ ] Trang xác nhận đơn hàng: mời "Lưu thông tin cho lần sau?" cho khách guest → luồng `save_guest_order` (`system_design.md` §6.3).
- [ ] `/account/orders`, `/account/profile`, `/account/logout` — yêu cầu `CustomerSession` hợp lệ.

**Verify Phase 4**: đặt hàng guest → tạo đơn được → bấm "Lưu thông tin", nhận OTP, verify đúng → đơn vừa đặt gắn `customerId`. Đăng nhập lại đúng số điện thoại đó ở phiên khác → thấy đúng đơn hàng cũ, tên/địa chỉ đã lưu.

## Phase 5 — Đơn hàng đổ về LeadBase + SEO cơ bản
- [ ] `leadbaseClient.ts` — gọi `POST /api/site-engine/orders` (ký HMAC, `system_design.md` §4.1) — app tự gọi thẳng, không qua service trung gian nào.
- [ ] **[lead-base]** Endpoint nhận, tạo `Order`/`Customer` thật (mirror `LandingOrderController::store()` nhưng xác thực HMAC).
- [ ] Retry khi gọi lỗi (`CartOrder.status = 'failed'`, cron nhẹ retry N lần).
- [ ] Trang xác nhận `/order-confirmation/:id`.
- [ ] Model `SiteConfig` + `/admin/settings/general` (`system_design.md` §10.1) — tên, tagline, logo, liên hệ, mạng xã hội.
- [ ] `GET /sitemap.xml`, `GET /robots.txt` (`system_design.md` §10.3), fallback SEO chain cho Post/Product/trang chủ (§10.2), JSON-LD (§10.4).

**Verify Phase 5**: đặt 1 đơn thử từ website → thấy đúng Order trong LeadBase CRM. Tắt LeadBase giữa chừng → đặt đơn → bật lại → đơn tự gửi lại thành công (retry hoạt động). `/sitemap.xml` liệt kê đúng bài đã publish, không lộ bài `noindex`.

## Phase 6 — Hoàn thiện vận hành
- [ ] **[lead-base]** "Xoá Website" — `systemctl disable --now`, gỡ Nginx vhost, `dropdb`, `rm -rf` thư mục app (có xác nhận rõ ràng trước khi xoá — hành động không thể hoàn tác, `architecture.md` §3).
- [ ] **[lead-base]** Mở rộng `scripts/crm-backup-db.sh` (đã có sẵn — cron 2h sáng, pg_dump + rclone lên Google Drive) để `pg_dump` **thêm mọi DB `site_engine_*`**, không chỉ DB chính CRM (`architecture.md` §9). KHÔNG cần backup thư mục code app (`/var/www/site-engine/{id}`) hay thư mục deploy Landing Page (`/var/www/{domain}`) — cả 2 đều dựng lại được (bung zip lại / chạy lại `deploy()`), chỉ DB là dữ liệu không tái tạo được.
- [ ] **[lead-base]** Cập nhật retention/dung lượng ước tính khi số Website tăng (N DB thay vì 1) — kiểm tra `KEEP_DAYS_LOCAL` hiện tại còn hợp lý không khi backup gồm nhiều DB.
- [ ] Theo dõi lỗi: log tập trung tối thiểu, đảm bảo lỗi gửi đơn không bị nuốt im lặng.
- [ ] README + hướng dẫn build/release `site-engine.zip`, dựa trên `tech_doc.md` §2.

## Phase 7 — MCP: kết nối AI qua OAuth (draft, chưa chốt nội dung tool)

Chỉ triển khai sau khi Phase 3 (blog) và có hình dạng theme rõ ràng. Xem `system_design.md` §9 và `architecture.md` §7 cho các mục còn mở (TBD):

- [ ] Chọn thư viện OAuth server phía Node (ứng viên: `node-oidc-provider`), dựng discovery + dynamic client registration (RFC 8414/9728/7591) — mỗi app tự có OAuth server riêng của nó.
- [ ] Tái dùng cơ chế bàn giao định danh §5.1 cho bước consent (không làm token riêng cho MCP).
- [ ] Consent screen, mirror UX `resources/js/Pages/OAuth/Authorize.tsx` bên LeadBase.
- [ ] Access token resource-bound (RFC 8707), `aud` = base URL của chính app (không cần so khớp website — vốn dĩ chỉ có 1 website/app).
- [ ] MCP server (`POST /mcp`, JSON-RPC 2.0) với tool set tối thiểu ban đầu (`list_posts`, `create_post`, `update_post`, `publish_post`).
- [ ] **[lead-base]** Nút "Kết nối AI" trong trang quản lý Website + nút "Ngắt kết nối" (revoke `OAuthToken`).
- [ ] `generate_content`, `update_theme_section` — làm sau khi chốt việc mở #2/#3 ở `system_design.md` §9.

**Verify Phase 7**: từ LeadBase bấm "Kết nối AI" cho 1 Website → AI client (Claude) xin được access token → gọi `list_posts`/`create_post` thành công trên đúng app đó. Access token của app A không thể dùng cho app B (khác base URL, khác DB hoàn toàn — cô lập vật lý).

## Ngoài phạm vi task list này (Phase sau, chưa lên kế hoạch chi tiết)
- Cổng thanh toán online.
- Nhiều theme.
- Đa ngôn ngữ nội dung khách nhập.
- Dời 1 website riêng sang VPS khác (làm được kỹ thuật nhưng SSL/domain phải cấu hình tay, xem `PRD.md` §3.6).
