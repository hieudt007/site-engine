# System Design — site-engine

**Đọc trước**: mỗi Website = 1 app riêng (bung từ gói zip) + 1 database Postgres riêng, do chính LeadBase (Laravel) tự tạo/xoá — không qua service trung gian nào (`architecture.md` §1, §3). Vì vậy tài liệu này chỉ có **1 schema** — schema của gói app-mẫu site-engine, KHÔNG có cột `websiteId` ở bất kỳ bảng nào (DB chỉ chứa dữ liệu của đúng 1 website, không cần cột phân biệt).

Registry (danh sách Website: domain, tenant, trạng thái, port, tên DB) là **1 bảng mới bên phía `lead-base`** (Eloquent, không phải Prisma — ngoài phạm vi schema dưới đây), tương tự `LandingDomain` đã có. Xem `architecture.md` §3 cho luồng LeadBase tự bung/xoá app, không có API HTTP nào giữa bước "tạo Website" và app vừa tạo (đều là lệnh shell local).

## 1. Schema (app-mẫu — mỗi Website 1 bản DB riêng chạy đúng schema này)

```prisma
// Đúng 1 record duy nhất trong DB này — thông tin cơ bản + SEO mặc định của CHÍNH website
// đang chạy trên instance này. Không phải bảng registry (đó là việc của LeadBase).
model SiteConfig {
  id                String   @id @default("singleton") // luôn đúng 1 row
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

// Tài khoản quản trị — đăng nhập qua OAuth THẬT của LeadBase (§5.1, Laravel Passport, y hệt
// luồng AI/MCP). id = ĐÚNG User.id bên LeadBase — upsert mỗi lần đăng nhập thành công. "role"
// là 1 trong đúng 3 giá trị 'admin'|'manager'|'edit', LeadBase tự tính từ role Spatie thật rồi
// trả về qua GET /api/oauth/userinfo. Khác "customer" (Phase 4, model Customer riêng bên dưới).
model User {
  leadbaseUserId Int      @id
  name           String
  email          String
  role           String // 'admin' | 'manager' | 'edit'
  lastLoginAt    DateTime
  createdAt      DateTime @default(now())

  posts     Post[]
  auditLogs AuditLog[]
}

// Session admin vào /admin — tạo sau khi hoàn tất OAuth code exchange (§5.1).
model Session {
  id                String   @id
  data              String   // JSON: { userId, email, role }
  expiresAt         DateTime
}

// Lịch sử thao tác — "ai làm gì, lúc nào" cho hành động nhạy cảm (xuất bản, xoá...). Post tự có
// authorId/updatedByUserId cho tra cứu nhanh "ai sửa lần cuối"; bảng này là lịch sử ĐẦY ĐỦ.
model AuditLog {
  id         String   @id @default(cuid())
  userId     Int
  user       User     @relation(fields: [userId], references: [leadbaseUserId])
  action     String   // vd 'post.create' | 'post.update' | 'post.publish' | 'post.delete'
  entityType String?  // vd 'Post'
  entityId   String?
  metadata   Json?    // chi tiết thêm, CHƯA CHỐT cấu trúc
  createdAt  DateTime @default(now())
}

model Post {
  id          String   @id @default(cuid())
  title       String
  slug        String   @unique
  body        String   // markdown hoặc HTML đã sanitize
  excerpt     String?
  coverImage  String?
  authorName  String?  // để trống thì hiển thị SiteConfig.siteName — bút danh CÔNG KHAI, khác authorId

  authorId        Int? // ai TẠO bài — User.leadbaseUserId, không phải bút danh public
  author          User? @relation(fields: [authorId], references: [leadbaseUserId])
  updatedByUserId Int? // ai SỬA LẦN CUỐI — có thể khác authorId

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

// Đúng 1 row — theme đang HIỂN THỊ trên website. "activeTheme" trỏ tới 1 thư mục theme:
// built-in (đóng gói sẵn trong site-engine.zip, vd "default"/"minimal"/"shop") HOẶC 1 slug
// trong CustomTheme bên dưới (§4 mô tả cách 1 custom theme được cài vào). Đổi theme = đổi
// đúng 1 dòng này, không xoá theme cũ (tenant bấm qua lại được, xem §8).
model ThemeConfig {
  id           String   @id @default("singleton") // đúng 1 row, giống SiteConfig
  activeTheme  String   @default("default")
  updatedAt    DateTime @updatedAt
}

// Theme TỰ TẠO đã cài vào đúng instance này (khác built-in — đóng gói sẵn trong zip, không cần
// bảng riêng). Cài qua POST /api/theme/install (§4.3), do 1 agent bên LeadBase sinh ra rồi đẩy
// sang — LeadBase KHÔNG ghi file trực tiếp vào app (giữ đúng PRD.md §3.4), instance tự nhận
// payload qua API rồi tự giải nén vào đúng thư mục theme của chính nó.
//
// Template dùng Liquid (`liquidjs`), KHÔNG dùng EJS cho theme tự tạo — Liquid có logic thật
// (vòng lặp/if-else/filter) nhưng an toàn theo thiết kế: không expose require/filesystem/eval,
// nên code do agent sinh ra không thể chạm tới server dù có lỗi hay bị injection. Theme built-in
// cũng dùng chung Liquid (1 engine, không tách pipeline render theo mức tin cậy).
model CustomTheme {
  id          String   @id @default(cuid())
  slug        String   @unique // ten thu muc theme, vd "custom-a1b2c3"
  name        String
  installedAt DateTime @default(now())
  source      String   // 'agent-generated' — CHƯA CHỐT giá trị khác (upload tay? TBD)
}
```

## 2. Provisioning — LeadBase tự thực hiện (KHÔNG phải API HTTP)

Không có request/response qua mạng ở bước tạo/xoá — toàn bộ là lệnh shell/filesystem cục bộ do Laravel chạy (`architecture.md` §3), mirror đúng cách `LandingDomainProvisionService` đang `exec()` script cho Landing Page. Bảng registry (phía `lead-base`, Eloquent) mới là nơi lưu:

```
Website (bảng mới bên lead-base, KHÔNG phải Prisma):
  id, domain, name,
  status              // 'provisioning' | 'running' | 'failed' | 'stopped'
  port, db_name        // để LeadBase biết instance đang chạy ở đâu (chỉ dùng lúc tạo/xoá, architecture.md §1)
  secret               // sinh ngẫu nhiên lúc tạo (vd random_bytes(32)), mã hoá at-rest, RIÊNG mỗi Website —
                       // ghi vào .env instance (SITE_ENGINE_SECRET, tech_doc.md §6), dùng ký/verify
                       // cả 2 chiều giao tiếp của đúng website này (đơn hàng, đồng bộ sản phẩm §4)
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

Ký HMAC theo đúng mẫu facebook-gateway (`sha256=HMAC_SHA256(secret, "{timestamp}.{rawBody}")`, header `x-site-engine-signature-256` / `-timestamp`, cửa sổ hợp lệ 300s, so sánh constant-time). `secret` = **`Website.secret`** — riêng từng website (§2), không phải 1 giá trị toàn cục. Đây là **3 API HTTP thật duy nhất** trong toàn bộ thiết kế — mọi thứ khác (tạo/xoá) đều local.

### 4.1 Website → LeadBase — đơn hàng

| Method + Path (LeadBase) | Việc | Trigger |
|---|---|---|
| `POST /api/site-engine/orders` | Tạo Order thật trong LeadBase | Khách checkout xong trên website |

Mirror `LandingOrderController::store()` nhưng xác thực bằng chữ ký HMAC (service-to-service) thay vì honeypot (form JS public):

```
Request: { websiteId, sourceDomain, customer: { name, phone, address }, items: [...], total }
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

### 4.3 LeadBase → Website — cài theme tự tạo (agent-generated)

Bước cuối cùng khi setup 1 Website xong (`architecture.md` §6 mô tả toàn bộ luồng agent). Cùng hướng 1 chiều với 4.2 (LeadBase chủ động đẩy, gọi qua domain công khai, ký HMAC `Website.secret`) — LeadBase **không bao giờ tự ghi file vào thư mục app của Website**; instance tự nhận payload rồi tự giải nén vào đúng thư mục theme của chính nó.

| Method + Path (từng Website) | Việc | Trigger |
|---|---|---|
| `POST /api/theme/install` | Cài 1 `CustomTheme` mới, KHÔNG tự kích hoạt | Agent bên LeadBase sinh xong 1 theme cho Website này |

```
Request: { slug, name, bundle }
  // bundle = zip/tar (base64) chứa CHỈ template Liquid (.liquid) + CSS + JS client-side — không
  // có gì chạy được trên server ngoài chính Liquid engine của site-engine (§system_design.md §1,
  // ThemeConfig ghi chú lý do chọn Liquid thay EJS)
  → validate slug (regex an toàn, không trùng theme built-in/đã cài), giới hạn dung lượng bundle
  → giải nén vào themes/{slug}/ (KHÔNG tự set ThemeConfig.activeTheme — tenant phải tự vào
    /admin/settings/theme xem trước rồi mới bấm Dùng theme này, §8 — tránh đổi giao diện
    website đang chạy mà tenant không hay biết)
  → tạo CustomTheme { slug, name, source: 'agent-generated' }

Response: { success: true, previewUrl: "/admin/theme-preview/{slug}" }
```

Lỗi (bundle không hợp lệ, slug trùng, quá dung lượng...): trả lỗi rõ ràng, LeadBase hiển thị lại cho agent/tenant thử lại — không có state cần rollback vì chưa activate gì.

## 5. Đăng nhập + phân quyền (tenant/nhân viên shop vào `/admin` của 1 Website)

### 5.1 Đăng nhập — OAuth 2.1 THẬT với LeadBase (Laravel Passport), không còn mật khẩu riêng

**Đảo ngược lần 3**: bản đầu dùng bàn giao HMAC/SSO tự chế (bị bỏ vì "loằng ngoằng"), bản 2 dùng email/mật khẩu độc lập (bị bỏ vì muốn LeadBase vẫn là nguồn xác thực, không phát sinh thêm 1 hệ tài khoản/mật khẩu nữa). Bản chốt: đăng nhập qua **OAuth 2.1 thật của LeadBase** — LeadBase đã có sẵn hạ tầng Passport hoàn chỉnh dùng cho AI/MCP (`McpController`, RFC 8414/9728/7591), site-engine tái dùng chính hạ tầng đó làm authorization server, không tự dựng gì thêm.

```
Lúc "Tạo Website" (LeadBase, WebsiteProvisionService.php):
  → tự đăng ký 1 OAuth client PUBLIC/PKCE riêng cho đúng Website này (Passport
    ClientRepository::createAuthorizationCodeGrantClient(confidential: false),
    redirect_uris = ["https://{domain}/admin/oauth/callback"]) — KHÔNG qua HTTP
    POST /oauth/register, gọi thẳng PHP vì cùng process Laravel
  → ghi client_id vào .env instance (LEADBASE_OAUTH_CLIENT_ID), lưu lại vào
    websites.oauth_client_id (để revoke khi xoá Website)

GET /admin/login (site-engine)
  → sinh PKCE (code_verifier, code_challenge=S256) + state, lưu tạm vào 1 cookie
    httpOnly ngắn hạn (5 phút) — CHƯA có session lúc này nên không lưu vào Session được
  → redirect sang LEADBASE_URL/oauth/authorize?...&code_challenge=...&state=...
  → tenant (đã đăng nhập LeadBase hoặc đăng nhập ngay lúc này) duyệt consent screen
  → LeadBase redirect về {domain}/admin/oauth/callback?code=...&state=...

GET /admin/oauth/callback
  → so state với cookie tạm (chống CSRF), sai thì từ chối
  → POST {LEADBASE_URL}/oauth/token (grant_type=authorization_code, code, code_verifier,
    client_id, redirect_uri — KHÔNG có client_secret, public client) → lấy access_token
  → GET {LEADBASE_URL}/api/oauth/userinfo (Bearer access_token) → { id, name, email,
    role } — endpoint MỚI thêm bên LeadBase, dùng đúng guard auth('api') mà McpController
    đang dùng, không tự verify JWT/JWKS ở phía site-engine. `role` LeadBase tự tính (không
    phải danh sách permission thô) — xem §5.2.
  → upsert User theo leadbaseUserId = id (tạo mới nếu chưa có, cập nhật name/email/role
    nếu đã có — đồng bộ lại mỗi lần đăng nhập)
  → tạo Session: lưu {userId, email, role} vào `data`, expiresAt = now + 30 ngày
  → set cookie httpOnly, sameSite=lax, secure (nếu https) → redirect vào /admin

POST /admin/logout → xoá Session + clear cookie (không cần gọi LeadBase revoke gì)
```

- Không giới hạn số session đồng thời — đăng nhập nhiều máy/trình duyệt tạo nhiều session độc lập.
- **Hết hạn (30 ngày)**: không tự gia hạn — đăng nhập lại (chạy lại toàn bộ luồng OAuth).
- `SITE_ENGINE_SECRET` không liên quan gì đăng nhập admin — chỉ dùng cho 2 API ở §4 (đơn hàng, đồng bộ sản phẩm). `LEADBASE_OAUTH_CLIENT_ID` là giá trị MỚI, riêng cho mục đích đăng nhập.
- **Việc còn mở (TBD)**: LeadBase's `ResourceBoundAccessToken` hiện hardcode `aud` = `{APP_URL}/api/mcp` cho MỌI client (không đọc tham số `?resource=`) — do site-engine không tự verify JWT mà gọi ngược lại `/api/oauth/userinfo` (LeadBase tự validate bằng guard nội bộ) nên việc này không ảnh hưởng, nhưng cần ghi nhớ nếu sau này muốn site-engine tự verify JWT cục bộ (cần LeadBase thêm JWKS endpoint trước).

### 5.2 Phân quyền — đúng 3 mức `admin`/`manager`/`edit`, LeadBase tự tính

Khác hẳn `Customer` (§6, khách mua hàng tự đăng ký phone+OTP) — `User.role` chỉ dành cho người quản trị nội dung, đúng 1 trong 3 giá trị, LeadBase tính sẵn từ role Spatie thật (`RolePermissionSeeder.php`) rồi trả về qua `/api/oauth/userinfo` — site-engine không tự suy luận từ danh sách permission thô:

| `role` | LeadBase role tương ứng | Gate cái gì trong site-engine |
|---|---|---|
| `admin` | `admin` | Toàn quyền — kể cả `/admin/settings/*`, cài/đổi theme, kết nối AI (Phase 8). |
| `manager` | `manager` | Nội dung + sản phẩm (nội dung hiển thị) + xem đơn hàng — không đụng settings hệ thống (domain read-only vốn dĩ chỉ xem được, không có gì để "cấm" thêm). |
| `edit` | Bất kỳ role LeadBase nào khác (sale/marketing/report/tuỳ) | Chỉ tạo/sửa bài viết ở trạng thái nháp — không tự xuất bản, không sửa settings. |

Middleware bảo vệ `/admin/*` ở MVP mới chỉ check **có session hợp lệ hay không**, CHƯA lọc theo `role` cụ thể cho từng trang — bảng trên là đích cần đạt, chưa phải trạng thái hiện tại của middleware.

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
| `/admin/settings/theme` | `manage-website-content` | Danh sách theme (built-in + `CustomTheme` đã cài, §4.3) kèm xem trước — bấm "Dùng theme này" để đổi `ThemeConfig.activeTheme`. Theme mới cài qua agent hiện ở đây dạng chưa kích hoạt cho tới khi tenant tự chọn. |
| `/admin/ai` (Phase 8) | `manage-assets` | AI client đã kết nối (`OAuthToken` còn hiệu lực) + "Ngắt kết nối". Ẩn ở Phase 1-7. |

## 9. MCP — kết nối AI (draft, các mục TBD chưa chốt)

Mục tiêu: AI client (Claude...) đăng bài, tạo nội dung qua MCP, xác thực OAuth 2.1 — mirror bộ RFC LeadBase đang dùng thật: RFC 8414, RFC 9728, RFC 7591, RFC 8707. Lý do/luồng uỷ quyền tổng quan ở `architecture.md` §6-7. **Không còn bao gồm việc sửa giao diện** — cài/đổi theme giờ đi qua kênh riêng, đơn giản hơn nhiều (agent bên LeadBase đẩy qua `POST /api/theme/install`, §4.3), không cần OAuth/MCP.

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

**Danh sách tool (draft, CHƯA CHỐT)**: `list_posts`, `create_post`, `update_post`, `publish_post`, `generate_content` (gọi LLM qua 9router — trực tiếp hay qua LeadBase, TBD).

**Việc còn mở**:
1. Format/thời hạn token uỷ quyền LeadBase → instance.
2. `generate_content` gọi 9router trực tiếp hay proxy qua LeadBase (dùng chung logic tính credit AI kiểu `AiCallLog`/`costCredits()` bên chatbot-lite).
3. Phạm vi `scopes` tối thiểu.

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

Tất cả nằm trong **cùng 1 DB** (schema §1) — không còn schema Orchestrator tách riêng. Registry (`Website`: domain, status, port, db_name, secret) là bảng **bên LeadBase (Eloquent)**, ngoài phạm vi danh sách này.

| Bảng | Mục đích | Có từ Phase |
|---|---|---|
| `SiteConfig` | Thông tin cơ bản + SEO mặc định (1 row) | 1 |
| `User` | Tài khoản admin, đăng nhập qua OAuth LeadBase (§5.1) | 3 |
| `Session` | Phiên admin vào `/admin` | 3 |
| `AuditLog` | Lịch sử thao tác (ai làm gì, lúc nào) | 3 |
| `Post` | Nội dung blog | 3 |
| `ProductCache` | Bản sao sản phẩm cache từ LeadBase | 4 |
| `CartOrder` | Đơn hàng, hàng đợi gửi LeadBase | 4-5 |
| `Customer` | Tài khoản khách mua hàng (phone+OTP) | 4 |
| `CustomerOtp` | OTP đang chờ xác minh | 4 |
| `CustomerSession` | Phiên đăng nhập khách mua hàng | 4 |
| `OAuthClient` | Client AI đã đăng ký (draft) | 7 |
| `OAuthToken` | Access token MCP (draft) | 7 |
| `ThemeConfig` | Theme đang active (1 row) | 3 |
| `CustomTheme` | Theme tự tạo đã cài (agent-generated, §4.3) | 6 |

`User` (đăng nhập admin, danh tính tới từ LeadBase qua OAuth — §5) và `Customer` (khách mua hàng tự đăng ký phone+OTP, hoàn toàn độc lập với LeadBase — §6) là 2 hệ tài khoản KHÁC NHAU — không dùng chung bảng, cookie, hay session.
