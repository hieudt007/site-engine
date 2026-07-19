# System Design — site-engine

**Đọc trước**: mỗi Website = 1 app riêng (bung từ gói zip) + 1 database Postgres riêng, do chính LeadBase (Laravel) tự tạo/xoá — không qua service trung gian nào (`architecture.md` §1, §3). Vì vậy tài liệu này chỉ có **1 schema** — schema của gói app-mẫu site-engine, KHÔNG có cột `websiteId` ở bất kỳ bảng nào (DB chỉ chứa dữ liệu của đúng 1 website, không cần cột phân biệt).

Registry (danh sách Website: domain, tenant, trạng thái, port, tên DB) là **1 bảng mới bên phía `lead-base`** (Eloquent, không phải Prisma — ngoài phạm vi schema dưới đây), tương tự `LandingDomain` đã có. Xem `architecture.md` §3 cho luồng LeadBase tự bung/xoá app, không có API HTTP nào giữa bước "tạo Website" và app vừa tạo (đều là lệnh shell local).

## 1. Schema (app-mẫu — mỗi Website 1 bản DB riêng chạy đúng schema này)

```prisma
// Đúng 1 record duy nhất trong DB này — thông tin cơ bản + SEO mặc định của CHÍNH website
// đang chạy trên instance này. Không phải bảng registry (đó là việc của LeadBase).
model SiteConfig {
  id                String   @id @default("singleton") // luôn đúng 1 row
  leadbaseTenantId  String   // tham chiếu logic, không FK thật (khác DB)
  domain            String   // để chính app tự biết domain mình đang chạy (canonical URL, sitemap...)

  siteName          String
  tagline           String?
  logoUrl           String?
  faviconUrl        String?
  contactEmail      String?
  contactPhone      String?
  contactAddress    String?
  socialLinks       Json?    // { facebook?, zalo?, tiktok?, youtube? } — cấu trúc CHƯA CHỐT
  businessLicense   String?  // "Số ĐKKD" — TBD bắt buộc hay không, xem §10.1
  defaultOgImage    String?

  updatedAt         DateTime @updatedAt
}

// Session TENANT/nhân viên shop vào /admin — xem §6. KHÔNG có password, tạo từ token
// bàn giao định danh do LeadBase ký (HMAC).
model Session {
  id                String   @id
  leadbaseTenantId  String
  data              String   // JSON: { userId, userName, permissions }
  expiresAt         DateTime
}

model Post {
  id          String   @id @default(cuid())
  title       String
  slug        String   @unique
  body        String   // markdown hoặc HTML đã sanitize
  excerpt     String?
  coverImage  String?
  authorName  String?  // để trống thì hiển thị SiteConfig.siteName

  metaTitle       String?
  metaDescription String?
  ogImage         String?
  noindex         Boolean  @default(false)

  publishedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Sản phẩm liên kết với LeadBase — sở hữu dữ liệu CHIA ĐÔI, không phải cache thuần (architecture.md §5):
//   - Nội dung hiển thị (name, description, imageUrls, SEO...) do CHÍNH website này tự quản, LeadBase
//     không ghi đè sau lần tạo đầu.
//   - Giá/tồn/trạng thái do LeadBase đẩy sang mỗi khi đổi (POST /api/products/sync, §4.2) — instance
//     không tự sửa 3 field này, chỉ hiển thị.
model ProductCache {
  id                String   @id @default(cuid())
  leadbaseProductId String   @unique

  // --- Do LeadBase đẩy sang, instance chỉ đọc — KHÔNG sửa tay ---
  price             Decimal
  salePrice         Decimal?
  stock             Int?
  leadbaseStatus    String   // giá trị đồng bộ nguyên văn từ LeadBase — enum cụ thể TBD

  // --- Do CHÍNH website tự quản, LeadBase chỉ set giá trị khởi tạo lúc tạo mới, không ghi đè sau đó ---
  name              String
  description       String?
  imageUrls         String[]
  metaTitle         String?
  metaDescription   String?

  // Cổng xuất bản riêng của website — sản phẩm mới từ LeadBase luôn vào ở trạng thái draft,
  // tenant phải tự vào /admin/products sửa/bổ sung nội dung rồi publish (PRD.md §3.4)
  publishStatus     String   @default("draft") // 'draft' | 'published'

  syncedAt          DateTime @default(now()) // lần cuối nhận được cú đẩy từ LeadBase
}

model CartOrder {
  id          String   @id @default(cuid())
  customerId  String?  // null = guest
  customer    Customer? @relation(fields: [customerId], references: [id])
  status      String   // 'pending' | 'sent_to_leadbase' | 'failed'
  customerName String
  customerPhone String
  customerAddress String?
  items       Json     // [{ leadbaseProductId, name, price, quantity }]
  total       Decimal
  leadbaseOrderCode String?
  sendError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Tài khoản KHÁCH MUA HÀNG (đăng nhập phone+OTP) — xem §6. Khác hoàn toàn Session ở trên.
model Customer {
  id              String   @id @default(cuid())
  phone           String   @unique
  phoneVerifiedAt DateTime
  name            String?
  addresses       Json?    // [{ label, address, isDefault }] — CHƯA CHỐT
  orders          CartOrder[]
  sessions        CustomerSession[]
  createdAt       DateTime @default(now())
}

model CustomerOtp {
  id          String   @id @default(cuid())
  phone       String
  codeHash    String
  purpose     String   // 'login' | 'save_guest_order'
  attempts    Int      @default(0)
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime @default(now())

  @@index([phone])
}

model CustomerSession {
  id          String   @id
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  expiresAt   DateTime
}

// --- Draft cho tính năng MCP (§9) — TÊN/FIELD CHƯA CHỐT ---

model OAuthClient {
  id           String   @id @default(cuid())
  name         String
  redirectUris String[]
  isPublic     Boolean  @default(true)
  createdAt    DateTime @default(now())
}

model OAuthToken {
  id            String   @id @default(cuid())
  clientId      String
  accessToken   String   @unique
  refreshToken  String?  @unique
  resource      String   // RFC 8707 aud — luôn = base URL của chính instance này
  scopes        String[]
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime @default(now())
}

model ThemeConfig {
  id         String   @id @default("singleton") // đúng 1 row, giống SiteConfig
  config     Json     // cấu trúc CHƯA CHỐT
  updatedAt  DateTime @updatedAt
}
```

## 2. Provisioning — LeadBase tự thực hiện (KHÔNG phải API HTTP)

Không có request/response qua mạng ở bước tạo/xoá — toàn bộ là lệnh shell/filesystem cục bộ do Laravel chạy (`architecture.md` §3), mirror đúng cách `LandingDomainProvisionService` đang `exec()` script cho Landing Page. Bảng registry (phía `lead-base`, Eloquent) mới là nơi lưu:

```
Website (bảng mới bên lead-base, KHÔNG phải Prisma):
  id, tenant_id, domain, name,
  status              // 'provisioning' | 'running' | 'failed' | 'stopped'
  port, db_name        // để LeadBase biết instance đang chạy ở đâu (chỉ dùng lúc tạo/xoá, architecture.md §1)
  secret               // sinh ngẫu nhiên lúc tạo (vd random_bytes(32)), mã hoá at-rest, RIÊNG mỗi Website —
                       // ghi vào .env instance (SITE_ENGINE_SECRET, tech_doc.md §6), dùng ký/verify
                       // cả 3 chiều giao tiếp của đúng website này (đơn hàng, SSO, đồng bộ sản phẩm §4)
  provision_error
```

Bị lộ `.env` của 1 instance chỉ ảnh hưởng đúng website đó — không dùng 1 secret toàn cục cho mọi Website.

Không cần `ssl_status` riêng nữa (khác Landing Page) — SSL tự có ngay khi Nginx vhost xong nhờ Cloudflare Full mode (§3), chỉ còn đúng 1 trạng thái tổng `status`.

## 3. SSL/domain — Cloudflare Full mode, dùng chung 1 cert cho mọi domain

Không còn Certbot, không còn phân nhánh theo domain (`architecture.md` §4). Script `site-engine-provision-domain.sh` (chạy bởi chính Laravel, không phải service riêng) chỉ còn 2 việc:

```
nginx <domain> <port>   viết vhost reverse-proxy proxy_pass http://127.0.0.1:{port},
                          ssl_certificate/ssl_certificate_key TRỎ CHUNG vào
                          /etc/ssl/cloudflare/origin.crt|key (1 file duy nhất, mọi domain),
                          nginx -t && nginx -s reload
remove <domain>          gỡ vhost, reload
```

Không có bước `ssl` riêng, không có tham số `email`, không có `is_subdomain_of()` — vì mọi domain đều dùng chung 1 cert. Tuỳ chọn: kiểm tra domain đã trỏ DNS đúng (qua Cloudflare) trước khi báo `status='running'`, nhưng đây chỉ là 1 xác nhận đơn giản (`dns_get_record`), không phải chờ cấp phát cert như trước.

## 4. API — 2 chiều giao tiếp nghiệp vụ, mỗi chiều 1 việc, không chiều nào chạm thẳng DB phía kia

Ký HMAC theo đúng mẫu facebook-gateway (`sha256=HMAC_SHA256(secret, "{timestamp}.{rawBody}")`, header `x-site-engine-signature-256` / `-timestamp`, cửa sổ hợp lệ 300s, so sánh constant-time). `secret` = **`Website.secret`** — riêng từng website (§2), không phải 1 giá trị toàn cục. Đây là **2 API HTTP thật duy nhất** trong toàn bộ thiết kế — mọi thứ khác (tạo/xoá) đều local.

### 4.1 Website → LeadBase — đơn hàng

| Method + Path (LeadBase) | Việc | Trigger |
|---|---|---|
| `POST /api/site-engine/orders` | Tạo Order thật trong LeadBase | Khách checkout xong trên website |

Mirror `LandingOrderController::store()` nhưng xác thực bằng chữ ký HMAC (service-to-service) thay vì honeypot (form JS public):

```
Request: { leadbaseTenantId, websiteId, sourceDomain, customer: { name, phone, address }, items: [...], total }
Response: { success: true, orderCode: "DH..." }   // creator_id/status_id resolve server-side, KHÔNG nhận từ client
```

Lỗi (LeadBase down, sai chữ ký...): `CartOrder.status = 'failed'`, lưu `sendError`, retry cron nhẹ trong chính website đó, tối đa N lần rồi báo tenant xử lý thủ công — không được để mất đơn.

### 4.2 LeadBase → Website — đồng bộ giá/tồn kho/trạng thái sản phẩm

Đảo hướng so với bản thiết kế "pull-and-cache" ban đầu (`architecture.md` §5 cũ) — LeadBase **chủ động đẩy** mỗi khi sản phẩm đổi, gọi qua **domain công khai** của đúng Website đó (đồng nhất cơ chế với 4.1, không gọi nội bộ qua port).

| Method + Path (từng Website) | Việc | Trigger |
|---|---|---|
| `POST /api/products/sync` | Tạo/cập nhật `ProductCache` | Sản phẩm được thêm/sửa trong LeadBase, đúng tenant sở hữu Website này |

```
Request (action='create', sản phẩm mới chưa từng có ở instance này):
  { action: "create", leadbaseProductId, name, price, salePrice, stock, status }
  → tạo ProductCache mới, publishStatus='draft' — name chỉ là giá trị KHỞI TẠO, tenant tự sửa lại
    trong /admin/products, LeadBase không ghi đè name/description/imageUrls ở các lần sync sau

Request (action='update', đã tồn tại — match theo leadbaseProductId):
  { action: "update", leadbaseProductId, price, salePrice, stock, status }
  → CHỈ cập nhật price/salePrice/stock/leadbaseStatus + syncedAt — không đụng name/description/
    imageUrls/metaTitle/metaDescription/publishStatus (thuộc quyền tự quản của website)

Response: { success: true }
```

Lỗi (Website đang down/deploy, domain chưa sẵn sàng...): **TBD** cơ chế retry phía LeadBase (hàng đợi job Laravel, retry N lần) — cần thiết kế trước khi vào Phase 5, vì khác với 4.1 (retry nằm trong chính app gửi đi), ở đây LeadBase là phía gửi nên phải tự có hàng đợi/retry riêng, không thể dựa vào Website.

## 5. Đăng nhập + phân quyền (tenant/nhân viên shop vào `/admin` của 1 Website)

### 5.1 Đăng nhập — bàn giao định danh, không phải login độc lập

Instance **không có form đăng nhập, không có bảng password**. Danh tính + quyền hạn tới từ LeadBase tại thời điểm bàn giao.

```
Tenant đã login LeadBase, đang xem 1 Website → bấm "Quản lý nội dung"
  → LeadBase tra registry lấy URL đúng instance đó (mỗi instance domain khác nhau)
  → build token (HMAC, secret = SITE_ENGINE_SECRET của đúng Website này, §2):
    { tenantId, userId, userName, permissions: string[], exp: now + 60s }
    (không cần websiteId trong token — instance đích tự nó đã = đúng website đó)
  → redirect GET {instance_url}/sso?token=...
  → instance verify chữ ký + exp + chưa từng dùng token này (chống replay — TBD cách lưu, xem §5.2)
  → tạo Session (§2 schema instance): lưu {tenantId, userId, userName, permissions} vào `data`,
    expiresAt = now + 8h
  → set cookie httpOnly, sameSite=lax, secure (nếu https) → redirect vào /admin
```

- **Hết hạn (8h)**: không tự gia hạn — quay lại LeadBase bấm nút lần nữa.
- **Chống replay token bàn giao**: lưu tạm hash token đã dùng trong bộ nhớ (TTL = đúng 60s sống của token), không cần bảng DB riêng vì thời gian sống quá ngắn.
- **Logout**: xoá `Session` + clear cookie, không cần gọi LeadBase.

### 5.2 Phân quyền — dùng đúng permission string Spatie của LeadBase

LeadBase đã có Spatie `laravel-permission` thật, và **đã có sẵn convention cặp `manage-X`/`view-X`** cho từng nhóm dữ liệu (vd `manage-orders`/`view-orders`, `manage-customers`/`view-customers` — xem `RolePermissionSeeder.php`). Instance đi theo đúng convention đó, không phát minh hệ role riêng, không tự bịa format permission khác.

**4 permission, 2 đã có sẵn + 2 mới cần thêm**:

| Permission | Trạng thái | Gate cái gì |
|---|---|---|
| `manage-assets` | Đã có sẵn (đang gate Landing Page) | Toàn bộ tính năng Website ở **LeadBase** (tạo/xoá, §2). Bên website: `/admin/settings/domain` (read-only). |
| `view-orders` | Đã có sẵn (đang gate xem đơn hàng CRM) | Xem `/admin/orders` (chỉ xem trạng thái gửi LeadBase, debug) — tái dùng permission xem-đơn-hàng sẵn có, hợp lý vì đây vốn dĩ cũng là "đơn hàng", không cần bịa permission riêng cho site-engine. |
| `manage-website-content` (**mới**) | Cần thêm vào `RolePermissionSeeder.php` | Toàn quyền: tạo/sửa/xuất bản bài viết (`/admin/posts/*`), sửa `SiteConfig` (`/admin/settings/general`, §10), (Phase 7) kết nối/ngắt AI. |
| `view-website-content` (**mới**) | Cần thêm vào `RolePermissionSeeder.php` | Chỉ xem `/admin/posts` (list, không sửa/xuất bản được) và `/admin/settings/general` (read-only) — dành cho người chỉ cần xem, không được sửa (theo đúng convention manage/view LeadBase đã có ở mọi nhóm khác). |

`permissions` nhét vào token = giao của (quyền thật user có trên LeadBase) ∩ (4 permission trên) — 1 user có thể có cả `manage-website-content` lẫn `view-orders` mà không có `manage-assets`, ví dụ.

Route guard (`middleware requirePermission(perm)`):
- `/admin` — cần bất kỳ permission nào trong 4 cái trên.
- `/admin/posts` (xem danh sách) — `manage-website-content` HOẶC `view-website-content`.
- `/admin/posts/new`, `/admin/posts/:id` (sửa/xuất bản) — chỉ `manage-website-content`.
- `/admin/settings/general` (xem) — `manage-website-content` HOẶC `view-website-content`; (sửa) — chỉ `manage-website-content`.
- `/admin/settings/domain` — `manage-assets`.
- `/admin/orders` — `view-orders` (hoặc `manage-website-content`, xem như quyền cao hơn bao gồm quyền thấp — TBD có cần liệt kê tường minh mọi tổ hợp hay dùng rule "manage bao trùm view" cho gọn code).

Không có khái niệm "role" trong instance — chỉ check `permissions.includes(x)` thẳng trên session, không có bảng `Role`.

**TBD**: có cần tách riêng quyền "publish" khỏi "edit" không (vd người viết được nháp nhưng không tự xuất bản, cần người khác duyệt)? Chưa làm ở MVP — 1 permission `manage-website-content` gộp chung viết + xuất bản, tránh over-engineer khi chưa có nhu cầu thật.

## 6. Tài khoản khách hàng — đăng nhập lưu thông tin mua hàng

Hệ đăng nhập **hoàn toàn khác** với §7 (§7 = tenant/nhân viên shop vào `/admin`; §8 = khách mua hàng trên website public). Không dùng chung bảng, cookie, session.

### 6.1 Nguyên tắc đã chốt
- Đăng nhập bằng **số điện thoại + OTP SMS** (không mật khẩu) — khớp đúng dữ liệu đang thu ở checkout.
- **Tài khoản là tuỳ chọn** — checkout được luôn kể cả guest. Sau khi đặt hàng xong mới mời "Lưu thông tin cho lần sau?".
- Vì mỗi instance = 1 DB riêng cho 1 website, `Customer.phone` chỉ cần `@unique` thẳng (không cần `@@unique([websiteId, phone])` như bản thiết kế đa-tenant trước đó nữa).

### 6.2 Luồng OTP

```
POST /auth/otp/request  { phone }
  → rate-limit theo phone + IP (TBD ngưỡng cụ thể — bắt buộc có, SMS tốn phí thật)
  → sinh code 6 số, lưu CustomerOtp.codeHash, gửi SMS qua nhà cung cấp OTP
    (nhà cung cấp TBD — ứng viên: eSMS, SpeedSMS, Stringee)

POST /auth/otp/verify   { phone, code, purpose }
  → so codeHash, kiểm tra expiresAt + attempts, sai thì tăng attempts
  → đúng → consumedAt = now(); nếu purpose='login': tìm/tạo Customer (phoneVerifiedAt = now()
    nếu mới), tạo CustomerSession, set cookie RIÊNG (khác cookie session tenant §7 — tên/path khác)
```

### 6.3 Guest checkout → mời lưu tài khoản sau khi đặt hàng

```
Khách checkout KHÔNG đăng nhập → tạo CartOrder với customerId = null
  → trang xác nhận đơn hiện thêm: "Lưu thông tin để lần sau đặt hàng nhanh hơn?"
  → bấm Có → chạy luồng OTP purpose='save_guest_order' ở §8.2
  → verify xong → tạo/tìm Customer theo phone, gán ngược customerId vào CartOrder vừa tạo
```

### 6.4 Việc còn mở (TBD)
1. Nhà cung cấp SMS OTP cụ thể (chi phí/tháng).
2. Ngưỡng rate-limit chính xác.
3. Cấu trúc JSON `addresses`.

## 7. Public-facing routes (phía khách hàng)

```
GET  /                       trang chủ (theo SiteConfig + theme mặc định)
GET  /blog                   danh sách bài viết
GET  /blog/:slug             chi tiết bài viết
GET  /products                danh sách sản phẩm (đọc ProductCache, chỉ publishStatus='published')
GET  /products/:id
POST /cart/checkout           tạo CartOrder, gọi API §5 sang LeadBase (customerId nếu đã đăng nhập)
GET  /order-confirmation/:id  xác nhận sau checkout, mời lưu tài khoản nếu guest (§8.3)
POST /auth/otp/request        gửi OTP (§8.2)
POST /auth/otp/verify         xác minh OTP, tạo CustomerSession (§8.2)
GET  /account/orders          lịch sử đơn hàng (yêu cầu CustomerSession)
GET  /account/profile         thông tin + địa chỉ đã lưu (yêu cầu CustomerSession)
POST /account/logout
GET  /sitemap.xml             §12.3
GET  /robots.txt              §12.3
```

Không có route nào phía khách hàng cần biết tới LeadBase — toàn bộ gọi API là server-side.

## 8. Giao diện quản trị (`/admin/*`, sau khi có session §7)

Nguyên tắc: mỗi Website chỉ có đúng 1 app để quản lý (không có màn hình "chọn website" — đích đã cố định). Tạo mới/xoá Website, đổi domain **vẫn chỉ làm được bên LeadBase** (§2) — bản thân app không có UI cho việc đó, chỉ hiển thị đọc.

| Trang | Quyền cần | Nội dung |
|---|---|---|
| `/admin` | bất kỳ | Dashboard: số bài viết (draft/published), preview link website, tên user đang thao tác, nút "Quay lại LeadBase". |
| `/admin/posts` | `manage-website-content` | Danh sách bài viết, nút "Viết bài mới". |
| `/admin/posts/new`, `/admin/posts/:id` | `manage-website-content` | Editor bài viết (rich text — thư viện TBD) + xem trước + Lưu nháp/Xuất bản. |
| `/admin/products` | `manage-website-content` | Danh sách sản phẩm liên kết từ LeadBase, kể cả bản `draft` mới đẩy sang. Sửa được `name`/`description`/`imageUrls`/SEO + Xuất bản. **Không sửa được** giá/tồn kho/trạng thái (§4.2, hiển thị read-only, nút "Sửa trên LeadBase"). |
| `/admin/orders` | `manage-website-content` | Chỉ xem `CartOrder` (debug gửi LeadBase thành công/thất bại) — nút trỏ sang Order thật khi có `leadbaseOrderCode`. |
| `/admin/settings/general` | `manage-website-content` | Form `SiteConfig` (§10.1) — sửa được thật. |
| `/admin/settings/domain` | `manage-assets` | Xem domain/`status` — read-only, nút "Sửa trên LeadBase". |
| `/admin/ai` (Phase 7) | `manage-assets` | AI client đã kết nối (`OAuthToken` còn hiệu lực) + "Ngắt kết nối". Ẩn ở Phase 1-6. |

## 9. MCP — kết nối AI (draft, các mục TBD chưa chốt)

Mục tiêu: AI client (Claude...) đăng bài, tạo nội dung, sửa giao diện của website qua MCP, xác thực OAuth 2.1 — mirror bộ RFC LeadBase đang dùng thật: RFC 8414, RFC 9728, RFC 7591, RFC 8707. Lý do/luồng uỷ quyền tổng quan ở `architecture.md` §6-7.

**Endpoint dự kiến** (tên/route TBD):

| Endpoint | Chuẩn | Việc |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Discovery |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 | Khai báo resource MCP — audience = base URL của chính instance này |
| `POST /oauth/register` | RFC 7591 | Dynamic client registration (public/PKCE) |
| `GET /oauth/authorize` | OAuth 2.1 + PKCE | Consent screen — yêu cầu có token bàn giao hợp lệ từ LeadBase (§7.1) |
| `POST /oauth/token` | OAuth 2.1 | Đổi code lấy access token, `aud` = base URL chính instance (RFC 8707) |
| `POST /mcp` | MCP (JSON-RPC 2.0) | `initialize`, `tools/list`, `tools/call`, `ping` — mirror shape `McpController.php` bên LeadBase |

**Thư viện dự kiến** (TBD): `node-oidc-provider` (panva) — hỗ trợ sẵn Dynamic Client Registration + Resource Indicators.

**Danh sách tool (draft, CHƯA CHỐT)**: `list_posts`, `create_post`, `update_post`, `publish_post`, `generate_content` (gọi LLM qua 9router — trực tiếp hay qua LeadBase, TBD), `update_theme_section` (ghi `ThemeConfig.config`).

**Việc còn mở**:
1. Format/thời hạn token uỷ quyền LeadBase → instance.
2. `ThemeConfig.config` cấu trúc JSON cụ thể.
3. `generate_content` gọi 9router trực tiếp hay proxy qua LeadBase (dùng chung logic tính credit AI kiểu `AiCallLog`/`costCredits()` bên chatbot-lite).
4. Phạm vi `scopes` tối thiểu.

## 10. Thông tin cơ bản website + cấu trúc chuẩn SEO

### 10.1 Thông tin cơ bản — `SiteConfig` (schema đầy đủ ở §2)

Tách khỏi registry bên LeadBase (không liên quan domain/trạng thái tạo/xoá) — tenant tự soạn trong `/admin/settings/general` (§8): tên hiển thị, tagline, logo, favicon, liên hệ, mạng xã hội, ảnh chia sẻ mặc định. Đúng 1 row/DB, tự tạo rỗng ngay sau khi LeadBase bung app xong (§2), điền dần sau.

`businessLicense` ("Số ĐKKD/GPKD") — Nghị định 52/2013/NĐ-CP về TMĐT VN yêu cầu công khai thông tin đăng ký kinh doanh. **TBD**: bắt buộc nhập ngay Phase 1 hay tuỳ chọn.

### 10.2 Chuỗi fallback SEO

```
Trang bài viết:  Post.metaTitle/metaDescription/ogImage
                     ↓ (trống thì lấy) Post.title / excerpt / coverImage
                     ↓ (vẫn trống)     SiteConfig.tagline / defaultOgImage

Trang sản phẩm:  ProductCache.metaTitle/metaDescription
                     ↓ tự sinh từ ProductCache.name/description

Trang chủ:       SiteConfig.siteName + tagline + defaultOgImage
```

### 10.3 Route SEO kỹ thuật (không lưu DB — tính động lúc render)

```
GET /sitemap.xml   trang chủ + /blog + từng Post publish (!noindex) + /products + từng ProductCache
GET /robots.txt     allow all + Sitemap: <domain>/sitemap.xml; chặn /admin, /account, /cart
```

### 10.4 Structured data (JSON-LD) — sinh động, không có bảng riêng

- Trang chủ: `Organization` (từ `SiteConfig`, `sameAs` từ `socialLinks`).
- Trang bài viết: `Article` (title/coverImage/publishedAt/authorName).
- Trang sản phẩm: `Product` + `Offer` (price, availability theo stock).

### 10.5 Việc còn mở (TBD)
1. `businessLicense` bắt buộc hay tuỳ chọn.
2. Cấu trúc `socialLinks`/`addresses` JSON cụ thể.
3. TTL cache `sitemap.xml`.

## 11. Danh sách bảng (tổng hợp)

Tất cả nằm trong **cùng 1 DB** (schema §1) — không còn schema Orchestrator tách riêng. Registry (`Website`: domain, tenant, status, port, db_name) là bảng **bên LeadBase (Eloquent)**, ngoài phạm vi danh sách này.

| Bảng | Mục đích | Có từ Phase |
|---|---|---|
| `SiteConfig` | Thông tin cơ bản + SEO mặc định (1 row) | 1 |
| `Session` | Phiên tenant vào `/admin` | 3 |
| `Post` | Nội dung blog | 3 |
| `ProductCache` | Bản sao sản phẩm cache từ LeadBase | 4 |
| `CartOrder` | Đơn hàng, hàng đợi gửi LeadBase | 4-5 |
| `Customer` | Tài khoản khách mua hàng (phone+OTP) | 4 |
| `CustomerOtp` | OTP đang chờ xác minh | 4 |
| `CustomerSession` | Phiên đăng nhập khách mua hàng | 4 |
| `OAuthClient` | Client AI đã đăng ký (draft) | 7 |
| `OAuthToken` | Access token MCP (draft) | 7 |
| `ThemeConfig` | Cấu hình giao diện JSON (draft, 1 row) | 7 |

Không có bảng `User`/`Role`/`Permission` cho tenant ở bất kỳ đâu trong site-engine — định danh + quyền hạn luôn tới từ LeadBase (§7.2). `Customer` là ngoại lệ có chủ đích (khách mua hàng không có tài khoản LeadBase).
