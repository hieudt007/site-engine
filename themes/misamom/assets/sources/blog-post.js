// JS riêng cho blog-post.liquid
document.addEventListener('DOMContentLoaded', () => {
    // 1. Scroll Progress Bar
    const progressBar = document.getElementById('scroll-progress');
    if (progressBar) {
        window.addEventListener('scroll', () => {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = (winScroll / height);
            // Limit between 0 and 1
            const scale = Math.min(Math.max(scrolled, 0), 1);
            progressBar.style.transform = `scaleX(${scale})`;
        });
    }

    // 2. Copy Link Functionality
    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = `<svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                copyBtn.classList.add('border-emerald-600', 'bg-emerald-600/10');
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.classList.remove('border-emerald-600', 'bg-emerald-600/10');
                }, 2000);
            });
        });
    }

    // 3. Setup Share Links Dynamically
    const currentUrl = encodeURIComponent(window.location.href);
    const currentTitle = encodeURIComponent(document.title);
    
    const shareBtns = document.querySelectorAll('.share-btn');
    if (shareBtns.length >= 2) {
        // Twitter
        shareBtns[0].href = `https://twitter.com/intent/tweet?url=${currentUrl}&text=${currentTitle}`;
        // Facebook
        shareBtns[1].href = `https://www.facebook.com/sharer/sharer.php?u=${currentUrl}`;
        
        shareBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (btn.getAttribute('href') !== '#') {
                    e.preventDefault();
                    window.open(btn.href, '_blank', 'width=600,height=400,menubar=no,toolbar=no');
                }
            });
        });
    }

    // 4. Fade-up Animation Observer
    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.fade-up-item').forEach(item => {
        observer.observe(item);
    });
});