# Trí nhớ theme (đọc bởi AI editor mỗi lượt chat — xem services/themeMemory.ts)

## Cây thư mục
- layout.liquid — Khung bao ngoai moi trang — <head>, goi header/footer, cho block content chen vao giua.
- header.liquid — Thanh dieu huong dau trang.
- footer.liquid — Chan trang.
- home.liquid — Trang chu — hero + bai viet moi + san pham moi.
- blog-list.liquid — Danh sach bai viet, co phan trang.
- blog-post.liquid — Chi tiet 1 bai viet.
- blog-category.liquid — Trang danh muc bai viet.
- blog-post-locked.liquid — Man hinh nhap mat khau xem bai viet bi khoa.
- page.liquid — Trang tinh (Gioi thieu, Lien he...).
- products-list.liquid — Danh sach san pham, co phan trang.
- product-category.liquid — Trang danh muc san pham.
- product-detail.liquid — Chi tiet 1 san pham — co the co bien the (mau/size).
- cart.liquid — Trang gio hang + checkout.
- order-confirmation.liquid — Trang xac nhan sau khi dat hang thanh cong.
- custom-content.liquid — Che do 'Tuy bien' cua Post/Page/Product - van co header/footer nhung noi dung render THO, khong qua khung tieu de/danh muc chuan.
- landing.liquid — Che do 'Landing page' cua Post/Page/Product - KHONG header/footer/layout gi ca, trang doc lap hoan toan.
- 404.liquid — Trang khong tim thay (404) - dung cho moi URL/slug/id khong ton tai tren toan site.
- custom-fields.liquid — Partial hien bang key-value cho truong tuy bien admin tu dat.

Mỗi file .liquid ở trên có 1 cặp file CSS/JS riêng đi kèm (assets/sources/{tên}.css và .js, {tên} = tên file .liquid bỏ đuôi) — chỉ ảnh hưởng đúng trang đó. TỰ CHỌN đúng file cần sửa trong 3 file này (không bắt buộc chọn cả 3).
assets/custom.css và assets/custom.js là file BUILD tự động (gộp + nén từ toàn bộ file nguồn CSS/JS) — KHÔNG được chọn 2 file này để sửa trực tiếp.

## Quy ước & gu thẩm mỹ chung

REDESIGN_BRIEF: Phong cách: Chuyên nghiệp, hiện đại, chuẩn công nghệ (SaaS vận hành doanh nghiệp với AI). Màu chủ đạo: Xanh navy. Cấu trúc: Giữ nguyên các tính năng chuẩn (trang chủ, blog, sản phẩm/bảng giá, trang tĩnh) và tối ưu giao diện để trình bày giải pháp phần mềm.

## Đã áp dụng

- layout.liquid: Đặt màu nền xám nhạt, font Inter, cấu trúc flexbox đẩy footer xuống đáy.
- header/footer: Giao diện nền tối/xanh navy, menu responsive, bố cục chuẩn SaaS.
- index.liquid: Hero section gradient, card bảng giá sản phẩm, lưới bài viết nổi bật.
- blog/product (danh sách & danh mục): Hiển thị dạng lưới thẻ bo góc, có hiệu ứng hover và JS định dạng.
- blog-post/product-detail: Bố cục chia cột hiện đại, form tương tác dạng thẻ, có thanh tiến trình đọc.
- cart/checkout: Chia 2 cột, định dạng tiền tệ tự động bằng JS, thêm trường ghi chú đơn hàng.
- custom-content/landing: Định dạng typography an toàn (bảng cuộn, video responsive) không đè class Tailwind gốc.
- 404/password/success: Giao diện dạng thẻ (card) căn giữa màn hình, thêm animation và icon minh họa.
- custom-fields: Dạng danh sách bo góc, tự động ẩn nếu rỗng, có icon và hiệu ứng highlight khi click.
