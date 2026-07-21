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
(chưa có)

## Đã áp dụng

- layout.liquid: Thêm font Playfair/Inter, cấu hình màu gỗ/kem Tailwind, bố cục flex.
- header.liquid: Tone màu nâu/kem, menu mobile, hiệu ứng hover gạch chân.
- footer.liquid: Nền nâu gỗ, chữ kem, chia cột thông tin.
- index.liquid: Banner hero, danh sách sản phẩm/bài viết, hiệu ứng fade-in.
- blog.liquid: Lưới bài viết, tone nâu/kem, fade-in, phân trang.
- blog-post.liquid: Bố cục canh giữa, tone nâu/kem, định dạng HTML thô, fade-in.
- blog-category.liquid: Lưới 3 cột, tag bo góc, fade-in.
- blog-post-locked.liquid: Box mật khẩu canh giữa, tone nâu/kem, icon khóa, fade-in.
- page.liquid: Bố cục canh giữa, tone nâu/kem, định dạng HTML thô.
- products.liquid: Lưới 4 cột, tone nâu/kem, hover phóng to, nhãn giảm giá.
- product-category.liquid: Lưới 4 cột, tone nâu/kem, hover ảnh.
- product-detail.liquid: Layout 2 cột, tone nâu/kem, gallery, biến thể, form đánh giá.
- cart.liquid: Layout 2 cột giỏ hàng & thanh toán, tone nâu/kem, form nhập liệu bo góc, xử lý giỏ hàng trống.
