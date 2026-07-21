// JS riêng cho custom-content.liquid
document.addEventListener('DOMContentLoaded', () => {
  // 1. Tự động bọc bảng (table) để có thể cuộn ngang trên thiết bị di động
  const tables = document.querySelectorAll('.custom-raw-content table');
  tables.forEach(table => {
    // Chỉ bọc nếu admin chưa tự bọc bằng class tương tự
    if (!table.parentElement.classList.contains('table-responsive-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-responsive-wrapper overflow-x-auto w-full mb-6 rounded-lg border border-slate-200';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
      
      // Xóa border và margin của table gốc để dùng style của wrapper
      table.style.margin = '0';
      table.style.border = 'none';
    }
  });

  // 2. Tự động bọc iframe video (YouTube, Vimeo) để responsive theo tỷ lệ 16:9
  const iframes = document.querySelectorAll('.custom-raw-content iframe');
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    if (src.includes('youtube.com') || src.includes('vimeo.com')) {
      if (!iframe.parentElement.classList.contains('aspect-video')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'aspect-video w-full mb-6 rounded-lg overflow-hidden shadow-sm';
        iframe.parentNode.insertBefore(wrapper, iframe);
        wrapper.appendChild(iframe);
        
        iframe.style.width = '100%';
        iframe.style.height = '100%';
      }
    }
  });
});