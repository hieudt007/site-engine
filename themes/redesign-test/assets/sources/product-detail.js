document.addEventListener('DOMContentLoaded', () => {
  const mainImg = document.querySelector('.main-product-image');
  const galleryImgs = document.querySelectorAll('.gallery-image');
  
  if(mainImg && galleryImgs.length > 0) {
    galleryImgs.forEach(img => {
      img.addEventListener('click', () => {
        mainImg.src = img.src;
      });
    });
  }
});