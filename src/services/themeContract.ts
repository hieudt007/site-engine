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
      '{% render "header"',
      '{% render "footer"',
      '{% render "components/common/breadcrumb"',
      "/theme-assets/{{ themeSlug }}/assets/custom.css",
      "/theme-assets/{{ themeSlug }}/assets/custom.js",
    ],
    requiredIds: [],
    notes:
      'PHAI giu nguyen script Tailwind CDN (co the doi query plugin), PHAI giu {% block content %}{% endblock %} ' +
      'de noi dung tung trang chen vao, PHAI goi {% render "header", site: site, headerMenu: headerMenu %} va ' +
      '{% render "footer", site: site, footerMenu: footerMenu, year: year %}, PHAI giu {% render "components/common/breadcrumb", ... %} ' +
      'o trong layout de breadcrumb hien toan site khi route truyen breadcrumbs, PHAI giu the <link> toi ' +
      "/theme-assets/{{ themeSlug }}/assets/custom.css va <script> toi .../custom.js (CSS/JS tuy bien rieng cua " +
      "theme, sinh/sua o buoc khac). Duoc tu do doi font (Google Fonts link), tailwind.config (mau sac, " +
      "fontFamily), bo cuc <body> ngoai cac phan bat buoc tren.",
  },
  {
    file: "header.liquid",
    description: "Thanh dieu huong dau trang.",
    requiredSubstrings: ["site.siteName", "headerMenu"],
    requiredIds: [],
    notes:
      "Nhan bien site (logoUrl/siteName/tagline) va headerMenu (headerMenu.items, moi item co label/url). " +
      "Neu headerMenu rong/null PHAI co fallback 3 link mac dinh: /products, /blog, /cart.",
  },
  {
    file: "footer.liquid",
    description: "Chan trang.",
    requiredSubstrings: ["site.siteName", "footerMenu"],
    requiredIds: [],
    notes: "Nhan bien site va footerMenu (giong header.liquid), hien nam ban quyen + ten site.",
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
      '{% render "custom-fields", fields: post.customFields %} o cuoi bai (hien truong tuy bien admin tu dat).',
  },
  {
    file: "blog-category.liquid",
    description: "Trang phan loai bai viet (danh muc hoac chu de).",
    requiredSubstrings: [...WRAPPER, "category.name", "posts", "category.customFields", "categoryPath"],
    requiredIds: [],
    notes:
      'Dung chung cho /danh-muc/:slug va /chu-de/:slug. category co name/excerpt/body/children[]/customFields. ' +
      'categoryPath la URL hien tai dung cho phan trang; backHref/backLabel va childPathPrefix co the duoc truyen theo ngu canh. ' +
      'PHAI giu {% render "custom-fields", fields: category.customFields %}.',
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
    description: "Trang phan loai san pham (danh muc hoac thuong hieu).",
    requiredSubstrings: [...WRAPPER, "category.name", "products", "category.customFields", "categoryPath"],
    requiredIds: [],
    notes:
      'Dung chung cho /products/danh-muc/:slug va /products/thuong-hieu/:slug. category co name/excerpt/body/children[]/customFields. ' +
      'categoryPath la URL hien tai dung cho phan trang; backHref/backLabel va childPathPrefix co the duoc truyen theo ngu canh. ' +
      'PHAI giu {% render "custom-fields", fields: category.customFields %}.',
  },
  {
    file: "search.liquid",
    description: "Trang tim kiem public cho bai viet, trang tinh va san pham.",
    requiredSubstrings: [...WRAPPER, "q", "hasQuery", "posts", "pages", "products", "totalResults"],
    requiredIds: [],
    notes:
      "Nhan q, hasQuery, totalResults, posts[], pages[], products[]. Nen dung components/post/card.liquid va components/product/card.liquid de hien ket qua, " +
      "khong copy lai HTML card dai trong file search.",
  },
  {
    file: "product-detail.liquid",
    description: "Chi tiet 1 san pham — file chinh quyet dinh layout va render cac block chuc nang.",
    requiredSubstrings: [...WRAPPER, 'data-product-id="{{ product.id }}"', '{% render "components/product/media"', '{% render "components/product/info"', '{% render "components/product/purchase"', '{% render "components/product/content"'],
    requiredIds: [],
    notes:
      "File nay giu layout tong the cua trang san pham. Cac ID JS bat buoc nam trong components/product/purchase.liquid va components/product/content.liquid. " +
      "Chi sua file nay khi can doi vi tri/sap xep cac khoi lon. Neu sua ben trong anh/ten/gia/mua hang/mo ta/review/related thi sua component tuong ung.",
  },
  {
    file: "components/product/media.liquid",
    description: "Khoi anh san pham.",
    requiredSubstrings: ["product.imageUrls", "product.name"],
    requiredIds: [],
    notes: "Nhan product. Sua anh/gallery/fallback anh o day. Khong chua gia, variant hay nut mua.",
  },
  {
    file: "components/product/info.liquid",
    description: "Khoi thong tin dinh danh san pham.",
    requiredSubstrings: ["product.name", "product.categories"],
    requiredIds: [],
    notes: "Nhan product va productCategoryPathPrefix. Sua ten, danh muc, thong tin nhan dien/ngan o day; khong ap dat vi tri layout.",
  },
  {
    file: "components/product/purchase.liquid",
    description: "Khoi mua hang, gia, bien the, them gio va mua ngay.",
    requiredSubstrings: ["product.price", "variantsJson"],
    requiredIds: ["add-to-cart", "variant-picker", "variant-price", "variant-stock", "variants-data", "buy-now-btn", "buy-now-form", "buy-now-cancel", "buy-now-error"],
    notes:
      "Sua gia, bien the, ton kho, them gio, mua ngay va form mua ngay o day. JS phia client doc cac ID nay. #add-to-cart can data-id khi khong co bien the; khi co bien the JS tu gan data-variant-id. " +
      "#variants-data phai chua {{ variantsJson }} khi product.hasVariants. #buy-now-form phai co input customerName/customerPhone/customerAddress.",
  },
  {
    file: "components/product/content.liquid",
    description: "Khoi noi dung dai, thong so, FAQ, custom fields va danh gia cua san pham.",
    requiredSubstrings: ["product.description", "product.customFields", '{% render "custom-fields"', "reviews", "avgRating"],
    requiredIds: ["review-form", "review-msg"],
    notes:
      'Nhan product, reviews va avgRating. Sua mo ta dai, thong so, FAQ, custom fields va danh gia/review o day. PHAI giu {% render "custom-fields", fields: product.customFields %}. ' +
      "JS gui danh gia doc form#review-form va #review-msg. Form can customerName, rating va comment.",
  },
  {
    file: "components/product/related.liquid",
    description: "Khoi san pham lien quan dung cho upsell/cross-sell.",
    requiredSubstrings: ["products", "title"],
    requiredIds: [],
    notes: "Nhan title, products[], productUrlPrefix. Sua block upsell/cross-sell/related trong trang chi tiet o day. Tu an khi products rong/null. Co the dung product-card neu phu hop.",
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
      'PHAI giu {% render "custom-fields", fields: order.customFields %} (hien field khach tu dien them luc checkout).',
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
      "KHONG duoc {% render \"header\" %}/{% render \"footer\" %} - day la trang doc lap (vd landing quang cao), " +
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
    file: "custom-fields.liquid",
    description: "Partial hien bang key-value cho truong tuy bien admin tu dat.",
    requiredSubstrings: ["fields"],
    requiredIds: [],
    notes: "Nhan fields (object string->string, co the null/rong — PHAI tu an neu rong). Loop qua tung cap [key,value].",
  },
  {
    file: "components/common/breadcrumb.liquid",
    description: "Breadcrumb dung chung toan site, style theo breadcrumbVariant.",
    requiredSubstrings: ["breadcrumbs", "breadcrumbVariant", "item.name", "item.url"],
    requiredIds: [],
    notes:
      "Nhan breadcrumbs[] moi item co name/url va breadcrumbVariant ('blog'|'product'|'default'). " +
      "PHAI tu an khi breadcrumbs rong/null. Co the doi style rieng theo variant, nhung khong bo aria-label Breadcrumb " +
      "va khong bo aria-current tren item cuoi.",
  },
  {
    file: "components/common/pagination.liquid",
    description: "Pagination dung chung cho cac trang danh sach trong theme.",
    requiredSubstrings: ["basePath", "hasPrev", "hasNext", "prevPage", "nextPage"],
    requiredIds: [],
    notes:
      "Nhan basePath, hasPrev, hasNext, prevPage, nextPage. PHAI tu an khi khong co hasPrev/hasNext. " +
      "Template danh sach/danh muc nen render partial nay thay vi copy HTML phan trang rieng.",
  },
  {
    file: "components/product/card.liquid",
    description: "Card san pham dung chung cho home, product list, product category va cac khu san pham lien quan.",
    requiredSubstrings: ["product", "productUrlPrefix", "variant", "product.name"],
    requiredIds: [],
    notes:
      "Nhan product, productUrlPrefix va variant. Sua card san pham o home/list/category/search/related o day. Variant co the la 'home', 'list', 'category', 'related', 'upsell', 'cross-sell'. " +
      "Duoc phep doi layout/style theo variant, nhung phai link den productUrlPrefix + slug/id va hien ten/gia san pham.",
  },
  {
    file: "components/post/card.liquid",
    description: "Card bai viet dung chung cho home, blog list va blog category/topic.",
    requiredSubstrings: ["post", "postUrlPrefix", "variant", "post.title"],
    requiredIds: [],
    notes:
      "Nhan post, postUrlPrefix, postCategoryPathPrefix va variant. Variant co the la 'home', 'list', 'category', 'related'. " +
      "Duoc phep doi layout/style theo variant, nhung phai link den postUrlPrefix + slug va hien title/ngay/excerpt neu co.",
  },
];

export function getContract(file: string): ThemeFileContract | undefined {
  return THEME_FILE_CONTRACTS.find((c) => c.file === file);
}

// CSS/JS tuy bien — moi file .liquid trong THEME_FILE_CONTRACTS co 1 cap file NGUON rieng
// (assets/sources/{ten}.css/.js), CHI chua style/script cua dung trang do — tranh 1 file chung
// phinh to theo thoi gian (kinh nghiem thuc te: sua xong header da ra ~8000 ky tu, nhan 18 trang
// se khong kiem soat noi). Cac file assets/custom.css/custom.js la BUILD OUTPUT — tu dong GOM +
// MINIFY tu toan bo file nguon (services/themeAssetBundler.ts) moi khi 1 file nguon doi, KHONG
// duoc AI/admin sua truc tiep (se bi ghi de o lan gom ke tiep).
export interface ThemeAssetFile {
  file: string;
  contentType: "css" | "js";
  forLiquidFile: string;
  notes: string;
}

function sourceBase(liquidFile: string): string {
  return liquidFile.replace(/\.liquid$/, "");
}

export function pairedSourceFiles(liquidFile: string): { css: string; js: string } {
  const base = sourceBase(liquidFile);
  return { css: `assets/sources/${base}.css`, js: `assets/sources/${base}.js` };
}

export const THEME_ASSET_FILES: ThemeAssetFile[] = THEME_FILE_CONTRACTS.flatMap((c) => {
  const { css, js } = pairedSourceFiles(c.file);
  return [
    { file: css, contentType: "css" as const, forLiquidFile: c.file, notes: `CSS riêng cho "${c.file}" (${c.description}) — chỉ ảnh hưởng trang này.` },
    {
      file: js,
      contentType: "js" as const,
      forLiquidFile: c.file,
      notes:
        `JS riêng cho "${c.file}" (${c.description}) — chỉ ảnh hưởng trang này. KHÔNG được định nghĩa lại các id ` +
        "đã dùng bởi JS nguồn của theme: add-to-cart, " +
        "cart-items, checkout-form, checkout-error, cart-total, variant-picker, variant-price, variant-stock, " +
        "review-form, unlock-form, password, unlock-error.",
    },
  ];
});

// File build (khong nam trong THEME_ASSET_FILES - khong duoc AI chon de sua truc tiep).
export const THEME_BUNDLE_OUTPUTS = ["assets/custom.css", "assets/custom.js"];

// Nhom 1 file .liquid + cap nguon css/js cua no lai voi nhau theo "ten trang" chung - dung de
// server tu gom cac file AI chon vao DUNG 1 lan goi cho 1 nhom (routes/admin/themeChat.ts), tranh
// AI phai xu ly nhieu trang khong lien quan trong cung 1 cau tra loi.
export function pageGroupKey(file: string): string {
  if (file.startsWith("assets/sources/")) {
    return file.replace(/^assets\/sources\//, "").replace(/\.(css|js)$/, "");
  }
  return file.replace(/\.liquid$/, "");
}
