---
name: ui-ux-pro-max
description: Bí kíp thiết kế giao diện UI/UX cao cấp (Premium). Sử dụng khi cần hướng dẫn chi tiết về cách phối màu, bo góc, tạo bóng đổ, và animation sang trọng.
---

# BÍ KÍP THIẾT KẾ GIAO DIỆN CAO CẤP (UI/UX PRO MAX)

Hệ thống yêu cầu giao diện (Theme) phải mang lại cảm giác cực kỳ sang trọng, tinh tế và đẳng cấp (Premium). Tuyệt đối không thiết kế các giao diện trông rẻ tiền, thô cứng.

Hãy luôn áp dụng các nguyên tắc Tailwind CSS sau đây vào từng element bạn code:

## 1. Màu sắc (Colors & Gradients)
- **CẤM** sử dụng các màu nguyên bản chói lóa như `bg-red-500`, `bg-blue-600` làm nền diện rộng.
- **KHUYÊN DÙNG**: Sử dụng các dải màu trung tính, pastel hoặc màu tối có chiều sâu. Ví dụ: `bg-slate-50`, `bg-zinc-900`, `text-slate-600`.
- **Gradients**: Dùng Gradient mượt mà cho các nút bấm chính hoặc điểm nhấn: `bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500`.

## 2. Hiệu ứng kính (Glassmorphism)
Đối với các Card, Popup, hoặc Header, hãy áp dụng Glassmorphism thay vì nền đặc:
- Công thức chuẩn: `bg-white/70 backdrop-blur-md border border-white/20 shadow-xl` (cho nền sáng)
- Hoặc: `bg-black/40 backdrop-blur-xl border border-white/10` (cho nền tối).

## 3. Bóng đổ nhiều lớp (Layered Shadows)
- Đừng dùng `shadow` cơ bản. 
- Hãy dùng `shadow-sm` cho các thẻ bao bọc (wrapper), `shadow-md` cho card, và `shadow-2xl` cho các Modal/Dialog.
- Khi hover vào Card sản phẩm, bắt buộc phải nâng bóng đổ lên: `hover:shadow-xl transition-shadow duration-300`.

## 4. Tương tác mượt mà (Micro-Animations & Transitions)
- **MỌI NÚT BẤM (Button) VÀ THẺ (Card)** BẮT BUỘC phải có tương tác khi Hover.
- Nút bấm: `transition-all duration-300 hover:-translate-y-1 hover:scale-105 active:scale-95`.
- Link (A tag): Chuyển màu mượt mà: `transition-colors duration-200 hover:text-indigo-600`.

## 5. Typography (Nghệ thuật chữ)
- Các Tiêu đề (Heading H1, H2) phải dùng font dày, tracking hẹp (khoảng cách chữ): `font-medium tracking-tight text-slate-900`.
- Có thể dùng hiệu ứng kẹp màu cho tiêu đề lớn: `bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-500`.
- Chữ mô tả (Paragraph) phải nhạt hơn, dễ đọc: `text-slate-500 leading-relaxed`.

## 6. Bo góc (Border Radius)
- Phải thống nhất bo góc toàn site. Ưu tiên dùng `rounded-2xl` hoặc `rounded-3xl` cho các khối Card lớn để tạo sự thân thiện, hiện đại.
- Nút bấm có thể dùng `rounded-full` (kiểu viên thuốc - pill).

## GHI CHÚ CHUNG
Khi được giao làm một component, hãy áp dụng ngay lập tức các class Tailwind ở trên vào thẻ HTML của bạn để tạo ra kết quả "Wow" ngay từ cái nhìn đầu tiên!
