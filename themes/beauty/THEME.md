# Trí nhớ theme (đọc bởi AI editor mỗi lượt chat — xem services/themeMemory.ts)

## Cây thư mục
- layout.liquid — Khung bao ngoai moi trang — <head>, goi header/footer, cho block content chen vao giua.
- header.liquid — Thanh dieu huong dau trang.
- footer.liquid — Chan trang.
- home.liquid — Trang chu — hero + bai viet moi + san pham moi.
- blog-list.liquid — Danh sach bai viet, co phan trang.
- blog-post.liquid — Chi tiet 1 bai viet.
- blog-category.liquid — Trang phan loai bai viet (danh muc hoac chu de).
- blog-post-locked.liquid — Man hinh nhap mat khau xem bai viet bi khoa.
- page.liquid — Trang tinh (Gioi thieu, Lien he...).
- products-list.liquid — Danh sach san pham, co phan trang.
- product-category.liquid — Trang phan loai san pham (danh muc hoac thuong hieu).
- search.liquid — Trang tim kiem public cho bai viet, trang tinh va san pham.
- product-detail.liquid — Chi tiet 1 san pham — file chinh quyet dinh layout va render cac block chuc nang.
- components/product/media.liquid — Khoi anh san pham.
- components/product/info.liquid — Khoi thong tin dinh danh san pham.
- components/product/purchase.liquid — Khoi mua hang, gia, bien the, them gio va mua ngay.
- components/product/content.liquid — Khoi noi dung dai, thong so, FAQ, custom fields va danh gia cua san pham.
- components/product/related.liquid — Khoi san pham lien quan dung cho upsell/cross-sell.
- components/common/cart-drawer.liquid — Mini cart hien thi dang drawer hoac popup.
- checkout.liquid — Trang thanh toán don hang (checkout).
- order-confirmation.liquid — Trang xac nhan sau khi dat hang thanh cong.
- 404.liquid — Trang khong tim thay (404) - dung cho moi URL/slug/id khong ton tai tren toan site.
- custom-fields.liquid — Partial hien bang key-value cho truong tuy bien admin tu dat.
- components/common/breadcrumb.liquid — Breadcrumb dung chung toan site, style theo breadcrumbVariant.
- components/common/pagination.liquid — Pagination dung chung cho cac trang danh sach trong theme.
- components/product/card.liquid — Card san pham dung chung cho home, product list, product category va cac khu san pham lien quan.
- components/post/card.liquid — Card bai viet dung chung cho home, blog list va blog category/topic.

Mỗi file .liquid ở trên có 1 cặp file CSS/JS riêng đi kèm (assets/sources/{tên}.css và .js, {tên} = tên file .liquid bỏ đuôi) — chỉ ảnh hưởng đúng trang/component đó. Khi phân loại, chọn file chính liên quan nhất; server sẽ tự mở kèm cặp CSS/JS cùng nhóm ở bước sửa.

Bản đồ chọn file cho trang sản phẩm:
- Sắp xếp/vị trí các khối lớn của trang chi tiết sản phẩm: product-detail.liquid.
- Ảnh/gallery/fallback ảnh sản phẩm: components/product/media.liquid.
- Tên, danh mục, thông tin nhận diện/ngắn của sản phẩm: components/product/info.liquid.
- Giá, biến thể, tồn kho, thêm giỏ, mua ngay, form mua ngay: components/product/purchase.liquid.
- Mô tả dài, thông số, FAQ, custom fields, đánh giá/list review/form review: components/product/content.liquid.
- Upsell/cross-sell/cụm sản phẩm liên quan trong trang chi tiết: components/product/related.liquid.
- Card sản phẩm xuất hiện ở trang chủ, danh sách, danh mục, tìm kiếm, related: components/product/card.liquid.
assets/custom.css và assets/custom.js là file BUILD tự động (gộp + nén từ toàn bộ file nguồn CSS/JS) — KHÔNG được chọn 2 file này để sửa trực tiếp.

## Quy ước & gu thẩm mỹ chung

REDESIGN_BRIEF: Giao diện: Hiện đại, tối giản, sang trọng, màu xanh lá cây chủ đạo. Ngành hàng: Mỹ phẩm thiên nhiên cao cấp. Tính năng: Đầy đủ các trang TMĐT cơ bản và Blog, kèm hiệu ứng animation số lượng bay từ nút mua hàng lên icon giỏ hàng ở header khi thêm vào giỏ.
STYLE_QUERY: cosmetics skincare organic premium modern minimalist green

## Đã áp dụng

- Theme Style: Organic Biophilic (Mỹ phẩm thiên nhiên cao cấp).
- Màu chủ đạo: Xanh ngọc (Emerald - #059669), nền kem/trắng, text slate.
- Hình khối: Bo góc lớn 24px đồng nhất trên toàn bộ UI (card, button, input, modal, image).
- Hiệu ứng chung: Bóng đổ tự nhiên (soft shadow), nền khối hình mờ (blob) chuyển động chậm, hover mượt mà.
- Tính năng nổi bật: Animation ảnh sản phẩm bay từ nút "Thêm vào giỏ" lên icon giỏ hàng ở header.
- Các trang/thành phần đã cập nhật: Header, Footer, Home, Blog (List, Category, Detail, Password), Product (List, Category, Detail, Card, Related, Info, Gallery), Cart Drawer, Checkout, Order Confirmation, Page (Contact, About), Search, 404, Pagination, Breadcrumb, Custom Fields, Live Chat. Đã hoàn thiện toàn bộ.

