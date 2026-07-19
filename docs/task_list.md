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

**Đã chốt**: editor bài viết là UI riêng trong chính app đã bung (`architecture.md` §6). **Đảo ngược lần 3**: bàn giao HMAC/SSO (bỏ) → email/mật khẩu độc lập (bỏ) → **OAuth 2.1 THẬT với LeadBase** (Laravel Passport, y hệt luồng AI/MCP) — không cần điền credential gì lúc "Tạo Website", ai đăng nhập tự lấy đúng danh tính LeadBase của họ.

- [x] Model `User` (leadbaseUserId, name, email, role — KHÔNG có password), `AuditLog`, `Post.authorId`/`updatedByUserId` (migration `leadbase_oauth_login` + `user_role_not_permissions`) — thêm sau khi bàn về việc cần biết "ai đã xuất bản/sửa bài nào".
- [x] `services/leadbaseOAuth.ts` — PKCE (code_verifier/code_challenge S256), build authorize URL, đổi code lấy token + gọi userinfo.
- [x] `routes/admin/oauth.ts` — `GET /admin/login` (redirect PKCE, lưu state/verifier vào cookie tạm 5 phút), `GET /admin/oauth/callback` (verify state, đổi code, upsert `User`, tạo session), `POST /admin/logout`. `plugins/session.ts` (Prisma-backed, cookie 30 ngày) — đã test thật bằng curl (redirect URL đúng tham số PKCE, thiếu code/state bị chặn, state sai bị chặn CSRF).
- [x] **[lead-base]** `GET /api/oauth/userinfo` (`OAuthUserInfoController`, dùng đúng guard `auth('api')` như `McpController`) trả về `{id, name, email, role}` — `role` tự tính từ Spatie role thật (`admin`/`manager`/`edit`).
- [x] **[lead-base]** `WebsiteProvisionService::provision()` tự đăng ký 1 OAuth client public/PKCE riêng cho từng Website (`ClientRepository::createAuthorizationCodeGrantClient`), ghi `client_id` vào `.env` + `websites.oauth_client_id` (revoke khi xoá Website).
- [x] **[lead-base]** Bỏ hẳn field `admin_email`/`admin_password` khỏi form "Tạo Website" (`Websites.tsx`) — không còn cần thiết.
- [x] Middleware bảo vệ `/admin/*` — `plugins/requireRole.ts` (`requireRole(minRole)`, so theo thứ bậc `edit < manager < admin`), áp cho `/admin`, `/admin/posts*`. `publish`/`delete` yêu cầu tối thiểu `manager`; `edit` chỉ tạo/sửa được bài NHÁP (chặn sửa bài đã `publishedAt`), khớp đúng bảng `system_design.md` §5.2.
- [x] Model `Post` + CRUD — JSON API dời sang `routes/admin/posts.ts` tại `/admin/api/posts*` (đổi path để không đụng route HTML `/admin/posts` mới). Validate bằng zod, check trùng `slug`, ghi `AuditLog` mỗi hành động (`post.create/update/publish/delete`).
- [x] UI soạn bài: list + editor (`routes/admin/postsUi.ts` + `views/admin/{posts-list,post-edit}.liquid`) — server-render HTML, gọi JSON API ở `/admin/api/posts*` bằng `fetch()` client-side. Editor là `<textarea>` thường (rich text lib vẫn TBD, chưa chọn) — lưu HTML/markdown thô.
- [x] `services/sanitizeHtml.ts` (`sanitize-html`, allowlist tag/attribute cụ thể, chặn `javascript:` URL, ép `rel=noopener noreferrer` lên mọi `<a>`) — chạy trên `Post.body` ở CẢ `create` lẫn `update` (lúc lưu, không phải lúc render) trước khi ghi DB, vì theme render `post.body` không escape (`themes/*/blog-post.liquid`). 6 test (`sanitizeHtml.test.ts`): xoá `<script>`, xoá `onerror`, xoá `javascript:`, giữ tag hợp lệ, giữ link http(s) + thêm `rel`, xoá `<iframe>`/`<style>` nhưng giữ text xung quanh.
- [x] `themeRenderer.ts` dùng `liquidjs` trực tiếp (KHÔNG qua `@fastify/view` — cần 2 root riêng: `views/admin/` cố định và `themes/{activeTheme}/` đổi được, `@fastify/view` chỉ hỗ trợ 1 root/engine instance), đọc `ThemeConfig.activeTheme` mỗi lần render (fallback `"default"` nếu chưa có row). Theme `themes/default/` (`layout`, `blog-list`, `blog-post` — dùng `{% layout %}`/`{% block %}` của liquidjs). `scripts/build-release.sh` đã thêm bước copy `views/` + `themes/` vào zip (trước đó chỉ có `dist/`+`prisma/`+`package.json`).
- [x] Route public `/blog`, `/blog/:slug` (`routes/public/blog.ts`) — chỉ hiện bài có `publishedAt`, phân trang 10 bài/trang, 404 HTML cho slug không tồn tại/chưa publish.

## Phase 4 — Sản phẩm + giỏ hàng + tài khoản khách hàng
- [x] `routes/public/productsSync.ts` — `POST /api/products/sync`, verify HMAC qua header `x-site-engine-signature-256`/`-timestamp` (đúng convention §4.2, dùng `security.ts` sẵn có). `action=create` idempotent (nếu `leadbaseProductId` đã tồn tại thì xử lý như `update` thay vì lỗi trùng — phòng LeadBase gửi trùng lúc retry, TBD cơ chế retry #46 chưa quyết định). `action=update` CHỈ đụng `price/salePrice/stock/leadbaseStatus/syncedAt`. Cần `server.ts` đăng ký `addContentTypeParser` global để giữ `request.rawBody` (verify HMAC theo đúng byte đã ký) — trước đó chưa route nào cần raw body.
- [x] `/admin/products` — `routes/admin/products.ts` (JSON API, `/admin/api/products*`) + `routes/admin/productsUi.ts` (HTML) + `views/admin/{products-list,product-edit}.liquid`. Sửa tên/mô tả/ảnh/SEO, nút Xuất bản. `requireRole("manager")` — khác Post, role `edit` KHÔNG được đụng sản phẩm (§5.2: sản phẩm thuộc nhóm quyền manager).
- [x] **[lead-base]** `ProductSyncService.php` + `Jobs/SyncProductToWebsite.php` — hook vào `Product::booted()` (`static::saved()`), fan-out sang MỌI `Website::running()` (LeadBase single-tenant, không có cột tenant/company scoping trên `Product` lẫn `Website` — xác nhận qua research trước khi code). `create` luôn đẩy, `update` chỉ đẩy khi `price/sale_price/stock/status` thực sự đổi (tránh gọi HTTP thừa khi chỉ sửa mô tả/ảnh — các trường đó site-engine tự quản, không nhận qua kênh này). Retry qua queue Laravel có sẵn (`onQueue('facebook-sync')` — **dùng lại** queue đã có worker chạy thật trên VPS `crm-worker-sync`, KHÔNG tạo queue tên mới vì sẽ không ai xử lý), `$tries=5`, `backoff()` giãn dần tới ~40 phút trước khi vào `failed_jobs`. **VERIFY THÀNH CÔNG trên VPS thật**: tạo/sửa `Product` qua tinker → `ProductCache` bên `blog.leadbase.vn` tự cập nhật đúng (giá/tồn đổi, `name` giữ nguyên ở lần update).
- [x] Route public `/products`, `/products/:id` (`routes/public/products.ts`, `themes/default/{products-list,product-detail}.liquid`) — chỉ đọc `ProductCache.publishStatus='published'`. `description` escape + `newline_to_br` khi render (field nhập plain text ở admin, KHÔNG sanitize HTML như `Post.body` — escape ở lúc render thay vì lúc lưu vì đây chỉ 1 nơi hiển thị duy nhất, không như Post có thể nhiều theme khác nhau render lại).
- [ ] Giỏ hàng (session/cookie phía khách hàng, không cần DB riêng cho cart trước khi checkout).
- [ ] Chọn nhà cung cấp SMS OTP thật (`system_design.md` §6.4 #1), quyết định ngưỡng rate-limit (#2).
- [ ] Model `Customer`/`CustomerOtp`/`CustomerSession` + `otpService.ts` + route `POST /auth/otp/request`, `POST /auth/otp/verify` (`system_design.md` §6.2).
- [ ] `POST /cart/checkout` → tạo `CartOrder` (status `pending`), gán `customerId` nếu đã đăng nhập.
- [ ] Trang xác nhận đơn hàng: mời "Lưu thông tin cho lần sau?" cho khách guest → luồng `save_guest_order` (`system_design.md` §6.3).
- [ ] `/account/orders`, `/account/profile`, `/account/logout` — yêu cầu `CustomerSession` hợp lệ.

**Verify Phase 4**: đặt hàng guest → tạo đơn được → bấm "Lưu thông tin", nhận OTP, verify đúng → đơn vừa đặt gắn `customerId`. Đăng nhập lại đúng số điện thoại đó ở phiên khác → thấy đúng đơn hàng cũ, tên/địa chỉ đã lưu.

## Phase 5 — Đơn hàng đổ về LeadBase + SEO cơ bản
- [x] Giỏ hàng — `themes/default/cart.liquid` + nút "Thêm vào giỏ" (`product-detail.liquid`), sống ở `localStorage` phía trình duyệt (không có bảng DB cart), server chỉ tham gia lúc hydrate giá thật (`GET /api/cart/products?ids=`, không tin giá client tự lưu) và lúc checkout thật.
- [x] `leadbaseClient.ts` — `sendOrderToLeadbase()`, gọi `POST /api/site-engine/orders` ký HMAC (cùng secret 2 chiều với `productsSync.ts`), header `x-site-engine-domain` để LeadBase tra đúng `Website.secret`. `POST /cart/checkout` (`routes/public/cart.ts`) validate zod, tính giá/tổng THẬT từ `ProductCache` (không tin giá client gửi), tạo `CartOrder(status='pending')` trước rồi mới gọi LeadBase — đơn không bao giờ mất kể cả khi gọi lỗi.
- [x] **[lead-base]** `SiteEngineOrderController::store()` (mirror `LandingOrderController::store()`, xác thực HMAC qua `Website.secret` tra theo header `x-site-engine-domain` thay vì honeypot) — tạo `Order`+`OrderItem` thật qua `CustomerResolver`, `creator_id=null` (đơn từ website công khai, không có nhân viên tạo — cột đã nullable, không cần migration), recompute `total` từ items thay vì tin giá trị `total` client gửi.
- [x] Retry khi gọi lỗi — `services/orderRetry.ts`, `node-cron` mỗi 5 phút quét `CartOrder.status='failed'` retry lại. KHÔNG có cột đếm số lần retry trong schema (tránh migration) — dùng tuổi đơn (`createdAt` < 24h) làm giới hạn thay vì đếm lượt.
- [x] Trang xác nhận `/order-confirmation/:id` (`themes/default/order-confirmation.liquid`) — luôn hiện "đặt hàng thành công" phía khách bất kể `CartOrder.status` nội bộ là gì (kể cả `failed`, cron sẽ tự gửi lại) — không lộ lỗi hạ tầng ra khách hàng.
- [ ] **Chưa làm**: mời "Lưu thông tin cho lần sau?" cho khách guest sau khi đặt hàng (§6.3, `save_guest_order`) — phụ thuộc `Customer`/OTP (mục dưới Phase 4) vẫn chưa xây, cố tình hoãn theo đúng thứ tự ưu tiên đã thống nhất (lõi thương mại trước, tài khoản khách sau).
- [x] Model `SiteConfig` (đã có sẵn trong schema) + `/admin/settings/general` (`routes/admin/settings.ts` JSON API + `settingsUi.ts` HTML + `views/admin/settings-general.liquid`) — tên, tagline, logo, favicon, liên hệ, `socialLinks` (facebook/zalo/tiktok/youtube), số ĐKKD, ảnh OG mặc định. `requireRole("admin")` — duy nhất trong 3 role được đụng settings (§5.2). Row `singleton` tự tạo ở lần `GET` đầu tiên (`domain` lấy từ `request.hostname`). Theme `default` đã dùng `site.logoUrl`/`site.faviconUrl` trong `layout.liquid`.
- [x] `GET /sitemap.xml`, `GET /robots.txt` (`routes/public/seo.ts`) — sitemap gồm trang chủ/`/blog`/`/products` + từng bài/sản phẩm đã publish. **Chưa làm**: fallback SEO chain cho Post/Product/trang chủ (§10.2), JSON-LD (§10.4).

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
