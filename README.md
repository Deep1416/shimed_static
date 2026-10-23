# shimed_static

Static website for Shinemed Pharmaceuticals (shinemedpharmaceuticals.com). Upload the contents to `public_html` on Plesk. `send-mail.php` handles the contact form.

## Editing products & SEO

- Product data lives in `data/products.json` (single source of truth). Do not hand-edit `shop/<slug>.html`, `404.html` or `sitemap.xml`; they are generated.
- `npm run build` regenerates them; `npm run lint` validates titles, descriptions, canonicals, JSON-LD, price consistency, links and sitemap.
- A product only gets a price/Offer if `price` is set in the data. Offers intentionally omit `availability`.
- `shop.html` / `index.html` product cards are still hand-edited; the linter fails if `shop.html` misses a product.
- `.htaccess` sets the custom 404 page, `/index.html` -> `/` redirect, caching and compression (Apache/Plesk).
- Google Search Console: add the verification tag (`<meta name="google-site-verification" content="...">`) to `<head>` of `index.html` (or upload the HTML file Google provides to the site root). Submit `https://shinemedpharmaceuticals.com/sitemap.xml`.
