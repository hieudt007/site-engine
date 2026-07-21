document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const icon = document.getElementById('mobile-menu-icon');

  if (btn && menu && icon) {
    btn.addEventListener('click', () => {
      menu.classList.toggle('hidden');
      if (menu.classList.contains('hidden')) {
        icon.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
      } else {
        icon.setAttribute('d', 'M6 18L18 6M6 6l12 12');
      }
    });
  }

  const header = document.getElementById('main-header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) {
        header.classList.add('shadow-sm');
      } else {
        header.classList.remove('shadow-sm');
      }
    });
  }
});