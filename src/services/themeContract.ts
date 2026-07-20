// Hop dong tung file theme — dung ca 2 viec: (1) nhet vao system prompt cho AI biet PHAI giu gi,
// (2) validate output AI sinh ra truoc khi ghi de len dia (services/themeValidator.ts). Chi check
// bang CHUOI CON (khong parse AST bieu thuc Liquid) — du de bat "AI quen hoan toan 1 phan chuc
// nang" (vd xoa mat #add-to-cart, quen loop posts), khong bat duoc loi tinh vi hon — do la danh
// doi co chu dich, tranh xay 1 bo parser Liquid rieng chi de validate.
export interface ThemeFileContract {
  file: string;
  description: string;
  // Chuoi PHAI xuat hien nguyen van trong source (Liquid tag/bien) — vd "post.title".
  requiredSubstrings: string[];
  // id="..." PHAI co trong HTML sinh ra — cho cac file co JS phia client bam vao (product-detail,
  // cart, blog-post-locked) — thieu 1 trong so nay la JS chet cung, khong loi ro rang cho khach.
  requiredIds: string[];
  // Ghi chu tu do gui kem AI — giai thich NGU CANH (JS lam gi voi id do, du lieu tu dau ra).
  notes: string;
}

const WRAPPER = ['{% layout "layout" %}', "{% block content %}", "{% endblock %}"];

export const THEME_FILE_CONTRACTS: ThemeFileContract[] = [
  {
    file: "layout.liquid",
    description: "Khung bao ngoai moi trang — <head>, goi header/footer, cho block content chen vao giua.",
    requiredSubstrings: [
      "{% block content %}{% endblock %}",
      "cdn.tailwindcss.com",
      '{% render "_header"',
      '{% render "_footer"',
      "/theme-assets/{{ themeSlug }}/assets/custom.css",
      "/theme-assets/{{ themeSlug }}/assets/custom.js",
    ],
    requiredIds: [],
    notes:
      'PHAI giu nguyen script Tailwind CDN (co the doi query plugin), PHAI giu {% block content %}{% endblock %} ' +
      'de noi dung tung trang chen vao, PHAI goi {% render "_header", site: site, headerMenu: headerMenu %} va ' +
      '{% render "_footer", site: site, footerMenu: footerMenu, year: year %}, PHAI giu the <link> toi ' +
      "/theme-assets/{{ themeSlug }}/assets/custom.css va <script> toi .../custom.js (CSS/JS tuy bien rieng cua " +
      "theme, sinh/sua o buoc khac). Duoc tu do doi font (Google Fonts link), tailwind.config (mau sac, " +
      "fontFamily), bo cuc <body> ngoai cac phan bat buoc tren.",
  },
  {
    file: "_header.liquid",
    description: "Thanh dieu huong dau trang.",
    requiredSubstrings: ["site.siteName", "headerMenu"],
    requiredIds: [],
    notes:
      "Nhan bien site (logoUrl/siteName/tagline) va headerMenu (headerMenu.items, moi item co label/url). " +
      "Neu headerMenu rong/null PHAI co fallback 3 link mac dinh: /products, /blog, /cart.",
  },
  {
    file: "_footer.liquid",
    description: "Chan trang.",
    requiredSubstrings: ["site.siteName", "footerMenu"],
    requiredIds: [],
    notes: "Nhan bien site va footerMenu (giong _header.liquid), hien nam ban quyen + ten site.",
  },
  {
    file: "home.liquid",
    description: "Trang chu — hero + bai viet moi + san pham moi.",
    requiredSubstrings: [...WRAPPER, "posts", "products"],
    requiredIds: [],
    notes:
      "Nhan post[] (slug/title/excerpt/coverImage/publishedAt) va products[] (id/name/imageUrls/price/salePrice). " +
      "Ca 2 co the rong — phai co fallback khi rong.",
  },
  {
    file: "blog-list.liquid",
    description: "Danh sach bai viet, co phan trang.",
    requiredSubstrings: [...WRAPPER, "posts", "post.slug", "post.title", "hasNext", "hasPrev"],
    requiredIds: [],
    notes: "posts[] tung phan tu co slug/title/excerpt/coverImage/publishedAt/categories[]. hasPrev/hasNext/prevPage/nextPage cho phan trang.",
  },
  {
    file: "blog-post.liquid",
    description: "Chi tiet 1 bai viet.",
    requiredSubstrings: [...WRAPPER, "post.title", "post.body", "post.customFields"],
    requiredIds: [],
    notes:
      "post.body la HTML DA SANITIZE, PHAI render RAW (khong escape). PHAI giu " +
      '{% render "_custom-fields", fields: post.customFields %} o cuoi bai (hien truong tuy bien admin tu dat).',
  },
  {
    file: "blog-category.liquid",
    description: "Trang danh muc bai viet.",
    requiredSubstrings: [...WRAPPER, "category.name", "posts", "category.customFields"],
    requiredIds: [],
    notes: 'category co name/excerpt/body/children[]/customFields. PHAI giu {% render "_custom-fields", fields: category.customFields %}.',
  },
  {
    file: "blog-post-locked.liquid",
    description: "Man hinh nhap mat khau xem bai viet bi khoa.",
    requiredSubstrings: [...WRAPPER, "pageTitle"],
    requiredIds: ["unlock-form", "password", "unlock-error"],
    notes:
      "JS co san doc form#unlock-form, input#password, hien loi vao #unlock-error. KHONG duoc doi id 3 cai nay " +
      "hoac form se khong hoat dong — chi duoc doi style/layout.",
  },
  {
    file: "page.liquid",
    description: "Trang tinh (Gioi thieu, Lien he...).",
    requiredSubstrings: [...WRAPPER, "page.title", "page.body"],
    requiredIds: [],
    notes: "page.body la HTML da sanitize, render RAW.",
  },
  {
    file: "products-list.liquid",
    description: "Danh sach san pham, co phan trang.",
    requiredSubstrings: [...WRAPPER, "products", "product.id", "hasNext", "hasPrev"],
    requiredIds: [],
    notes: "products[] co id/name/imageUrls/price/salePrice.",
  },
  {
    file: "product-category.liquid",
    description: "Trang danh muc san pham.",
    requiredSubstrings: [...WRAPPER, "category.name", "products", "category.customFields"],
    requiredIds: [],
    notes: 'PHAI giu {% render "_custom-fields", fields: category.customFields %}.',
  },
  {
    file: "product-detail.liquid",
    description: "Chi tiet 1 san pham — co the co bien the (mau/size).",
    requiredSubstrings: [...WRAPPER, "product.name", "product.price", "product.customFields", "variantsJson"],
    requiredIds: [
      "add-to-cart",
      "variant-picker",
      "variant-price",
      "variant-stock",
      "review-form",
      "buy-now-btn",
      "buy-now-form",
      "buy-now-cancel",
      "buy-now-error",
    ],
    notes:
      "JS phia client (giu NGUYEN trong file, chi doi HTML/class xung quanh) doc: #add-to-cart (nut them gio, " +
      "co data-id khi khong bien the / data-variant-id khi co), #variant-picker (JS tu bom <select> vao day theo " +
      "product.hasVariants), #variant-price, #variant-stock, script#variants-data (JSON.parse tu {{ variantsJson }}), " +
      "#review-form + input[name=customerName]/select[name=rating]/textarea[name=comment], #review-msg. " +
      "#buy-now-btn (mo form mua ngay rieng, khong dong tam voi gio hang), #buy-now-form (an mac dinh bang class " +
      "'hidden', co input[name=customerName]/customerPhone/customerAddress, submit goi POST /cart/checkout roi tu " +
      "xoa san pham nay khoi localStorage neu co), #buy-now-cancel (nut dong form), #buy-now-error (hien loi). " +
      "DUOC PHEP them input dat ten tuy y vao #buy-now-form (giong #checkout-form ben cart.liquid) - JS tu dong " +
      "gop thanh customFields gui kem don hang. " +
      'PHAI giu {% render "_custom-fields", fields: product.customFields %}.',
  },
  {
    file: "cart.liquid",
    description: "Trang gio hang + checkout.",
    requiredSubstrings: [...WRAPPER],
    requiredIds: ["cart-items", "checkout-form", "cart-total", "checkout-error"],
    notes:
      "JS (giu nguyen, chi doi HTML/class xung quanh) doc localStorage, bom noi dung vao #cart-items, " +
      "form#checkout-form co input[name=customerName]/customerPhone/customerAddress, hien tong vao #cart-total, " +
      "loi vao #checkout-error. DUOC PHEP them input dat ten tuy y vao form nay (vd " +
      '<input name="secondaryPhone">) - JS tu dong gop moi input NGOAI 3 ten tren thanh customFields ' +
      "gui kem don hang, KHONG can sua JS.",
  },
  {
    file: "order-confirmation.liquid",
    description: "Trang xac nhan sau khi dat hang thanh cong.",
    requiredSubstrings: [...WRAPPER, "order.id", "order.items", "order.total", "order.customFields"],
    requiredIds: [],
    notes:
      "order co customerName/id/items[](name/quantity/price)/total/customerAddress/customerPhone/customFields. " +
      'PHAI giu {% render "_custom-fields", fields: order.customFields %} (hien field khach tu dien them luc checkout).',
  },
  {
    file: "custom-content.liquid",
    description: "Che do 'Tuy bien' cua Post/Page/Product - van co header/footer nhung noi dung render THO, khong qua khung tieu de/danh muc chuan.",
    requiredSubstrings: [...WRAPPER, "rawHtml"],
    requiredIds: [],
    notes: "Chi can render {{ rawHtml }} (HTML da duoc admin tu soan, KHONG duoc escape/sanitize them) vao trong block content, khong them chrome (tieu de/breadcrumb) nao ca.",
  },
  {
    file: "landing.liquid",
    description: "Che do 'Landing page' cua Post/Page/Product - KHONG header/footer/layout gi ca, trang doc lap hoan toan.",
    requiredSubstrings: ["cdn.tailwindcss.com", "rawHtml"],
    requiredIds: [],
    notes:
      "KHONG duoc {% render \"_header\" %}/{% render \"_footer\" %} - day la trang doc lap (vd landing quang cao), " +
      "khong duoc co nav/footer cua site chinh. Van giu <head> voi Tailwind CDN + font de rawHtml (admin tu viet, " +
      "co the dung class Tailwind) hien dung. Chi render {{ rawHtml }} thang vao <body>, KHONG escape/sanitize them.",
  },
  {
    file: "404.liquid",
    description: "Trang khong tim thay (404) - dung cho moi URL/slug/id khong ton tai tren toan site.",
    requiredSubstrings: [...WRAPPER],
    requiredIds: [],
    notes: "Nhan bien message (co the rong/khong duoc truyen — PHAI co gia tri mac dinh du hop ly, vd \"Không tìm thấy trang bạn cần\"). Nen co link ve trang chu.",
  },
  {
    file: "_custom-fields.liquid",
    description: "Partial hien bang key-value cho truong tuy bien admin tu dat.",
    requiredSubstrings: ["fields"],
    requiredIds: [],
    notes: "Nhan fields (object string->string, co the null/rong — PHAI tu an neu rong). Loop qua tung cap [key,value].",
  },
];

export function getContract(file: string): ThemeFileContract | undefined {
  return THEME_FILE_CONTRACTS.find((c) => c.file === file);
}

// CSS/JS tuy bien — KHONG phai Liquid nen khong ap dung hop dong requiredSubstrings/Ids (CSS/JS
// thuan khong co "bien Liquid" nao ma check), serve qua routes/public/themeAssets.ts, nhung vao
// tu layout.liquid (xem contract layout.liquid o tren). File CHUA TUNG duoc AI dong den van hop
// le (rong, comment placeholder — xem themes/default/assets/).
export interface ThemeAssetFile {
  file: string;
  contentType: "css" | "js";
  notes: string;
}

export const THEME_ASSET_FILES: ThemeAssetFile[] = [
  {
    file: "assets/custom.css",
    contentType: "css",
    notes: "CSS thuan (khong phai Liquid) — bo sung cho Tailwind utility class, dung cho hieu ung/selector phuc tap ma class khong lam duoc.",
  },
  {
    file: "assets/custom.js",
    contentType: "js",
    notes:
      "JS thuan chay sau khi trang load (defer). KHONG duoc dinh nghia lai cac id da dung boi JS gan san trong " +
      "product-detail.liquid/cart.liquid/blog-post-locked.liquid: add-to-cart, cart-items, checkout-form, " +
      "checkout-error, cart-total, variant-picker, variant-price, variant-stock, review-form, unlock-form, " +
      "password, unlock-error.",
  },
];
