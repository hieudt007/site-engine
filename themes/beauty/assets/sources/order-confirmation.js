document.addEventListener('DOMContentLoaded', () => {
    // Format currency function
    const formatCurrency = (value) => {
        const num = parseFloat(value);
        if (isNaN(num)) return value;
        return new Intl.NumberFormat('vi-VN', { 
            style: 'currency', 
            currency: 'VND' 
        }).format(num);
    };

    // Apply formatting to elements with 'format-money' class
    const moneyElements = document.querySelectorAll('.format-money');
    moneyElements.forEach(el => {
        const rawValue = el.getAttribute('data-value') || el.textContent.trim();
        // Extract numbers if the raw value contains text (fallback)
        const numericValue = rawValue.replace(/[^\d.-]/g, '');
        
        if (numericValue) {
            el.textContent = formatCurrency(numericValue);
        }
    });
});