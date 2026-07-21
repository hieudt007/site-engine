document.addEventListener('DOMContentLoaded', () => {
  // Bọc các bảng (table) trong nội dung thô bằng div cuộn ngang để chống vỡ layout trên mobile
  const tables = document.querySelectorAll('.page-content table');
  
  tables.forEach(table => {
    // Tạo thẻ div bọc ngoài
    const wrapper = document.createElement('div');
    wrapper.className = 'overflow-x-auto mb-6 rounded-lg border border-slate-200 shadow-sm';
    
    // Chèn div bọc ngoài trước table, sau đó di chuyển table vào trong div
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    
    // Xóa margin-bottom của table vì wrapper đã đảm nhiệm
    table.style.marginBottom = '0';
    table.style.border = 'none'; // Bỏ viền ngoài cùng của table để dùng viền của wrapper
  });
});