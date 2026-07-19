# Task List — site-engine

Thứ tự phase theo phụ thuộc kỹ thuật (không phải độ ưu tiên kinh doanh) — mỗi phase kết thúc ở trạng thái chạy được, verify được, trước khi sang phase kế. Nhắc lại mô hình (`architecture.md` §1): repo này build ra **1 gói zip** nhúng trong `lead-base`; Laravel **tự bung** thành N app độc lập (mỗi Website 1 app + 1 DB riêng), không có process trung gian nào. Nhiều mục dưới đây (đánh dấu **[lead-base]**) là việc thực hiện ở repo `lead-base`, không phải repo này — liệt kê để biết thứ tự phụ thuộc.

## Phase 0 — Khung dự án
- [x] `package.json`, TypeScript config, Fastify server rỗng (`GET /health`).
- [x] `src/security.ts` — port sign/verify HMAC từ `facebook-gateway/src/security.ts`, viết test (7 test, `src/security.test.ts`).
- [x] `prisma/schema.prisma` theo `system_design.md` §1, chạy migration đầu tiên trên Postgres local.
- [x] `scripts/build-release.sh` — build + đóng gói `site-engine.zip` (`tech_doc.md` §2) — bước `npm run build` đã chạy sạch; bước zip cần môi trường có lệnh `zip` (Linux/CI), chưa test full trên máy dev Windows.

## Phase 1 — Bung được 1 app thật (ĐÃ VERIFY TRÊN VPS THẬT, GỘP LUÔN Phase 2)
- [x] **[lead-base]** Model `Website` (Laravel, registry — `system_design.md` §2), migration (`2026_07_19_000001_create_websites_table.php`, đã chạy local, có cột `secret` mã hoá — KHÔNG có `tenant_id`, xem ghi chú dưới).
- [x] **[lead-base]** `WebsiteProvisionService.php` (mirror `LandingDomainProvisionService`): bung `site-engine.zip` vào `/var/www/{domain}`, `npm ci --omit=dev`, `createdb`, sinh `SITE_ENGINE_SECRET` ngẫu nhiên lưu `Website.secret`, ghi `.env` (qua file tạm, tránh lộ secret trong `ps aux`), `prisma migrate deploy`, `systemctl enable --now`, Nginx vhost — code viết gộp luôn cả 2 bước systemd + nginx (Phase 2) trong 1 lần thay vì tách riêng như dự tính ban đầu.
- [x] **[lead-base]** `scripts/site-engine-provision-app.sh` (mkdir/unzip/npm ci/createdb/env/migrate/systemd) + `scripts/site-engine-provision-domain.sh` (nginx dùng chung 1 cert Cloudflare Origin CA, `remove` — KHÔNG có action `ssl`/Certbot, `system_design.md` §3).
- [x] `systemd/site-engine-instance@.service` (`tech_doc.md` §5) — `EnvironmentFile=/var/www/%i/.env` (đảo từ `/etc/` sang trong thư mục app sau khi gặp lỗi thật "Read-only file system" trên 1 VPS test — `/etc` bị mount read-only).
- [x] **[lead-base]** Màn hình danh sách Website (`Assets/Websites.tsx`) + nút "Tạo Website" gọi `WebsiteProvisionService`, nút xoá gọi `remove()`. Permission `manage-website-content`/`view-website-content` đã thêm vào `RolePermissionSeeder.php`.
- [x] Đổi định danh chính từ `websiteId` (số) sang **`domain`** cho thư mục app/systemd instance — `/var/www/{domain}`, PHẲNG, y hệt Landing Page (không namespace riêng). Domain trùng giữa Landing Page và Website bị chặn ở validation (mục dưới), nên không cần namespace. DB name = domain viết lại bằng gạch dưới (`site_engine_blog_leadbase_vn`), `id` chỉ còn dùng nội bộ để cấp port.
- [x] Thêm check tồn tại thư mục trước khi tạo (cả Website lẫn Landing Page `store()`, không đụng các endpoint retry) — tránh ghi đè dữ liệu cũ chưa dọn sạch trên VPS.
- [x] Thêm `App\Support\ReservedDomains` — chặn tạo Website/Landing Page trùng domain với chính LeadBase (`APP_URL`) hoặc subdomain 9router (`ai.{crm_root_domain}`) — phát hiện thiếu sau khi user hỏi trực tiếp, trước đó chỉ check trùng giữa các row trong cùng 1 bảng, không check trùng 2 service hạ tầng đang chạy thật.
- [x] Đã tự phát hiện + sửa 1 lỗi thiết kế: field `tenant_id`/`leadbaseTenantId` bị loại bỏ khỏi toàn bộ schema (Website, SiteConfig, Session, SSO token, order API) sau khi verify thực tế `lead-base` không có khái niệm tenant nào (1 cài đặt = 1 doanh nghiệp).
- [x] `createdb -O <dbOwner>` — DB tạo bằng `sudo -u postgres createdb` mặc định owner là `postgres`, user Laravel (`crm_user`) không có quyền `CREATE` trên schema `public` → prisma migrate lỗi "permission denied for schema public". Sửa: `create` action nhận thêm `dbOwner`, gán owner đúng lúc tạo DB.
- [x] **VERIFY THÀNH CÔNG trên VPS thật** (`blog.leadbase.vn`) — bấm "Tạo Website" → app + DB + Nginx tự cấu hình xong, không lỗi.

**Verify Phase 1+2**: ✅ đã test thật trên VPS — "Tạo Website" → app chạy dưới systemd, DB tạo đúng owner, Nginx vhost tạo xong. Còn lại: xác nhận `https://blog.leadbase.vn` load được `/health` qua trình duyệt thật (DNS/Cloudflare phía domain này).

## Phase 3 — Blog + đăng nhập admin vào 1 app

**Đã chốt**: editor bài viết là UI riêng trong chính app đã bung (`architecture.md` §6). **Đảo ngược quyết định ban đầu**: bỏ hẳn bàn giao định danh HMAC/SSO từ LeadBase — đăng nhập ĐỘC LẬP bằng email/mật khẩu, giống WordPress. Tài khoản admin đầu tiên tạo lúc "Tạo Website" bên LeadBase.

- [x] Model `User` (email+passwordHash+permissions), `AuditLog`, `Post.authorId`/`updatedByUserId` (migration `independent_admin_auth`) — thêm sau khi bàn về việc cần biết "ai đã xuất bản/sửa bài nào", không cần bảng riêng vì `User` đã đủ.
- [x] `services/seedAdmin.ts` — tạo `User` đầu tiên từ `ADMIN_EMAIL`/`ADMIN_PASSWORD` (chỉ khi bảng rỗng, không ghi đè nếu tenant đã đổi mật khẩu).
- [x] `plugins/session.ts` (Prisma-backed store, `services/sessionStore.ts`) + `routes/admin/auth.ts` (`POST /admin/login` bcrypt.compare, `POST /admin/logout`), cookie 30 ngày. Stub `/admin` (`routes/admin/index.ts`) để verify end-to-end — đã test thật bằng curl (sai mật khẩu/đúng mật khẩu/đọc session/logout đều đúng) + test tự động.
- [x] **[lead-base]** Form "Tạo Website" (`Websites.tsx`) thêm 2 field `admin_email`/`admin_password` (validate ở `WebsiteController::store()`) — LeadBase KHÔNG lưu mật khẩu, chỉ truyền qua `.env` lúc provision (`WebsiteProvisionService::writeEnv()`), không lưu vào bảng `websites`.
- [ ] ~~Nút "Quản lý nội dung" phát token, permission `manage-website-content`/`view-website-content`~~ — không còn cần thiết, đăng nhập giờ độc lập tại `{domain}/admin/login`, không qua LeadBase nữa. Permission `manage-website-content`/`view-website-content` đã thêm ở Phase 1 giờ không dùng cho mục đích này nữa (có thể dùng lại sau nếu cần).
- [ ] Middleware bảo vệ `/admin/*`: yêu cầu session hợp lệ (MVP chỉ check có session, chưa cần phân biệt permission cụ thể — `system_design.md` §5.2).
- [ ] Model `Post` + CRUD trực tiếp trong app qua UI vừa có session.
- [ ] UI soạn bài: list + editor (rich text — thư viện TBD).
- [ ] `@fastify/view` + Liquid (`liquidjs`) + theme built-in `themes/default/` (`tech_doc.md` §1, §3) — renderer đọc `ThemeConfig.activeTheme` (`themeRenderer.ts`), route public dùng renderer này thay vì hardcode 1 view.
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

## Phase 6 — Multi-theme: dựng sẵn + tự tạo bằng agent (`architecture.md` §10)

Chạy sau khi Phase 5 xong (agent cần nội dung/sản phẩm/SEO đã có để "biết thiết kế cho cái gì" — đây là bước cuối cùng của luồng setup 1 Website).

- [ ] Model `CustomTheme` (`system_design.md` §1) + migration.
- [ ] `routes/public/theme-install.ts` — `POST /api/theme/install`, verify HMAC, validate `slug` (regex an toàn, không trùng theme built-in/đã cài) + giới hạn dung lượng bundle, giải nén vào `themes/{slug}/`, tạo `CustomTheme`, KHÔNG tự activate (`system_design.md` §4.3).
- [ ] `/admin/settings/theme` — danh sách theme (built-in + `CustomTheme`) kèm xem trước, nút "Dùng theme này" đổi `ThemeConfig.activeTheme` (`system_design.md` §8).
- [ ] Thêm ít nhất 1-2 theme built-in nữa ngoài `default/` (TBD số lượng, `tech_doc.md` §3).
- [ ] **[lead-base]** `WebsiteThemeAgentService.php` (draft, chưa thiết kế prompt/luồng cụ thể) — sinh bundle Liquid+CSS+JS client-side qua LLM, gọi `POST /api/theme/install`.
- [ ] **[lead-base]** UI: bước "Thiết kế giao diện" ở cuối luồng tạo Website (sau khi nội dung đã setup xong) — gọi `WebsiteThemeAgentService`.
- [ ] **[lead-base]** Mở rộng backup (`architecture.md` §9 đã ghi chú) — thêm `themes/custom-*/` của mọi Website vào phạm vi backup (rsync/tar, khác `pg_dump` vì là file không phải DB — bung lại zip KHÔNG khôi phục được phần này).

**Verify Phase 6**: agent sinh xong 1 theme cho 1 Website test → theme xuất hiện ở `/admin/settings/theme` dạng chưa active → bấm "Dùng theme này" → website đổi giao diện đúng như agent thiết kế → theme cũ (built-in) vẫn còn, chọn lại được. Thử 1 bundle theme cố tình có payload bất thường (file quá lớn/slug độc hại) → bị từ chối rõ ràng, không crash app.

## Phase 7 — Hoàn thiện vận hành
- [ ] **[lead-base]** "Xoá Website" — `systemctl disable --now`, gỡ Nginx vhost, `dropdb`, `rm -rf` thư mục app (có xác nhận rõ ràng trước khi xoá — hành động không thể hoàn tác, `architecture.md` §3).
- [ ] **[lead-base]** Mở rộng `scripts/crm-backup-db.sh` (đã có sẵn — cron 2h sáng, pg_dump + rclone lên Google Drive) để `pg_dump` **thêm mọi DB `site_engine_*`**, không chỉ DB chính CRM (`architecture.md` §9). KHÔNG cần backup thư mục code app (`/var/www/{id}`) hay thư mục deploy Landing Page (`/var/www/{domain}`) — cả 2 đều dựng lại được (bung zip lại / chạy lại `deploy()`), chỉ DB và `themes/custom-*/` (Phase 6) là dữ liệu không tái tạo được.
- [ ] **[lead-base]** Cập nhật retention/dung lượng ước tính khi số Website tăng (N DB thay vì 1) — kiểm tra `KEEP_DAYS_LOCAL` hiện tại còn hợp lý không khi backup gồm nhiều DB.
- [ ] Theo dõi lỗi: log tập trung tối thiểu, đảm bảo lỗi gửi đơn không bị nuốt im lặng.
- [ ] README + hướng dẫn build/release `site-engine.zip`, dựa trên `tech_doc.md` §2.

## Phase 8 — MCP: kết nối AI qua OAuth (draft, chưa chốt nội dung tool)

Chỉ triển khai sau khi Phase 3 (blog) và Phase 6 (theme) xong. Xem `system_design.md` §9 và `architecture.md` §7 cho các mục còn mở (TBD). **Không còn bao gồm sửa giao diện** — việc đó đã có kênh riêng ở Phase 6, đơn giản hơn MCP/OAuth nhiều.

- [ ] Chọn thư viện OAuth server phía Node (ứng viên: `node-oidc-provider`), dựng discovery + dynamic client registration (RFC 8414/9728/7591) — mỗi app tự có OAuth server riêng của nó.
- [ ] Consent yêu cầu đã đăng nhập admin hợp lệ (§5.1, session email/mật khẩu) — không còn cơ chế bàn giao riêng để tái dùng, MCP tự có luồng OAuth độc lập.
- [ ] Consent screen, mirror UX `resources/js/Pages/OAuth/Authorize.tsx` bên LeadBase.
- [ ] Access token resource-bound (RFC 8707), `aud` = base URL của chính app (không cần so khớp website — vốn dĩ chỉ có 1 website/app).
- [ ] MCP server (`POST /mcp`, JSON-RPC 2.0) với tool set tối thiểu ban đầu (`list_posts`, `create_post`, `update_post`, `publish_post`).
- [ ] **[lead-base]** Nút "Kết nối AI" trong trang quản lý Website + nút "Ngắt kết nối" (revoke `OAuthToken`).
- [ ] `generate_content` — làm sau khi chốt việc mở #2 ở `system_design.md` §9.

**Verify Phase 8**: từ LeadBase bấm "Kết nối AI" cho 1 Website → AI client (Claude) xin được access token → gọi `list_posts`/`create_post` thành công trên đúng app đó. Access token của app A không thể dùng cho app B (khác base URL, khác DB hoàn toàn — cô lập vật lý).

## Ngoài phạm vi task list này (Phase sau, chưa lên kế hoạch chi tiết)
- Cổng thanh toán online.
- Đa ngôn ngữ nội dung khách nhập.
- Dời 1 website riêng sang VPS khác (làm được kỹ thuật nhưng SSL/domain phải cấu hình tay, xem `PRD.md` §3.6).
