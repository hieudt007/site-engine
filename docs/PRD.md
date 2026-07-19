# PRD — site-engine

## 1. Bối cảnh

LeadBase (repo `lead-base`, Laravel CRM, chạy trên VPS riêng của từng khách cùng 9router) hiện có tính năng **Landing Page**: tạo trang giới thiệu tĩnh, gắn domain, tự xin SSL, deploy. Nó phù hợp cho 1 trang bán hàng đơn giản, nhưng không đáp ứng được nhu cầu mới: một **website đầy đủ** (blog + danh mục sản phẩm + đặt hàng/thanh toán) mà nội dung thay đổi liên tục — không thể là file tĩnh generate-once như landing page.

`site-engine` là sản phẩm mới giải quyết nhu cầu này — **đóng gói thành 1 gói mã nguồn (zip) nhúng ngay trong repo `lead-base`**, không phải 1 service/repo triển khai độc lập.

## 2. Vấn đề cần giải quyết

- Tenant LeadBase muốn có 1 website riêng (blog + sản phẩm + giỏ hàng/đặt hàng) gắn domain của họ (hoặc subdomain LeadBase), quản lý được từ UI LeadBase — **giống trải nghiệm tạo Landing Page**, nhưng nội dung là động (CMS thật) chứ không phải export tĩnh 1 lần.
- Đơn hàng phát sinh trên website phải "đổ về" LeadBase để chủ shop xử lý bằng đúng quy trình CRM sẵn có (không phải 1 hệ thống đơn hàng song song).
- Mỗi website phải cô lập hoàn toàn (app + DB riêng) — lỗi/crash 1 website không ảnh hưởng website khác hay chính LeadBase.

## 3. Nguyên tắc thiết kế (đã chốt qua thảo luận)

1. **Cùng 1 VPS với LeadBase.** Không tách VPS riêng cho site-engine (đảo ngược so với phiên bản thiết kế trước) — mỗi VPS khách chạy LeadBase + 9router + toàn bộ website (site-engine instance) của chính khách đó. SSL đơn giản hoá được chính là nhờ giả định "cùng máy" này (xem #5).
2. **Đóng gói thành 1 file zip, nhúng trong repo `lead-base`.** `site-engine` không phải 1 repo/service deploy riêng — là 1 gói mã nguồn (build sẵn) nằm trong `lead-base` (vd `resources/site-engine/site-engine.zip`). Khi tạo Website mới, LeadBase **tự bung (unzip)** gói này thành 1 thư mục ứng dụng mới trên chính VPS đó.
3. **Mỗi Website = 1 app instance + 1 database riêng, cô lập hoàn toàn** (không phải 1 service multi-tenant dùng chung DB). Giống mỗi site là 1 bản cài độc lập (kiểu từng site WordPress riêng) — không bảng nào trong DB của 1 website chứa dữ liệu website khác, vì bung ra thư mục + DB riêng biệt vật lý.
4. **LeadBase (Laravel) tự thực hiện việc tạo/xoá — không qua dịch vụ trung gian nào.** Không có "Orchestrator" là 1 process Node riêng — vì cùng VPS rồi, Laravel shell thẳng lệnh (bung zip, tạo DB, chạy migration, khởi động service, sửa Nginx) y hệt cách `LandingDomainProvisionService` đang shell ra script cho Landing Page. **LeadBase chỉ có quyền khởi tạo và xoá — không bao giờ đọc/ghi trực tiếp vào database của 1 instance sau khi nó đã chạy.** Mọi giao tiếp nghiệp vụ sau đó đi qua đúng 2 API HTTP ký HMAC, mỗi API 1 chiều rõ ràng, không chiều nào chạm thẳng DB phía kia:
   - Website → LeadBase: đơn hàng, bàn giao định danh.
   - LeadBase → Website: đồng bộ giá/tồn kho/trạng thái sản phẩm (xem #9) — LeadBase gọi qua domain công khai của chính Website đó, không phải đọc/ghi DB.
5. **SSL dùng chung 1 cơ chế cho MỌI domain — Cloudflare "Full" mode, không còn Certbot.** Khách trỏ nameserver domain về Cloudflare + trỏ DNS record về IP VPS (qua Cloudflare proxy) → Cloudflare tự lo TLS phía trình duyệt, và chấp nhận kết nối origin bằng bất kỳ cert nào (không cần CA công cộng xác thực) ở chế độ Full. Vì vậy VPS chỉ cần **1 cert origin duy nhất dùng chung cho mọi domain** (Cloudflare Origin CA sẵn có) + cấu hình Nginx routing — không còn phân biệt "domain con LeadBase" vs "domain khách mang vào" như thiết kế Landing Page hiện tại, không còn gọi Let's Encrypt/Certbot. Áp dụng đồng nhất cho cả domain Landing Page lẫn domain Website (site-engine).
6. **Đúng vì lý do #5**: tính năng "Xin SSL qua UI LeadBase" **chỉ hoạt động khi site-engine cùng VPS với LeadBase** — nếu sau này 1 khách hàng đặc biệt muốn tách 1 website sang VPS khác, việc đó làm được về mặt kỹ thuật (dời DB + thư mục app) nhưng **SSL/domain lúc đó phải tự cấu hình tay, không còn qua nút bấm UI LeadBase nữa** — giữ đúng tính toàn vẹn của luồng Cloudflare Full mode (vốn giả định mọi domain đều trỏ về đúng 1 VPS).
7. **Đơn hàng chảy một chiều: từng instance website → LeadBase trực tiếp**, ký HMAC (cùng kiểu chữ ký facebook-gateway ↔ chatbot-lite/CRM đang dùng).
8. **Stack**: Node.js + Fastify + Prisma + PostgreSQL cho gói app-mẫu — khớp `chatbot-lite`/`facebook-gateway`.

## 4. Đối tượng sử dụng

- **Chủ shop / tenant LeadBase**: tạo và quản lý Website của họ từ UI LeadBase (tạo bài viết, chọn sản phẩm hiển thị, xem đơn hàng — đơn hàng vẫn nằm trong CRM LeadBase như bình thường).
- **Khách mua hàng cuối** (end customer): truy cập website qua domain riêng, đọc blog, xem sản phẩm, đặt hàng/thanh toán.
- **Admin vận hành hạ tầng**: chuẩn bị VPS (đã có sẵn cho LeadBase), không cần hạ tầng riêng cho site-engine nữa.

## 5. Phạm vi MVP (Phase 1)

**Có:**
- CRUD Website (domain, tên, trạng thái) — 1 website / domain, nhiều website / tenant.
- Bung gói zip thành 1 instance mới khi tạo Website, xoá sạch (app + DB) khi xoá Website.
- Domain routing qua Nginx (LeadBase tự cấu hình vhost), SSL dùng chung 1 cert Cloudflare Origin CA cho mọi domain (§3.5) — không còn state machine `ssl_status` riêng biệt phức tạp như Landing Page (chỉ còn "đã cấu hình Nginx" hay chưa).
- Blog: CRUD bài viết (title, slug, nội dung, SEO cơ bản, published_at).
- Sản phẩm: hiển thị catalog trên website (đồng bộ/tham chiếu từ sản phẩm LeadBase — xem `system_design.md` để chọn hướng).
- Giỏ hàng + checkout cơ bản (không thanh toán online ở MVP — nhận đơn kiểu COD/chuyển khoản thủ công, giống hành vi order-from-landing-page hiện tại).
- Đơn hàng tạo trên instance → gọi API tạo Order thật trong LeadBase (ký HMAC, theo mẫu `LandingOrderController`).

**Chưa có (Phase sau):**
- Cổng thanh toán online (VNPay/MoMo/ZaloPay).
- Theme/giao diện tuỳ chỉnh nhiều mẫu — MVP dùng 1 theme mặc định.
- Đa ngôn ngữ cho nội dung website (site-engine UI/admin có thể có, nhưng nội dung khách nhập thì chưa).
- Tồn kho/khuyến mãi phức tạp.
- Tách 1 website riêng sang VPS khác (làm được về kỹ thuật nhưng ngoài phạm vi tự động hoá UI, xem §3.6).

## 6. Tiêu chí thành công

- Tạo 1 Website mới từ UI LeadBase, gắn domain thật (khách đã trỏ nameserver Cloudflare + DNS), domain truy cập được qua HTTPS ngay — không cần SSH tay vào VPS, không cần bấm "Xin SSL" riêng (khác Landing Page — ở đây SSL có sẵn ngay khi Nginx route xong, nhờ Cloudflare Full mode).
- Đặt 1 đơn hàng thử trên website → đơn xuất hiện đúng trong LeadBase CRM với đầy đủ thông tin khách, sản phẩm, không trùng lặp.
- Xoá 1 Website → app + DB bị dọn sạch hoàn toàn, không để lại tiến trình/file rác trên VPS; các Website khác và LeadBase không bị ảnh hưởng.
