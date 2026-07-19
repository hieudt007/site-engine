# Tech Doc — site-engine

## 1. Stack

Node 22 · TypeScript (ESM) · Fastify 5 · Prisma + PostgreSQL · `zod` cho input validation ở mọi route · `bcryptjs`/`crypto` cho HMAC (Node built-in `crypto`, không cần thư viện ngoài — xem cách `facebook-gateway/src/security.ts` implement `signGatewayRequest`/`verifyGatewaySignature`, port lại nguyên logic đó) · **Liquid** (`liquidjs`, qua `@fastify/view`) cho toàn bộ template hiển thị (blog/sản phẩm/theme) — **KHÔNG dùng EJS**, chốt ở `architecture.md` §10: theme tự tạo (agent-generated) cần cho phép logic thật (vòng lặp/if-else) nhưng không được có khả năng chạy code trên server; Liquid an toàn theo thiết kế (không expose `require`/filesystem/eval), EJS thì không. Dùng Liquid thống nhất cho cả theme built-in lẫn custom — không tách 2 pipeline render theo mức tin cậy.

Lý do chọn (đã thống nhất trong `PRD.md`): khớp `chatbot-lite`/`facebook-gateway`, nhẹ, dễ đóng gói thành 1 gói chạy độc lập.

## 2. Repo này build ra 1 gói zip, KHÔNG phải 1 service tự deploy

**Chốt (đảo ngược lần 2 so với bản thiết kế đầu)**: `site-engine` không tự deploy lên VPS riêng, không có Orchestrator. Repo này build ra **1 artifact zip** (`site-engine.zip` — code đã compile + `package.json` + `prisma/`), artifact đó được **nhúng vào repo `lead-base`** (vd `resources/site-engine/site-engine.zip`, commit vào git hoặc build/upload lúc release — quyết định lúc code). `lead-base` (Laravel) tự bung zip này thành 1 thư mục app mới mỗi khi tenant tạo Website (`architecture.md` §3) — repo `site-engine` không biết gì về việc mình sẽ bị bung ra nhiều lần, nó chỉ là 1 app Node bình thường, không có khái niệm multi-instance ở tầng code.

Quy trình release (draft): `npm run build` (repo này) → đóng gói `dist/` + `package.json` + `prisma/` thành zip → copy/commit zip đó vào `lead-base/resources/site-engine/` → `lead-base` dùng nguyên zip đó cho mọi lần tạo Website tiếp theo (không build lại mỗi lần tạo — chỉ bung + `npm ci --omit=dev` + `prisma migrate deploy`).

## 3. Cấu trúc thư mục repo `site-engine` (chỉ 1 loại app, không có orchestrator/)

```
site-engine/
  src/
    server.ts              Fastify bootstrap — đọc PORT/DATABASE_URL của CHÍNH NÓ từ .env,
                            không có khái niệm multi-tenant/domain-routing gì cả
    config.ts               env loader, throw nếu thiếu biến bắt buộc
    db.ts                    Prisma client singleton
    security.ts              sign/verify HMAC (port từ facebook-gateway/src/security.ts) — dùng cho
                            CẢ 2 chiều (system_design.md §4): ký request gửi đi (đơn hàng, §4.1) VÀ
                            verify request LeadBase gửi tới (đồng bộ sản phẩm, §4.2) — cùng 1
                            SITE_ENGINE_SECRET của đúng instance này cho cả 2 chiều
    plugins/
      session.ts               @fastify/session + Session Prisma-backed, cookie TENANT (mirror chatbot-lite)
      customerSession.ts        cookie KHÁCH HÀNG — plugin/tên cookie RIÊNG, không lẫn với session.ts
    routes/
      sso.ts                   GET /sso — verify token bàn giao định danh từ LeadBase (system_design.md §5.1)
      admin/                   UI soạn nội dung, yêu cầu session TENANT (Phase 3)
        posts.ts
        settings.ts
      public/
        blog.ts
        products.ts
        checkout.ts
        auth.ts                 POST /auth/otp/request, /auth/otp/verify (system_design.md §6.2)
        account.ts               GET /account/orders, /account/profile
        seo.ts                    GET /sitemap.xml, /robots.txt (system_design.md §10.3)
        products-sync.ts          POST /api/products/sync — nhận cú đẩy giá/tồn/trạng thái TỪ
                                 LeadBase (system_design.md §4.2), verify HMAC bằng security.ts —
                                 chiều NGƯỢC với leadbaseClient.ts (LeadBase gọi vào, không phải
                                 app này gọi ra)
        theme-install.ts          POST /api/theme/install — nhận bundle theme tự tạo TỪ LeadBase
                                 (system_design.md §4.3), verify HMAC, validate slug + dung lượng,
                                 giải nén vào themes/{slug}/, KHÔNG tự activate
    services/
      leadbaseClient.ts        gọi API §system_design.md #4.1 (tạo order), ký HMAC — app tự gọi,
                               KHÔNG có process trung gian nào
      otpService.ts             sinh/verify OTP, gọi nhà cung cấp SMS (TBD nhà cung cấp)
      themeRenderer.ts          đọc ThemeConfig.activeTheme, trỏ @fastify/view sang đúng
                               themes/{activeTheme}/views/ — 1 nguồn duy nhất quyết định theme
                               nào đang hiển thị, dùng bởi mọi route public/

  themes/
    default/                  theme built-in đóng gói SẴN trong site-engine.zip (system_design.md
                             §1 ThemeConfig) — mỗi theme built-in là 1 thư mục con y hệt cấu trúc
                             theme tự tạo (views/*.liquid + theme.css), khác nhau ở chỗ được viết
                             bởi chính đội site-engine, không qua kênh cài đặt §4.3
      views/
        layout.liquid
        blog-list.liquid
        blog-post.liquid
        product-list.liquid
        product-detail.liquid
        cart.liquid
        checkout.liquid
        order-confirmation.liquid
      theme.css
    # minimal/, shop/ — thêm theme built-in khác cùng cấu trúc, TBD số lượng cho MVP
    # custom-{slug}/ — theme tự tạo, KHÔNG nằm trong git repo này (giải nén lúc runtime bởi
    #                  theme-install.ts vào đúng thư mục instance đang chạy, không phải build-time)

  prisma/
    schema.prisma            §system_design.md #1 — bản mẫu, mỗi lần bung ra 1 DB mới chạy
                             `prisma migrate deploy` lên đúng schema này
    migrations/

  package.json
  tsconfig.json

  scripts/
    build-release.sh         npm run build + đóng gói dist/+package.json+prisma/ thành site-engine.zip
                             (chạy trong CHÍNH repo này, output copy sang lead-base thủ công/CI)

  docs/
    PRD.md
    architecture.md
    system_design.md
    tech_doc.md
    task_list.md
```

## 4. Phần chạy trong repo `lead-base` (không phải repo này — chỉ ghi chú để rõ ranh giới)

Các file dưới đây **thuộc về `lead-base`**, không phải `site-engine` — liệt kê ở đây để biết site-engine cần "khớp" với cái gì khi bị bung ra:

```
lead-base/
  resources/site-engine/site-engine.zip     gói zip nhúng (từ §2)
  app/Services/WebsiteProvisionService.php   mirror LandingDomainProvisionService — bung zip,
                                             tạo DB, sinh secret, chạy migrate, cấp port, systemd,
                                             nginx (architecture.md §3)
  app/Services/ProductSyncService.php         gọi POST {website.domain}/api/products/sync mỗi khi
                                             sản phẩm LeadBase đổi (tạo/sửa), ký HMAC bằng
                                             Website.secret, có retry/queue khi Website down
                                             (system_design.md §4.2 — TBD cơ chế retry cụ thể)
  app/Models/Website.php                      registry, có field secret mã hoá (system_design.md §2)
  scripts/site-engine-provision-domain.sh     mirror crm-provision-domain.sh, action nginx/remove
                                             (system_design.md §3 — KHÔNG còn action ssl)
  systemd/site-engine-instance@.service       template unit, %i = domain (§5)
  app/Services/WebsiteThemeAgentService.php   (draft, chưa code) — sinh bundle theme (Liquid + CSS
                                             + JS client-side, KHÔNG có code chạy server) qua LLM,
                                             gọi POST {website.domain}/api/theme/install
                                             (system_design.md §4.3, architecture.md §6) — bước
                                             cuối cùng của luồng setup 1 Website
```

## 5. systemd template unit (`site-engine-instance@.service`)

Vẫn dùng systemd template (`%i` = **domain**, không phải websiteId — đổi lại sau khi chốt dùng domain làm định danh chính, xem §3 lý do) dù không còn Orchestrator — vì lý do chọn nó **không đổi**: cần chạy N bản của cùng 1 app, mỗi bản đọc `.env` riêng. Chỉ khác ai tạo file `.env`/enable unit: giờ là `WebsiteProvisionService.php` (Laravel) thay vì 1 process Node riêng.

```ini
[Unit]
Description=site-engine app for %i

[Service]
WorkingDirectory=/var/www/%i
EnvironmentFile=/var/www/%i/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=site-engine

[Install]
WantedBy=multi-user.target
```

`.env` nằm ngay trong thư mục app (`/var/www/{domain}/.env`), **không phải `/etc/`** — quyết định đảo ngược sau khi gặp lỗi thật trên VPS: `/etc` bị mount read-only trên 1 số VPS (container hoá/hardening), trong khi thư mục app đã chắc chắn ghi được (vừa unzip xong ở bước `create`). Laravel ghi `.env` (chứa `PORT`, `DATABASE_URL` riêng) rồi `sudo systemctl enable --now site-engine-instance@{domain}` — đúng pattern `escapeshellarg`/`execFile`, validate `domain` bằng đúng regex `LandingDomainProvisionService::run()` đang dùng cho Landing Page.

## 6. Biến môi trường (1 file `.env` riêng/website, do Laravel sinh ra lúc bung app)

```
PORT=...                            # do Laravel cấp, duy nhất/instance
DATABASE_URL=postgresql://.../site_engine_{domain viết lại bằng gạch dưới}

SITE_ENGINE_SECRET=...               # RIÊNG từng Website, do Laravel sinh ngẫu nhiên lúc tạo
                                     # (architecture.md §3, system_design.md §2) — dùng ký/verify
                                     # CẢ 3 chiều của đúng instance này: đơn hàng (§4.1), đồng bộ
                                     # sản phẩm (§4.2), bàn giao định danh SSO (§5.1). KHÔNG dùng
                                     # chung 1 giá trị cho mọi Website — lộ .env 1 instance chỉ
                                     # ảnh hưởng đúng instance đó
LEADBASE_API_URL=https://{tenant_domain}   # domain LeadBase của CHÍNH tenant đó (cùng VPS)

SESSION_SECRET=...                  # ký cookie session TENANT — RIÊNG theo từng website
CUSTOMER_SESSION_SECRET=...         # ký cookie session KHÁCH HÀNG — riêng theo từng website

SMS_PROVIDER=...                    # OTP SMS (system_design.md §6.2) — TBD nhà cung cấp
SMS_API_KEY=...
SMS_API_SECRET=...
```

Không có secret riêng theo từng mục đích (đơn hàng/SSO/đồng bộ sản phẩm) — cả 3 dùng chung đúng 1 `SITE_ENGINE_SECRET`/instance, vì đây là quan hệ 2 phía cố định (LeadBase ↔ đúng 1 Website đó), không phải mô hình 3 bên như facebook-gateway (vốn cần 2 secret để tách chiều forge webhook/impersonate API). Khác biệt so với bản thiết kế đầu: secret giờ **sinh riêng theo từng Website** (không phải 1 biến `.env` cố định toàn cục của LeadBase) — xem `architecture.md` §3.

## 7. Coding conventions (kế thừa từ facebook-gateway/chatbot-lite)

- Input validation bằng `zod` ở mọi route nhận body/query từ bên ngoài.
- Không log secret/HMAC ra console hay file (bài học từ gotcha #2 của chatbot-lite).
- Code trong repo này **không được có bất kỳ khái niệm multi-tenant nào** (không cột định danh website, không domain-routing theo Host header) — app luôn giả định "mình chỉ phục vụ đúng 1 website". Nếu thấy mình đang viết code kiểu "tra theo websiteId", đó là dấu hiệu nhầm sang tư duy kiến trúc cũ, cần dừng lại xem `architecture.md` §1.

## 8. Việc cần chuẩn bị phía VPS (thực hiện 1 lần lúc `lead-base` bootstrap, không phải việc của repo này)

Ghi chú để biết `lead-base/scripts/setup-vps.sh` cần thêm gì (đã có code thật ở `lead-base` — `app/Services/WebsiteProvisionService.php`, `scripts/site-engine-provision-{app,domain}.sh`, `systemd/site-engine-instance@.service`, `config/services.php` `site_engine.*` — không detail hoá lại ở đây vì thuộc repo khác):
1. Node 22 + npm cài sẵn trên VPS (đã có nếu VPS chạy 9router).
2. Postgres — user Laravel chạy dưới có quyền `CREATE DATABASE`/`DROP DATABASE` (`createdb`/`dropdb` qua `sudo -u postgres`).
3. Cài `systemd/site-engine-instance@.service` vào `/etc/systemd/system/`, `daemon-reload`.
4. Deploy 2 script vào `/usr/local/bin/` + Sudoers `NOPASSWD` cho cả 2 (mirror `crm-provision-domain.sh`):
   - `site-engine-provision-app.sh` (mkdir/unzip/npm ci/createdb/env/migrate/systemctl).
   - `site-engine-provision-domain.sh` (nginx reverse-proxy vhost dùng chung cert Cloudflare Origin CA, §3).
5. User hệ thống riêng `site-engine` chạy các tiến trình `site-engine-instance@*` (không phải `www-data`, không phải root) — mirror lý do LeadBase hiện dùng `www-data` riêng cho PHP-FPM.
6. Thư mục `/var/www/` (chứa cả app code lẫn `.env`, mode 600, từng instance — `.env` KHÔNG đặt ở `/etc/` vì 1 số VPS mount `/etc` read-only) — do `site-engine-provision-app.sh` tự tạo, chỉ cần đảm bảo user chạy Laravel có quyền `sudo` gọi script, không cần tạo tay trước.
7. Copy `site-engine.zip` (build từ repo `site-engine`, `npm run release`) vào `lead-base/resources/site-engine/site-engine.zip` trước khi tạo Website đầu tiên (`resources/site-engine/README.md`).

## 9. Testing

Chưa có framework test cụ thể — khuyến nghị `vitest` (nhẹ, hợp ESM/TS). Bắt buộc có test cho:
- HMAC sign/verify cả 2 chiều (app → LeadBase gửi đơn hàng, VÀ LeadBase → app đồng bộ sản phẩm), timestamp window, tamper detection.
- Token bàn giao định danh `/sso` (verify chữ ký, hết hạn, chống replay).
- Toàn bộ flow OTP (rate-limit, sai code, hết hạn).
