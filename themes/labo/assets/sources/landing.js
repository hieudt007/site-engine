// JS riêng cho landing.liquid
document.addEventListener('DOMContentLoaded', function() {
  const container = document.querySelector('.landing-raw-content');
  if (!container) return;

  // Responsive tables
  const tables = container.querySelectorAll('table');
  tables.forEach(table => {
    if (table.parentNode.classList.contains('landing-table-wrapper')) return;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'landing-table-wrapper';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });

  // Responsive iframes (YouTube, Vimeo)
  const iframes = container.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    if (src.includes('youtube.com') || src.includes('youtu.be') || src.includes('vimeo.com')) {
      if (iframe.parentNode.classList.contains('landing-video-wrapper')) return;
      
      const wrapper = document.createElement('div');
      wrapper.className = 'landing-video-wrapper';
      iframe.parentNode.insertBefore(wrapper, iframe);
      wrapper.appendChild(iframe);
    }
  });
});