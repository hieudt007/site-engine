# AI Assistant Knowledge Base

## How to use READ_FIELDS
You can use `request_fields` action to read the contents of input elements on the current page. You MUST provide an array of `fields` containing HTML IDs.

## How to use FILL_FORM
You can use `fill_form` action to write data into input elements on the current page. You MUST provide a `data` object where keys are HTML IDs and values are the new data.

## Designing a new Layout
When the user asks to create a new layout, write a detailed layout blueprint in the `body` field. The Developer Agent will read this blueprint and generate HTML later.

## HTML Generation
When generating HTML, use semantic tags and TailwindCSS classes. Do not wrap the output in Markdown code blocks.

## Loại website: Blog hay Bán hàng
Website có 2 chế độ, đổi ở Cài đặt chung > `siteType`:
- `blog`: chỉ viết bài, không có tính năng bán hàng. Toàn bộ URL/menu/API liên quan sản phẩm, giỏ hàng, đơn hàng, thanh toán, vận chuyển đều bị chặn (trả 404) kể cả gõ đúng đường dẫn — không chỉ ẩn menu.
- `ecommerce`: bật đầy đủ sản phẩm, giỏ hàng, thanh toán, vận chuyển, mã giảm giá, cửa hàng.
Nếu người dùng hỏi vì sao trang sản phẩm/giỏ hàng bị 404, việc đầu tiên cần kiểm tra là `siteType` đang để `blog`.

## Bài viết (Blog)
Bài viết (`type: post`) và Trang tĩnh (`type: page`) dùng chung 1 model nhưng tách route riêng (`/admin/posts`, `/admin/pages`). Mỗi bài có: tiêu đề, slug (tự sinh từ tiêu đề, sửa được), excerpt, nội dung, ảnh đại diện, danh mục, chủ đề (topic), trạng thái (`draft`/`published`/lên lịch), SEO (title/description riêng, tự tạo Schema.org JSON-LD BlogPosting), custom field tự do. Có lịch sử chỉnh sửa (revision) — khôi phục được bản cũ. Lên lịch xuất bản (publish sau 1 thời điểm) chạy qua cron nền (`publishScheduler`).

## Sản phẩm
Dữ liệu giá/tồn kho/trạng thái sản phẩm được đồng bộ 1 CHIỀU từ LeadBase xuống (không sửa được giá/tồn trực tiếp trong site-engine — sửa phải làm bên LeadBase). site-engine chỉ tự quản phần **nội dung hiển thị**: excerpt/mô tả dài, ảnh, SEO, thông số kỹ thuật (specs), biến thể (variant — mỗi biến thể có SKU/giá/tồn riêng đồng bộ từ LeadBase). Có đánh giá (review) sao + bình luận của khách, admin duyệt (`pending`/`approved`) trước khi hiển thị công khai; điểm rating trung bình được tính tự động (product­RatingAggregate).

## Danh mục & Chủ đề
Category dùng chung cho cả bài viết lẫn sản phẩm (`type: post`/`type: product`), có phân cấp cha-con, đường dẫn riêng theo prefix (`/{prefix}/danh-muc/{slug}`). Topic là gắn thẻ chủ đề cho bài viết, không phân cấp.

## Giỏ hàng & Đặt hàng
Khách thêm sản phẩm vào giỏ, checkout không bắt buộc tạo tài khoản. Đơn hàng (CartOrder) lưu tên/SĐT/địa chỉ khách, phương thức thanh toán, phương thức nhận hàng, trạng thái đơn và trạng thái thanh toán riêng biệt. Sau khi tạo đơn thành công, site-engine tự gửi đơn NGƯỢC lại LeadBase qua API ký HMAC (không cần thao tác tay); nếu gửi thất bại có cơ chế tự retry chạy nền — đơn ở trạng thái `failed` là đơn gửi LeadBase chưa thành công, cần theo dõi ở Dashboard admin.

## Thanh toán
3 phương thức, bật/tắt độc lập ở Cài đặt > Thanh toán:
- **COD** (thanh toán khi nhận hàng) — không cần cấu hình gì thêm.
- **Chuyển khoản ngân hàng** — cần điền tên ngân hàng, số tài khoản, chủ tài khoản, chi nhánh, có thể đính kèm ảnh QR để khách quét chuyển khoản.
- **VNPay** — cần Mã website (TMN Code) và Chuỗi bí mật (Hash Secret) do VNPay cấp, có chế độ Sandbox (thử nghiệm) để test trước khi dùng thật. Thanh toán qua redirect sang VNPay rồi VNPay gọi ngược (IPN) để xác nhận.

## Vận chuyển
Phí ship cấu hình theo QUY TẮC theo tỉnh/thành ở Cài đặt > Vận chuyển: mỗi quy tắc gồm tên, danh sách tỉnh/thành áp dụng, phí cơ bản, và ngưỡng miễn phí ship (đơn hàng từ X đồng trở lên thì ship 0đ) — để trống ngưỡng nếu không áp dụng miễn phí ship. Ngoài giao tận nơi, còn có phương thức "Nhận tại cửa hàng" — quản lý danh sách cửa hàng (tên, địa chỉ, tỉnh/thành, SĐT) ở mục Cửa hàng, khách chọn cửa hàng lúc checkout thay vì nhập địa chỉ giao.

## Mã giảm giá
Coupon có: mã (tự động viết hoa), loại giảm (`percent` = theo %, hoặc `fixed` = số tiền cố định), giá trị giảm, đơn tối thiểu để áp dụng (tuỳ chọn), số lần dùng tối đa (để trống = không giới hạn), ngày hết hạn (tuỳ chọn), bật/tắt.

## Theme & giao diện
Giao diện dựng bằng Liquid + Tailwind, không cần build lại khi sửa — sửa xong là thấy ngay. 2 cách chỉnh:
- **Trình sửa nhanh (inline click-to-edit)**: click trực tiếp vào chữ/ảnh trên trang để sửa nội dung tĩnh, không đổi cấu trúc/bố cục.
- **AI Chat thiết kế lại (Developer Agent)**: chỉ dùng được khi đang ở trang Quản lý Theme (`/admin/settings/theme`) — có thể yêu cầu redesign cả trang, AI tự tra bảng màu/font/phong cách phù hợp theo ngành hàng của site.
Mỗi website chỉ có 1 theme đang active tại 1 thời điểm (đổi ở trang Quản lý Theme); có thể xem trước (preview) theme khác trước khi kích hoạt.

## SEO
Tự động tạo Schema.org/JSON-LD cho tổ chức, bài viết, sản phẩm; sitemap.xml và RSS tự sinh, không cần cấu hình tay. Mỗi bài viết/trang/sản phẩm có SEO title/description riêng, override mặc định nếu điền. Cài đặt > Chung có thêm: ảnh OG mặc định, mã xác minh Google Search Console (`gscVerificationId`).

## Menu
Có 2 vị trí menu cố định: Header và Footer, mỗi menu là danh sách mục (item) sắp xếp thứ tự tự do, mỗi mục trỏ tới 1 URL (nội bộ hoặc ngoài) hoặc trang/danh mục có sẵn.

## Media / Thư viện ảnh
Upload ảnh/tệp qua thư viện chung, mỗi tệp có trường `alt` riêng (ảnh SEO/accessibility) — nên nhắc người dùng điền `alt` khi upload ảnh sản phẩm/bài viết.

## Redirect (chuyển hướng URL)
Khai báo cặp URL cũ → URL mới kèm mã trạng thái HTTP (301/302) — dùng khi đổi đường dẫn 1 bài viết/trang/sản phẩm để tránh mất SEO/link chết.

## Vai trò người dùng & đăng nhập
Đăng nhập admin đi qua tài khoản LeadBase (OAuth), không có mật khẩu riêng cho site-engine. 3 vai trò theo thứ bậc tăng dần: `edit` (biên tập cơ bản) < `manager` < `admin` (toàn quyền, bao gồm Cài đặt chung/Thanh toán/Vận chuyển — 2 vai trò còn lại không đụng được các mục này). Một tài khoản chỉ đăng nhập được 1 thiết bị tại 1 thời điểm — đăng nhập ở thiết bị mới sẽ tự đăng xuất phiên cũ.

## Tracking / Đo lường
Cài đặt > Chung cho phép gắn Google Analytics (mã GA), Facebook Pixel (mã Pixel), và 1 đoạn script tuỳ ý khác (custom head script — chèn nguyên văn vào `<head>` mọi trang, dùng cho TikTok Pixel/Hotjar/... không có ô riêng).

## Plugin (tính năng mở rộng)
Các tính năng như widget chat AI cho khách, chat hỗ trợ khách hàng... được cài dưới dạng Plugin, bật/tắt độc lập ở trang Quản lý Plugin — tắt 1 plugin thì toàn bộ widget/route của nó biến mất khỏi site ngay, không cần khởi động lại.

## Đường dẫn URL (prefix)
Tiền tố URL cho bài viết/trang/sản phẩm (mặc định `/blog/...`, `/p/...`, `/product/...`) đổi được ở Cài đặt > Chung, không được để 2 prefix trùng nhau (hệ thống tự chặn khi lưu).
