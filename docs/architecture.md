# Architecture — site-engine

## 1. Bức tranh tổng thể

**Điểm cốt lõi (chốt lần 2, đảo ngược so với bản trước)**: `site-engine` không phải 1 service deploy riêng, không cần VPS riêng, không có "Orchestrator" là process trung gian. Nó là **1 gói mã nguồn build sẵn (zip), nhúng ngay trong repo `lead-base`**. LeadBase (Laravel) **tự bung gói này** thành 1 ứng dụng mới mỗi khi tenant tạo Website — y hệt cách `LandingDomainController` hiện đang shell script cho Landing Page, chỉ khác là giờ "shell script" đó còn bao gồm cả bung code + tạo DB + khởi động service.

```
┌──────────────────────────────────────────────────────────────────┐
│                   VPS của khách (LeadBase + 9router + site-engine)│
│                                                                      │
│  ┌────────────────────────┐                                        │
│  │ LeadBase (Laravel)      │                                        │
│  │ - Website registry      │  (1) tạo/xoá — bung/dọn zip, tạo/xoá DB│
│  │   domain, tenant, status│───────────────┐                        │
│  │ - UI: tạo/xem Website   │               ▼                        │
│  │ - Order (nguồn sự thật) │◄──────┐  ┌─────────────┐ ┌───────────┐│
│  │                          │  (2)  │  │ Website #1  │ │ Website #2││
│  │ ┌──────────────────────┐│  order│  │ app + DB    │ │ app + DB  ││
│  │ │ Landing Page (đã có) ││  API  │  │ domain A    │ │ domain B  ││
│  │ │ - export tĩnh, 1 lần ││       └──┴─────────────┴─┴───────────┘│
│  │ └──────────────────────┘│         mỗi Website tự gọi (2) trực   │
│  └────────────────────────┘         tiếp, KHÔNG qua LeadBase đứng   │
│                                       giữa nghiệp vụ hàng ngày       │
│  Nginx dùng chung 1 cert Cloudflare Origin CA cho MỌI domain (§4)   │
└──────────────────────────────────────────────────────────────────┘
```

- **(1) LeadBase → 1 Website (tạo/xoá)**: bấm "Tạo Website" → LeadBase tự thực hiện toàn bộ (§3), KHÔNG gọi API/HMAC sang đâu cả vì đều local, cùng máy — dùng `exec`/`execFile` như `LandingDomainProvisionService` đang làm.
- **(2a) Từng Website → LeadBase (đơn hàng)**: khi có đơn hàng, hoặc tenant bấm "Quản lý nội dung"/"Kết nối AI" — website đó tự gọi thẳng LeadBase, ký HMAC bằng `Website.secret` của chính nó (`system_design.md` §4.1).
- **(2b) LeadBase → 1 Website (đồng bộ sản phẩm)**: khi tenant thêm/sửa sản phẩm trong LeadBase, LeadBase chủ động gọi sang đúng Website đó qua domain công khai, đẩy giá/tồn kho/trạng thái, ký HMAC cùng `Website.secret` (`system_design.md` §4.2, xem §5 bên dưới).

**Ranh giới quyền hạn (quan trọng, đã chốt)**: LeadBase **không bao giờ đọc/ghi trực tiếp vào DB riêng của 1 Website** — kể cả (2b) cũng đi qua 1 API HTTP có kiểm soát, không phải query thẳng DB. LeadBase chỉ có 2 quyền hành động cấp hạ tầng: **tạo và xoá** (1). Mọi thứ khác diễn ra bên trong 1 Website (nội dung do tenant tự viết, đơn hàng đang xử lý, session khách) là việc riêng của nó.

## 2. Vì sao KHÔNG tách VPS (đảo ngược quyết định trước)

Bản thiết kế trước chủ trương tách VPS riêng cho site-engine để dễ dời sau này. Quyết định mới: **không tách**, lý do chính đáng hơn việc dễ dời — cơ chế SSL đơn giản hoá (§4) **chỉ hoạt động đúng khi mọi domain (Landing Page lẫn Website) đều trỏ về cùng 1 VPS** duy nhất của khách. Tách VPS sẽ phá vỡ giả định đó (Cloudflare Full mode cần 1 IP gốc nhất quán mà Nginx đang lắng nghe với cert dùng chung).

Muốn dời **1 website cụ thể** sang VPS khác vẫn làm được (dời thư mục app + dump/restore DB), nhưng từ lúc đó **SSL/domain của riêng website đó phải tự cấu hình tay** — không còn qua nút bấm UI LeadBase (đã nêu ở `PRD.md` §3.6). Đây là đánh đổi có chủ đích: đơn giản hoá cho trường hợp phổ biến (99% khách không cần tách VPS), chấp nhận phải làm tay cho trường hợp hiếm.

## 3. Provisioning 1 Website (LeadBase tự làm, không qua service trung gian)

```
Tenant bấm "Tạo Website" (domain, tên) trên UI LeadBase
  → Laravel (service mới, mirror LandingDomainProvisionService — xem system_design.md §2):
    1. mkdir /var/www/site-engine/{websiteId}
    2. unzip resources/site-engine/site-engine.zip  vào thư mục đó
    3. npm ci --omit=dev  (nếu zip không nhúng sẵn node_modules — quyết định lúc build, TBD)
    4. createdb site_engine_{websiteId}
    5. sinh SITE_ENGINE_SECRET ngẫu nhiên, lưu Website.secret (mã hoá, riêng từng Website —
       system_design.md §2), ghi file .env riêng cho instance (PORT, DATABASE_URL, secret vừa
       sinh — xem tech_doc.md §6)
    6. prisma migrate deploy  (chạy trên DB vừa tạo)
    7. systemctl enable --now site-engine-instance@{websiteId}   (systemd TEMPLATE UNIT)
    8. viết Nginx vhost cho domain, proxy_pass → 127.0.0.1:{port vừa cấp}, dùng chung
       cert Cloudflare Origin CA (§4) — không có bước "xin SSL" riêng, xong bước này là
       domain đã HTTPS được luôn
    9. nginx -t && nginx -s reload
  → cập nhật registry LeadBase: status = 'running' (hoặc 'failed' + provision_error nếu bước nào lỗi)
```

Không có webhook/API call nào ở đây — toàn bộ 9 bước chạy trong CÙNG 1 request/job phía Laravel (có thể queue hoá nếu cần, giống pattern `GenerateFanpageContentCalendar` đã dùng cho việc nặng khác trong repo) vì tất cả local, không có "phía bên kia" nào cần gọi qua mạng.

Mỗi instance là 1 `systemd` **template unit** (`site-engine-instance@.service`, `%i` = websiteId) — đúng tính năng systemd làm ra cho "chạy N bản của cùng 1 service, mỗi bản 1 tham số riêng".

**Xoá 1 Website** = ngược lại đúng 9 bước: `systemctl disable --now`, gỡ Nginx vhost, `dropdb`, `rm -rf` thư mục app — dọn sạch hoàn toàn, không để lại rác.

## 4. SSL — 1 cơ chế thống nhất cho MỌI domain (Cloudflare Full mode)

Thay hẳn cơ chế Certbot + phân nhánh "domain con LeadBase" vs "domain khách" mà Landing Page đang dùng (`LandingDomainProvisionService::isCrmSubdomain()`). **Site-engine áp dụng ngay từ đầu cơ chế mới, đơn giản hơn**:

```
Khách trỏ nameserver domain về Cloudflare + thêm DNS record trỏ IP VPS (bật proxy Cloudflare)
  → Cloudflare, ở chế độ SSL "Full": tự lo TLS phía trình duyệt bằng cert Cloudflare,
    và kết nối Cloudflare→origin (VPS) cũng qua HTTPS nhưng KHÔNG yêu cầu cert origin
    phải được CA công cộng xác thực (khác "Full (strict)")
  → VPS chỉ cần Nginx nghe 443 với BẤT KỲ cert nào hợp lệ về mặt kỹ thuật — dùng LUÔN
    1 cert Cloudflare Origin CA duy nhất cho MỌI vhost/domain, không cần cấp cert riêng
    từng domain
```

Hệ quả:
- **Không còn Certbot, không còn Let's Encrypt** trong luồng của site-engine.
- **Không còn phân nhánh** theo `is_subdomain_of(SITE_ENGINE_ROOT_DOMAIN)` như bản thiết kế trước — mọi domain (subdomain LeadBase hay domain khách tự mang vào) đi qua đúng 1 đường: thêm Nginx vhost dùng chung cert.
- **Không cần "Check DNS" / trạng thái `dns_pending` phức tạp** như Landing Page — vẫn nên kiểm tra domain đã trỏ đúng Cloudflare/VPS trước khi báo "xong" (tránh vhost trỏ vào domain chưa hoạt động), nhưng đây là 1 bước xác nhận đơn giản, không phải chờ cấp phát cert.
- Áp dụng đồng nhất cho **cả domain Landing Page lẫn domain Website** — về lâu dài `lead-base` có thể áp dụng lại chính cơ chế này cho Landing Page (đơn giản hoá luôn `LandingDomainProvisionService`), nhưng đó là việc của repo `lead-base`, ngoài phạm vi site-engine.

## 5. Đồng bộ sản phẩm (LeadBase → từng Website, push khi có thay đổi)

**Chốt (đảo ngược so với bản nháp đầu — hướng "pull-and-cache" bị bỏ)**: LeadBase là nguồn sự thật cho **giá, tồn kho, trạng thái**; mỗi Website là nguồn sự thật cho **nội dung hiển thị** (tên, mô tả, ảnh, SEO) của đúng sản phẩm đó trên trang của nó. Không tạo bảng `Product` độc lập lưu trữ song song toàn bộ dữ liệu — `ProductCache` (`system_design.md` §1) chỉ giữ 2 nhóm field tách bạch rõ chủ sở hữu.

```
Tenant thêm/sửa sản phẩm trong LeadBase
  → LeadBase gọi POST /api/products/sync sang đúng Website (qua domain công khai, ký HMAC
    Website.secret — system_design.md §4.2)
  → Sản phẩm MỚI (chưa từng có ở instance này): tạo ProductCache, publishStatus='draft',
    name = giá trị khởi tạo từ LeadBase — tenant phải tự vào /admin/products bổ sung
    mô tả/ảnh rồi Xuất bản, LeadBase không tự ghi đè các field này ở các lần sync sau
  → Sản phẩm ĐÃ CÓ (match leadbaseProductId): chỉ cập nhật price/salePrice/stock/leadbaseStatus
```

Đánh đổi so với hướng pull-and-cache (bị bỏ): LeadBase phải tự có hàng đợi/retry khi Website đang down lúc push (`system_design.md` §4.2, TBD cơ chế cụ thể) — bù lại giá/tồn kho hiển thị luôn tức thời khi Website online, không có độ trễ TTL như pull.

## 6. Xác thực tenant vào UI 1 Website (từ Phase 3)

Soạn bài viết/nội dung có **UI riêng trong chính app đã bung** (không nhúng trong LeadBase) — cần trải nghiệm soạn thảo thật. Giữ nguyên tắc **LeadBase là nguồn identity duy nhất**: Website không có form đăng ký/đăng nhập/mật khẩu riêng.

```
Tenant (đã login LeadBase) bấm "Quản lý nội dung" cho 1 Website cụ thể
  → LeadBase tra registry lấy đúng URL của Website đó
  → phát 1 token ngắn hạn, ký HMAC, chứa {tenantId, permissions, exp}
  → redirect sang đúng URL Website đó kèm token (vd https://domain-khach.../sso?token=...)
  → Website verify chữ ký + hạn dùng, tạo session (cookie, Prisma-backed trong DB CHÍNH NÓ)
  → tenant thao tác UI soạn bài trong session đó, hết hạn thì bấm lại nút bên LeadBase
```

Cơ chế bàn giao token này là **hạ tầng dùng chung**, không chỉ phục vụ riêng MCP — §7 (MCP) tái sử dụng đúng cơ chế này.

## 7. Tính năng MCP — kết nối AI (draft, chưa chốt nội dung)

LeadBase đã có sẵn hệ OAuth 2.1 + MCP hoàn chỉnh (Laravel Passport, RFC 8414/9728/7591/8707). Mỗi Website site-engine sẽ **mirror đúng bộ RFC này** để AI client (Claude...) kết nối đồng nhất dù đang nói chuyện với LeadBase hay 1 website cụ thể. Vì mỗi Website chỉ phục vụ đúng 1 domain, `aud` claim (RFC 8707) tự nhiên = base URL của chính nó — đơn giản hơn 1 service multi-tenant sẽ phải tự so khớp scope.

```
Tenant bấm "Kết nối AI" cho 1 Website (đã có session từ §6, hoặc bàn giao mới nếu chưa)
  → hiện consent screen (mirror UI "Cấp quyền kết nối AI" của LeadBase)
  → tenant Approve → Website cấp OAuth token (RFC 8707, aud = base URL của chính nó)
```

Chưa chốt chi tiết implement — xem `system_design.md` §9 (TBD) và `task_list.md` Phase 7.

## 8. Ranh giới trách nhiệm

| Việc | LeadBase | Từng Website |
|---|---|---|
| Lưu danh sách Website (tên, domain, trạng thái) | ✅ (registry) | ❌ |
| Tạo/xoá app + DB cho 1 Website | ✅ (tự shell, §3) | ❌ (không tự tạo/xoá chính mình) |
| Đọc/ghi DB của 1 Website sau khi đã tạo | ❌ (không được phép, `PRD.md` §3.4) | ✅ (chỉ chính nó) |
| Nội dung blog | ❌ | ✅ |
| Nội dung hiển thị sản phẩm (tên, mô tả, ảnh, SEO) | ❌ (chỉ set giá trị khởi tạo lúc tạo mới, §5) | ✅ |
| Giá / tồn kho / trạng thái sản phẩm — nguồn sự thật | ✅ (đẩy qua API §5, `system_design.md` §4.2) | ❌ (chỉ hiển thị, không sửa tay) |
| Giỏ hàng / checkout | ❌ | ✅ |
| Đơn hàng — nguồn sự thật | ✅ | ❌ (chỉ tạo rồi gửi đi) |
| SSL/domain — thực thi | ✅ (1 bước trong tạo Website, §4) | ❌ |
| Định danh tenant (login gốc, mật khẩu) | ✅ (duy nhất) | ❌ (chỉ nhận bàn giao token ngắn hạn) |
| UI soạn bài viết/nội dung | ❌ (chỉ có nút trỏ sang đúng Website) | ✅ |

## 9. Backup — mở rộng cơ chế backup sẵn có của LeadBase, không làm mới

`lead-base` đã có cơ chế backup thật đang chạy production: `scripts/crm-backup-db.sh` (cron 2h sáng hàng ngày) — `pg_dump` DB chính CRM + `storage/{app,data,landing-pages}` + `.env`, nén, upload Google Drive qua rclone, có retention local + remote. `site-engine` **tận dụng lại đúng cơ chế này**, không dựng backup riêng:

- **DB từng Website (`site_engine_{websiteId}`) — PHẢI thêm vào phạm vi backup.** Đây là dữ liệu không tái tạo được (bài viết, tài khoản khách hàng, đơn hàng đang chờ gửi) — script cần loop qua mọi DB có prefix `site_engine_` và `pg_dump` từng cái, giống hệt cách nó đang dump DB chính.
- **Thư mục code app (`/var/www/site-engine/{websiteId}`) — KHÔNG cần backup.** Dựng lại được bất cứ lúc nào bằng cách bung lại `site-engine.zip` + `prisma migrate deploy` — không có dữ liệu riêng nào nằm ở đây ngoài code.
- **Thư mục deploy Landing Page (`/var/www/{domain}/{slug}`) — cũng KHÔNG cần thêm** (đã đúng như hiện tại) — bản `storage/landing-pages` (draft, nguồn thật) đã nằm trong phạm vi backup sẵn có, và `deploy()` chạy lại là dựng ra đúng bản `/var/www` — không mất gì nếu chỉ backup draft.

Tóm lại: chỉ cần **1 thay đổi** ở `crm-backup-db.sh` (thêm vòng lặp `pg_dump` theo mọi DB `site_engine_*`) là đủ phủ toàn bộ dữ liệu quan trọng của cả Landing Page lẫn Website — không cần 1 script backup riêng cho site-engine.
