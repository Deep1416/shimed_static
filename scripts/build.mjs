// Generates shop/<slug>.html, 404.html and sitemap.xml from data/products.json.
// Zero dependencies: run with `node scripts/build.mjs` (or `npm run build`).
// data/products.json is the single source of truth for products. Only fields
// present there are rendered, so a missing price never produces an Offer.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = "https://shinemedpharmaceuticals.com";
const COMPANY = "Shinemed Pharmaceuticals Pvt Ltd";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

export const products = JSON.parse(read("data/products.json"));
const header = read("scripts/partials/header.html");
const footer = read("scripts/partials/footer.html");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const jsonLd = (o) =>
  `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const withRoot = (html, root) => html.replaceAll("{{root}}", root);

// --- JPEG dimensions (so <img> gets real width/height, avoiding layout shift)
function jpegSize(file) {
  const b = readFileSync(join(ROOT, file));
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`No JPEG size in ${file}`);
}

// --- derived SEO text (never invents facts: only recombines data fields)
const shortUrl = (p) => `${SITE}/shop/${p.slug}.html`;
const imageUrl = (p) => `${SITE}/shop/${p.image}`;
const priceText = (p) => (p.price == null ? "" : `₹${p.price}`);

// Longest run of leading composition items (split on top-level ", ", " + ", " & ") within `room` chars.
function leadItems(comp, room) {
  const cuts = [];
  let depth = 0;
  for (let i = 0; i < comp.length; i++) {
    if (comp[i] === "(") depth++;
    else if (comp[i] === ")") depth--;
    else if (depth === 0 && /^(, | \+ | & )/.test(comp.slice(i))) cuts.push(i);
  }
  const fit = cuts.filter((c) => c <= room);
  if (fit.length) return comp.slice(0, fit.at(-1));
  if (comp.length <= room) return comp;
  const cut = comp.slice(0, room);
  return cut.slice(0, cut.lastIndexOf(" ")); // single long item: cut at a word
}

// Dosage form is read from the composition text itself (e.g. "... Tablets"); never guessed.
const formOf = (p) => (p.composition.match(/\b(Softgel Capsules|Soft Gelatin Capsules|Capsules|Tablets)\b/i) || [])[1]?.replace(/^Soft(?:gel| Gelatin) /i, "");

function titleFor(p) {
  const suffix = " | Shinemed Pharmaceuticals";
  const base = [p.name, formOf(p)].filter(Boolean).join(" ");
  const comp = p.composition.replace(/\s+(Softgel Capsules|Soft Gelatin Capsules|Capsules|Tablets)$/i, ""); // form is already in `base`
  const full = `${base} – ${comp}${suffix}`;
  if (full.length <= 92) return full;
  const lead = leadItems(comp, 84 - suffix.length - base.length - 3).replace(/[ ,+&(]+$/, "");
  return lead ? `${base} – ${lead}…${suffix}` : `${base}${suffix}`;
}

function descriptionFor(p) {
  const tail = ` ${p.price != null ? `${p.priceNote}: ${priceText(p)}. ` : ""}By ${COMPANY}, Delhi.`;
  const lead = `${[p.name, formOf(p)?.toLowerCase()].filter(Boolean).join(" ")} — composition: `;
  const room = 175 - lead.length - tail.length - 1;
  const comp = p.composition.length <= room
    ? `${p.composition}.`
    : `${leadItems(p.composition, room - 1).replace(/[ ,+&(]+$/, "")}…`;
  return `${lead}${comp}${tail}`;
}

const altFor = (p) => `${p.name} product leaflet – Shinemed Pharmaceuticals`;

const DISCLAIMER =
  "Information on this website is provided for general product information only and should not be considered medical advice. Please consult a qualified healthcare professional before using any medicine or supplement.";

// --- product page
function productPage(p) {
  const url = shortUrl(p);
  const title = titleFor(p);
  const description = descriptionFor(p);
  const { width, height } = jpegSize(`shop/${p.image}`);
  const webp = `shop/${p.image.replace(/\.jpe?g$/, ".webp")}`;
  const hasWebp = exists(webp);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE}/shop.html` },
      { "@type": "ListItem", position: 3, name: p.name, item: url },
    ],
  };
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: imageUrl(p),
    description: p.description,
    brand: { "@type": "Brand", name: "Shinemed" },
    url,
  };
  // Offer only when a real MRP exists in data; availability is deliberately omitted.
  // Without a price there is no offer/review/rating, so Google rejects Product markup: it is omitted below.
  if (p.price != null)
    product.offers = {
      "@type": "Offer",
      price: String(p.price),
      priceCurrency: "INR",
      url,
      seller: { "@type": "Organization", name: COMPANY },
    };

  const cards = p.cards
    .map(
      (c) =>
        `<div class="product-info-card${c.accent ? " product-info-card--accent" : ""}"><h3 class="product-info-card__title">${esc(c.title)}</h3><ul class="product-info-list">${c.items
          .map((i) => `<li class="product-info-list__item"><span class="product-info-list__dot" aria-hidden="true"></span>${esc(i)}</li>`)
          .join("")}</ul></div>`,
    )
    .join("\n");

  const priceBlock =
    p.price != null
      ? `<p class="product-detail-price">${priceText(p)} <span>${esc(p.priceNote)}</span></p>`
      : `<p class="product-detail-price-note">MRP is not listed online. Please <a href="../contact.html">contact us</a> for pricing.</p>`;

  const img = `<img class="product-detail-media__image" src="../shop/${p.image}" alt="${esc(altFor(p))}" width="${width}" height="${height}" decoding="async" fetchpriority="high">`;
  const picture = hasWebp
    ? `<picture><source type="image/webp" srcset="../${webp}">${img}</picture>`
    : img;

  const related = products
    .filter((o) => o.slug !== p.slug)
    .map((o) => `<li><a href="${o.slug}.html">${esc(o.name)}</a></li>`)
    .join("");

  const ogPrice =
    p.price != null
      ? `\n<meta property="product:price:amount" content="${p.price}">\n<meta property="product:price:currency" content="INR">`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#ffffff">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Shinemed Pharmaceuticals">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${imageUrl(p)}">
<meta property="og:image:width" content="${width}">
<meta property="og:image:height" content="${height}">
<meta property="og:image:alt" content="${esc(altFor(p))}">${ogPrice}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${imageUrl(p)}">
<meta name="twitter:image:alt" content="${esc(altFor(p))}">
${jsonLd(breadcrumb)}
${p.price != null ? jsonLd(product) : ""}
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png?v=2"><link rel="icon" type="image/png" sizes="192x192" href="../favicon-192.png?v=2"><link rel="shortcut icon" href="../favicon.ico?v=2"><link rel="apple-touch-icon" href="../apple-touch-icon.png?v=2">
<link rel="stylesheet" href="../css/style.css">
</head>
<body>
${withRoot(header, "../")}<section class="page-hero" aria-labelledby="product-detail-heading"><div class="page-hero__inner"><div class="section-kicker section-kicker--center"><span aria-hidden="true"></span>PRODUCT</div>
<h1 id="product-detail-heading">${esc(p.name)}</h1><p class="page-hero__tagline">${esc(p.tagline)}</p></div></section>
<section class="product-detail-section" aria-label="${esc(p.name)}"><div class="product-detail-section__inner">
<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="../">Home</a></li><li><a href="../shop.html">Shop</a></li><li aria-current="page">${esc(p.name)}</li></ol></nav>
<div class="product-detail-layout"><div class="product-detail-media">${picture}</div>
<div class="product-detail-copy"><h2 class="product-detail-title">${esc(p.name)}</h2><p class="product-detail-tagline">${esc(p.tagline)}</p>${priceBlock}
<p class="product-detail-desc">${esc(p.description)}</p>
<div class="product-detail-composition"><span class="product-detail-composition__label">Composition</span><p class="product-detail-composition__text">${esc(p.composition)}</p></div>
<p class="product-detail-enquiry"><a class="action-button action-button--primary" href="../contact.html"><span>Enquire about ${esc(p.name)}</span></a></p></div></div>
<div class="product-detail-cards">
${cards}
</div>
<aside class="product-disclaimer" aria-labelledby="disclaimer-heading"><h2 id="disclaimer-heading">Important information</h2><p>${esc(DISCLAIMER)}</p></aside>
<nav class="product-related" aria-labelledby="related-heading"><h2 id="related-heading">More Shinemed products</h2><ul>${related}</ul><p><a href="../shop.html">View all products</a></p></nav>
</div></section>
${withRoot(footer, "../")}<script src="../js/main.js"></script>
</body>
</html>
`;
}

// --- 404 page: root-absolute URLs because it is served from any path
function notFoundPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found | Shinemed Pharmaceuticals</title>
<meta name="description" content="The page you requested could not be found. Browse Shinemed Pharmaceuticals products or contact us.">
<meta name="robots" content="noindex, follow">
<meta name="theme-color" content="#ffffff">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=2"><link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png?v=2"><link rel="shortcut icon" href="/favicon.ico?v=2"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
${withRoot(header, "/")}<section class="page-hero" aria-labelledby="notfound-heading"><div class="page-hero__inner"><div class="section-kicker section-kicker--center"><span aria-hidden="true"></span>ERROR 404</div>
<h1 id="notfound-heading">Page not found</h1><p class="page-hero__tagline">The page you are looking for does not exist or has moved.</p></div></section>
<section class="product-detail-section" aria-label="Where to go next"><div class="product-detail-section__inner"><p class="product-detail-enquiry"><a class="action-button action-button--primary" href="/shop.html"><span>Browse products</span></a> <a class="action-button action-button--primary" href="/"><span>Go to homepage</span></a></p></div></section>
${withRoot(footer, "/")}<script src="/js/main.js"></script>
</body>
</html>
`;
}

// --- sitemap
const STATIC_PAGES = [
  ["", "index.html", "1.0"],
  ["about.html", "about.html", "0.8"],
  ["services.html", "services.html", "0.8"],
  ["shop.html", "shop.html", "0.9"],
  ["contact.html", "contact.html", "0.8"],
];
function lastmod(...files) {
  const today = new Date().toISOString().slice(0, 10);
  let best = "";
  for (const f of files) {
    let d = today;
    try {
      const dirty = execSync(`git status --porcelain -- "${f}"`, { cwd: ROOT }).toString().trim();
      if (!dirty) d = execSync(`git log -1 --format=%cs -- "${f}"`, { cwd: ROOT }).toString().trim() || today;
    } catch { /* not a git checkout: use today */ }
    if (d > best) best = d;
  }
  return best;
}
function sitemap() {
  const row = (loc, file, prio) =>
    `  <url><loc>${loc}</loc><lastmod>${lastmod(...file)}</lastmod><priority>${prio}</priority></url>`;
  const rows = [
    ...STATIC_PAGES.map(([path, f, prio]) => row(`${SITE}/${path}`, [f], prio)),
    ...products.map((p) => row(shortUrl(p), ["data/products.json", "scripts/build.mjs", "scripts/partials/header.html", "scripts/partials/footer.html"], "0.7")),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export const helpers = { titleFor, descriptionFor, altFor, shortUrl, priceText };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const p of products) writeFileSync(join(ROOT, `shop/${p.slug}.html`), productPage(p));
  writeFileSync(join(ROOT, "404.html"), notFoundPage());
  writeFileSync(join(ROOT, "sitemap.xml"), sitemap());
  console.log(`Built ${products.length} product pages, 404.html, sitemap.xml`);
}
