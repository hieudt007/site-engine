// JS riêng cho cart.liquid — trống mặc định.

//  async function render() {
    const cart = readCart();
    const container = document.getElementById("checkout-items");
    const form = document.getElementById("checkout-form");

    if (cart.length === 0) {
      container.innerHTML = '<p class="text-stone-500 text-center">Giỏ hàng trống. <a href="/products" class="text-brand">Xem sản phẩm</a></p>';.
