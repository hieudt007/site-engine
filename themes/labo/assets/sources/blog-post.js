// JS riêng cho blog-post.liquid
document.addEventListener('DOMContentLoaded', () => {
  // Thanh tiến trình đọc bài viết (Reading progress bar)
  const progressBar = document.createElement('div');
  progressBar.className = 'fixed top-0 left-0 h-1 bg-blue-600 z-50 transition-all duration-150 ease-out origin-left';
  progressBar.style.width = '0%';
  document.body.appendChild(progressBar);

  const updateProgress = () => {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight > 0) {
      const progress = (window.scrollY / scrollHeight) * 100;
      progressBar.style.width = `${progress}%`;
    }
  };

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress(); // Khởi tạo ban đầu
});