document.addEventListener('DOMContentLoaded', () => {
    const initPostCards = () => {
        const postCards = document.querySelectorAll('.post-card:not(.is-visible)');
        
        if (postCards.length === 0) return;

        const observerOptions = {
            root: null,
            rootMargin: '0px 0px -50px 0px',
            threshold: 0.1
        };

        const cardObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.classList.add('is-visible');
                    }, index * 100);
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        postCards.forEach(card => {
            cardObserver.observe(card);
        });
    };

    initPostCards();

    // Re-init if dynamically loaded (e.g., infinite scroll or filtering)
    document.addEventListener('posts-loaded', initPostCards);
});