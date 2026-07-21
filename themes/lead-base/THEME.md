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

Max-width container toàn site: 1200px. Font: Inter. Màu brand: #2563eb / dark #1d4ed8. Phong cách: SaaS — clean, chuyên nghiệp, hiện đại. Header: sticky, đổ bóng nổi, animation/transition mượt cho nav items và CTA button. Mobile: hamburger icon bên phải header, bấm mở drawer trượt từ bên trái với các tab menu. Header CTA: icon cart SVG với badge số lượng sản phẩm trong giỏ hàng. Cart icon: bấm mở drawer bên phải hiển thị danh sách sản phẩm (ảnh, tên, giá, số lượng) và nút "Thanh toán" sticky bottom chuyển sang /cart. Nút "Thêm vào giỏ hàng" và nút "Thanh toán/Đặt hàng": màu cam đậm, chữ trắng. Hiệu ứng nhấp nháy (flash animation) cho giá tiền khi thay đổi biến thể trên trang sản phẩm.

## Đã áp dụng

- header: sticky, menu trượt trái, giỏ hàng trượt phải (drawer) render danh sách sản phẩm từ localStorage, nút thanh toán màu cam.
- cart: nút Đặt hàng màu xanh dương, thanh toán vạch kẻ gradient, tiêu đề xám.
- product-detail: nút Thêm vào giỏ cam đậm, nút Mua ngay viền xanh lá (hover nền xanh lá), nút Xác nhận đặt hàng xanh dương, giá nhấp nháy.
- layout: max-width 1200px, font Inter, màu brand #2563eb.
