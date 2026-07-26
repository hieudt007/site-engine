# Trí nhớ theme (đọc bởi AI editor mỗi lượt chat — xem services/themeMemory.ts)

## Cây thư mục

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
(chưa có)

## Đã áp dụng
(chưa có)
