// JS riêng cho footer.liquid
document.addEventListener('DOMContentLoaded', () => {
    const newsletterForm = document.querySelector('.newsletter-form');
    
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = newsletterForm.querySelector('input[type="email"]');
            const btn = newsletterForm.querySelector('button');
            const msgBox = newsletterForm.querySelector('.newsletter-msg');
            const originalBtnContent = btn.innerHTML;

            if (input.value) {
                // Hiệu ứng loading giả lập
                btn.innerHTML = `<svg class="w-5 h-5 animate-spin text-white mx-auto" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                
                setTimeout(() => {
                    // Thành công
                    btn.innerHTML = `<svg class="w-5 h-5 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                    btn.classList.replace('bg-blue-600', 'bg-blue-500');
                    
                    msgBox.textContent = 'Cảm ơn bạn đã đăng ký!';
                    msgBox.classList.remove('opacity-0', '-translate-y-2');
                    msgBox.classList.add('opacity-100', 'translate-y-0');
                    
                    input.value = '';
                    
                    // Reset sau 3 giây
                    setTimeout(() => {
                        btn.innerHTML = originalBtnContent;
                        btn.classList.replace('bg-blue-500', 'bg-blue-600');
                        msgBox.classList.remove('opacity-100', 'translate-y-0');
                        msgBox.classList.add('opacity-0', '-translate-y-2');
                    }, 3000);
                }, 800);
            }
        });
    }
});