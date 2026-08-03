document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.related-products-section');
    if (!sections.length) return;

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    sections.forEach((section) => {
        const header = section.querySelector('.related-section-header');
        const cards = section.querySelectorAll('.related-product-card');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (entry.target === header) {
                        entry.target.classList.add('is-visible');
                    } else if (entry.target.classList.contains('related-product-card')) {
                        // Calculate stagger delay based on responsive columns
                        const index = Array.from(cards).indexOf(entry.target);
                        let cols = 2;
                        if (window.innerWidth >= 1024) cols = 4;
                        else if (window.innerWidth >= 768) cols = 3;

                        const staggerIndex = index % cols;

                        setTimeout(() => {
                            entry.target.classList.add('is-visible');
                        }, staggerIndex * 150); // Smooth stagger delay
                    }
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        if (header) observer.observe(header);
        cards.forEach(card => observer.observe(card));
    });
});