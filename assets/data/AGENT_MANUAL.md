# AI Assistant Knowledge Base

Each heading below corresponds 1:1 to a page in the admin sidebar.

## Posts
Posts and Pages share one model but have separate routes/sidebar entries. A post has: title, slug (auto from title, editable), excerpt, body, cover image, category, topic, status (`draft`/`published`/scheduled), SEO title/description (auto-generates Schema.org BlogPosting JSON-LD), free-form custom fields. Has revision history (can restore an old version). Scheduled publishing runs via a background cron (`publishScheduler`).

## Taxonomies
Covers both post categories and topics. Category is shared between posts and products (`type: post` / `type: product`), supports parent-child hierarchy, own URL prefix (`/{prefix}/category/{slug}`). Topic is a flat tag for posts, no hierarchy.

## Pages
Static pages (`type: page`) — same model/fields as Posts, different route/prefix.

## Media
Shared upload library for images/files. Each file has its own `alt` field (SEO/accessibility) — remind the user to fill `alt` when uploading product/post images.

## Products
Price/stock/status are synced ONE-WAY from LeadBase (cannot edit price/stock directly in site-engine — must be done in LeadBase). site-engine only manages **display content**: excerpt/long description, images, SEO, specs, variants (each variant has its own SKU/price/stock synced from LeadBase). Has star reviews + comments from customers, admin must approve (`pending`/`approved`) before they show publicly; average rating is computed automatically.

## Product Categories
Same taxonomy engine as post categories, scoped to products (`type: product`).

## Orders
Customers add to cart, checkout does not require an account. An order (CartOrder) stores customer name/phone/address, payment method, fulfillment method, and separate order status vs payment status. After an order is created, site-engine automatically forwards it to LeadBase via an HMAC-signed API call (no manual step); failed sends auto-retry in the background — an order stuck in `failed` means the push to LeadBase hasn't succeeded yet and needs attention on the admin dashboard.

## Reviews
Product star ratings + comments submitted by customers, held as `pending` until an admin approves them.

## Payment
3 methods, toggled independently: **COD** (no config needed), **Bank transfer** (bank name/account number/holder/branch, optional QR image), **VNPay** (needs TMN Code + Hash Secret from VNPay, has a Sandbox mode for testing; flow is redirect to VNPay then VNPay calls back via IPN to confirm).

## Shipping
Shipping fee is configured as RULES by province: each rule has a name, list of provinces it applies to, a base fee, and a free-shipping threshold (order total above X → 0 fee; leave blank to disable). Besides home delivery, there's also "pickup at store" — store list (name, address, province, phone) is managed on this page too; customers pick a store at checkout instead of entering a delivery address.

## Coupons
A coupon has: code (auto-uppercased), discount type (`percent` or `fixed` amount), discount value, optional minimum order total to qualify, optional max uses (blank = unlimited), optional expiry date, enabled toggle.

## Theme
UI is built with Liquid + Tailwind, no rebuild needed on edit — changes show immediately. Editing method: inline click-to-edit (click text/images directly on the live preview to edit static content, no structural changes). Only one theme is active at a time; other themes can be previewed before activating.

## Plugins
Optional add-on features (e.g. customer-support live chat) installed as plugins, toggled independently on this page — disabling a plugin removes all its widgets/routes from the site immediately, no restart needed.

## AI Agents
Configures which AI provider/model/system-prompt backs each agent role (chat, content, image generation, etc.) used across the admin. Agents are DB rows, not hardcoded — changes take effect immediately.

## Lead Forms
Custom lead-capture forms rendered on the public site; submissions are stored and viewable here.

## Users
Admin login goes through LeadBase OAuth — no separate site-engine password. Three roles, ascending: `edit` (basic editing) < `manager` < `admin` (full access, including Settings/Payment/Shipping — the other two roles cannot touch these). One account can only be logged in on one device at a time — logging in on a new device auto-logs-out the old session.

## Settings
General site settings: site name/tagline/logo/favicon/contact info, `siteType` toggle (`blog` vs `ecommerce` — `blog` mode completely blocks every ecommerce URL/route, public and admin, even by direct link, not just hidden menus), URL prefixes for posts/pages/products (must not collide with each other), default OG image, Google Search Console verification code, and tracking scripts (Google Analytics ID, Facebook Pixel ID, plus one arbitrary custom head script for anything else like TikTok Pixel/Hotjar).

## Redirects
Declares old-URL → new-URL pairs with an HTTP status code (301/302) — used when a post/page/product's URL changes, to avoid broken links/lost SEO.
