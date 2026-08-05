# Hướng dẫn nhanh menu Admin

File này được đọc bởi tool `get_menu_help` (`src/agents/tools/assistantTools.ts`) - AI trợ lý
trong admin (icon chat góc dưới) dùng nó để trả lời "tính năng X ở đâu/dùng sao" mà không cần
đoán mò. **Mỗi heading `##` PHẢI viết giống hệt tên hiển thị trên menu sidebar**
(`views/admin/layout.liquid`) - đổi tên menu ở đó thì phải đổi heading tương ứng ở đây, nếu không
tool sẽ không khớp được nữa.

## Bài viết

Quản lý bài viết blog (loại `post`): tạo/sửa/xoá, soạn nội dung dạng WYSIWYG hoặc HTML thô, chọn
ảnh đại diện, gắn Phân loại, đặt SEO (title/description/OG), lên lịch xuất bản (draft/published).
Vào **Bài viết > Thêm mới** để viết bài; bài `draft` không hiển thị ngoài site cho tới khi chuyển
sang `published`.

## Phân loại

Danh mục dùng riêng cho Bài viết (khác "Danh mục" của Sản phẩm bên dưới) - tạo cây danh mục để gắn
vào bài viết, hiển thị dạng breadcrumb/menu ngoài site. Sửa tên/slug ở đây sẽ tự tạo redirect 301
từ slug cũ (xem mục Chuyển hướng).

## Trang

Trang tĩnh (loại `page`, vd Giới thiệu, Chính sách, Liên hệ...) - không thuộc luồng thời gian như
Bài viết, không có danh mục. Soạn nội dung tương tự Bài viết, đặt URL riêng (`pageSlugPrefix`, mặc
định `/p/:slug`).

## Media

Thư viện ảnh dùng chung cho Bài viết/Trang/Sản phẩm. Tải ảnh lên (tự động resize/nén, có thể crop
trước khi tải), hoặc **Nhập từ .zip** để nhập hàng loạt ảnh (vd nén thư mục `wp-content/uploads`
từ site WordPress cũ) - server tự giải nén, kiểm tra định dạng thật của từng file trước khi lưu.
Nếu đã cấu hình Cloudflare R2 (Cài đặt chung), ảnh mới tải lên tự động đẩy thẳng lên R2; nút
**Chuyển ảnh sang R2** dùng để chuyển nốt ảnh cũ đang lưu trên VPS. Xoá ảnh bị chặn nếu ảnh đang
được dùng ở nơi khác trên site (báo rõ đang dùng ở đâu).

## Sản phẩm

Quản lý sản phẩm bán hàng (chỉ hiện khi site chạy chế độ `ecommerce`): tên, mô tả, giá/giá khuyến
mãi, tồn kho, ảnh, biến thể. Có thể nhập hàng loạt qua **Import** (file WooCommerce .xml).

## Danh mục

Danh mục dùng riêng cho Sản phẩm (khác "Phân loại" của Bài viết) - tổ chức sản phẩm theo cây danh
mục, hiển thị trên trang danh mục/menu ngoài site.

## Đơn hàng

Xem/xử lý đơn hàng khách đặt: cập nhật trạng thái (đang xử lý/đã giao/huỷ...), xem thông tin giao
hàng, lịch sử thanh toán. Đơn tạo tự động khi khách checkout ngoài site hoặc khi AI CSKH chốt đơn
qua chat.

## Đánh giá

Duyệt đánh giá (review) khách để lại cho sản phẩm - ẩn/hiện, xoá đánh giá spam, xem ảnh khách đính
kèm.

## Thanh toán

Cấu hình cổng thanh toán (vd VNPay): mã merchant, secret key, bật/tắt phương thức. Chỉ role
**admin** thấy mục này vì chứa thông tin nhạy cảm.

## Giao nhận

Cấu hình phí/phương thức vận chuyển, khu vực giao hàng, ngưỡng miễn phí ship.

## Mã giảm giá

Tạo/sửa mã coupon: % hoặc số tiền giảm cố định, điều kiện áp dụng (đơn tối thiểu, giới hạn lượt
dùng, hạn sử dụng).

## AI Agent

Quản lý các AI Agent của hệ thống (system prompt, tool được phép dùng, model/provider). Chỉ role
**admin** thấy mục này - đây là nơi cấu hình "bộ não" cho AI CSKH, AI Automation, trợ lý admin...
Sửa sai ở đây có thể làm AI ngừng hoạt động đúng, cần cẩn trọng.

## AI Automation

Lên lịch chạy tự động 1 yêu cầu cho AI Agent (vd "mỗi sáng 7h tìm bài viết mới về X, viết nháp") -
tạo lịch (cron), chọn Agent phụ trách, xem lịch sử lần chạy trước.

## Giao diện

Chỉnh theme đang dùng cho site (chọn theme, sửa file .liquid/.css/.js qua AI Developer Agent hoặc
tay), preview trước khi áp dụng công khai. Chỉ role **admin**.

## Live Chat

Xem trực tiếp các phiên chat của khách với AI CSKH trên site công khai (widget góc dưới trang
khách xem) - theo dõi hội thoại, can thiệp thủ công nếu cần. Chỉ role **admin**.

## Plugins

Trang placeholder - hệ thống plugin động (chạy code ngoài, không sandbox) đã bị gỡ bỏ vì rủi ro
bảo mật (đọc/ghi file, lộ secret không kiểm soát được). Tính năng CSKH trước đây là 1 plugin nay
đã thành core feature (mục Live Chat). Chưa có tính năng thay thế ở đây.

## Người dùng

Quản lý tài khoản đăng nhập admin: tạo user mới, đổi role (admin/manager/edit), khoá/xoá tài
khoản. Chỉ role **admin**.

## Cài đặt chung

Cấu hình toàn site: tên site/logo/favicon, thông tin liên hệ, social links, loại site (blog/
ecommerce), tracking (Google Analytics/Facebook Pixel), Cloudflare Turnstile (chống spam), Cloudflare
R2 (lưu ảnh), chọn AI Agent phụ trách CSKH/trợ lý admin. Chỉ role **admin**.

## Chuyển hướng

Xem/thêm redirect (301) thủ công - vd domain cũ trỏ sang URL ngoài. Phần lớn redirect được hệ
thống tự tạo khi đổi slug bài viết/trang/sản phẩm, mục này chỉ để xem lại hoặc bổ sung case đặc
biệt.

## Import

Nhập nội dung hàng loạt từ file export WordPress (.xml, Tools > Export): hỗ trợ bài viết, trang
tĩnh, và sản phẩm WooCommerce trong cùng 1 file. URL ảnh trong nội dung được tự động quy về đường
dẫn nội bộ (`/uploads/...`) nếu trỏ tới `wp-content/uploads` - để ảnh hiển thị đúng, cần giải nén
sẵn thư mục `uploads` đó qua mục **Media > Nhập từ .zip** (làm trước hoặc sau khi import .xml đều
được, miễn cả 2 bước cùng làm).
