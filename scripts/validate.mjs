// Static SEO checks over the built site. Exit code 1 on any failure. `npm run lint` / `npm test`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { ROOT, SITE, products, helpers } from "./build.mjs";

const errors = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);
const pages = [
  ...readdirSync(ROOT).filter((f) => f.endsWith(".html") && !/^google[0-9a-f]+\.html$/.test(f)), // Search Console verification files are not pages
  ...readdirSync(join(ROOT, "shop")).filter((f) => f.endsWith(".html")).map((f) => `shop/${f}`),
];
const get = (re, s) => (s.match(re) || [])[1];
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const titles = new Map();
const descs = new Map();

for (const page of pages) {
  const html = readFileSync(join(ROOT, page), "utf8");
  const isError = page === "404.html";
  const title = get(/<title>([^<]*)<\/title>/, html);
  const desc = get(/<meta name="description" content="([^"]*)"/, html);
  const canon = get(/<link rel="canonical" href="([^"]*)"/, html);
  if (!title) fail(page, "missing <title>");
  if (!desc) fail(page, "missing meta description");
  if ((html.match(/<h1[ >]/g) || []).length !== 1) fail(page, "expected exactly one <h1>");
  if (/localhost|127\.0\.0\.1|staging/.test(html)) fail(page, "localhost/staging reference");
  if (title) titles.set(title, [...(titles.get(title) || []), page]);
  if (desc) descs.set(desc, [...(descs.get(desc) || []), page]);

  if (isError) {
    if (!/noindex/.test(html)) fail(page, "404 must be noindex");
  } else {
    const expect = page === "index.html" ? `${SITE}/` : `${SITE}/${page}`;
    if (canon !== expect) fail(page, `canonical ${canon} != ${expect}`);
    for (const prop of ["og:title", "og:description", "og:url", "og:image", "og:type"])
      if (!html.includes(`property="${prop}"`)) fail(page, `missing ${prop}`);
    if (!html.includes('name="twitter:card"')) fail(page, "missing twitter:card");
    if (get(/property="og:url" content="([^"]*)"/, html) !== expect) fail(page, "og:url != canonical");
  }

  // JSON-LD must parse; no duplicate @type per page
  const seen = new Set();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(m[1]); } catch (e) { fail(page, `invalid JSON-LD: ${e.message}`); continue; }
    if (seen.has(j["@type"])) fail(page, `duplicate JSON-LD ${j["@type"]}`);
    seen.add(j["@type"]);
    if (JSON.stringify(j).includes("InStock")) fail(page, "unsupported availability claim in JSON-LD");
  }

  // images: alt + dimensions; internal links resolve
  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="[^"]+"/.test(img[0])) fail(page, `img without alt: ${img[0].slice(0, 80)}`);
    if (!/\bwidth="\d+"/.test(img[0]) && /shop\//.test(img[0]) && /product|shop-card/.test(img[0])) fail(page, "product img without width/height");
  }
  if (!isError)
    for (const m of html.matchAll(/(?:href|src|srcset)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
      const ref = m[1];
      if (/^(https?:|mailto:|tel:|\/\/|data:)/.test(ref) || ref === "") continue;
      const target = resolve(dirname(join(ROOT, page)), ref.endsWith("/") ? ref + "index.html" : ref);
      if (!existsSync(target)) fail(page, `broken link/asset: ${ref}`);
    }
}
for (const [t, ps] of titles) if (ps.length > 1) fail(ps.join(", "), `duplicate title "${t}"`);
for (const [d, ps] of descs) if (ps.length > 1) fail(ps.join(", "), "duplicate meta description");

// product pages vs data (single source of truth)
let withOffer = 0;
const slugs = new Set();
for (const p of products) {
  const page = `shop/${p.slug}.html`;
  if (slugs.has(p.slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) fail(page, "bad/duplicate slug");
  slugs.add(p.slug);
  if (!existsSync(join(ROOT, page))) { fail(page, "page missing; run npm run build"); continue; }
  const html = readFileSync(join(ROOT, page), "utf8");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const prod = ld.find((j) => j["@type"] === "Product");
  const crumbs = ld.find((j) => j["@type"] === "BreadcrumbList");
  if (!crumbs) { fail(page, "missing BreadcrumbList JSON-LD"); continue; }
  if (p.price == null && prod) fail(page, "Product JSON-LD without a price (invalid for Google)");
  if (p.price != null && !prod) { fail(page, "priced product missing Product JSON-LD"); continue; }
  if (prod && prod.name !== p.name) fail(page, "Product name != data");
  if (get(/<title>([^<]*)<\/title>/, html) !== helpers.titleFor(p).replace(/&/g, "&amp;")) fail(page, "title not in sync with data");
  const visible = get(/<p class="product-detail-price">(₹[\d.]+)/, html);
  if (p.price != null) {
    withOffer++;
    if (!visible) fail(page, "price in data but not visible");
    if (!prod?.offers || `₹${prod.offers.price}` !== visible) fail(page, `JSON-LD price ${prod.offers?.price} != visible ${visible}`);
    if (prod.offers.priceCurrency !== "INR") fail(page, "currency must be INR");
  } else if (visible) fail(page, "price shown without data");
  for (const need of ['class="breadcrumb"', 'id="disclaimer-heading"', "should not be considered medical advice", p.composition.replace(/&/g, "&amp;"), "<picture>"])
    if (!html.includes(need)) fail(page, `missing visible content: ${need}`);
  if (!existsSync(join(ROOT, "shop", p.image))) fail(page, `image missing: ${p.image}`);
}

// listing page links every product; sitemap covers every indexable page exactly once
const shop = readFileSync(join(ROOT, "shop.html"), "utf8");
for (const p of products) if (!shop.includes(`href="shop/${p.slug}.html"`)) fail("shop.html", `no link to ${p.slug}`);
const sm = readFileSync(join(ROOT, "sitemap.xml"), "utf8");
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const want = pages.filter((p) => p !== "404.html").map((p) => (p === "index.html" ? `${SITE}/` : `${SITE}/${p}`));
for (const w of want) if (!locs.includes(w)) fail("sitemap.xml", `missing ${w}`);
for (const l of locs) if (!want.includes(l)) fail("sitemap.xml", `unexpected ${l}`);
if (new Set(locs).size !== locs.length) fail("sitemap.xml", "duplicate <loc>");
const robots = readFileSync(join(ROOT, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("robots.txt", "missing Sitemap line");
if (/Disallow:\s*\/(shop|css|js)?\s*$/m.test(robots)) fail("robots.txt", "blocks crawl-critical paths");

console.log(`${pages.length} pages, ${products.length} products (${withOffer} priced), ${locs.length} sitemap URLs`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("All SEO checks passed.");
