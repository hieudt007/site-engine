document.addEventListener('DOMContentLoaded', () => {
  const fieldRows = document.querySelectorAll('.custom-field-row');
  
  fieldRows.forEach(row => {
    row.addEventListener('click', function() {
      // Bật/tắt hiệu ứng highlight nhẹ khi click vào dòng thông tin
      this.classList.toggle('bg-blue-50');
    });
  });
});