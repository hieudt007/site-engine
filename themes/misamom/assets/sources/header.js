document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('main-header');
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const mobileClose = document.getElementById('mobile-menu-close');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileOverlay = document.getElementById('mobile-menu-overlay');

    // Handle header visual change on scroll
    const handleScroll = () => {
        if (window.scrollY > 20) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    // Mobile Menu Drawer Logic
    const openMobileMenu = () => {
        mobileMenu.classList.remove('-translate-x-full');
        mobileOverlay.classList.remove('hidden');
        
        // Force reflow to ensure transition works
        void mobileOverlay.offsetWidth;
        
        mobileOverlay.classList.remove('opacity-0');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    };

    const closeMobileMenu = () => {
        mobileMenu.classList.add('-translate-x-full');
        mobileOverlay.classList.add('opacity-0');
        
        // Wait for opacity transition before hiding completely
        setTimeout(() => {
            mobileOverlay.classList.add('hidden');
        }, 300);
        
        document.body.style.overflow = ''; // Restore scrolling
    };

    if (mobileToggle) mobileToggle.addEventListener('click', openMobileMenu);
    if (mobileClose) mobileClose.addEventListener('click', closeMobileMenu);
    if (mobileOverlay) mobileOverlay.addEventListener('click', closeMobileMenu);
});