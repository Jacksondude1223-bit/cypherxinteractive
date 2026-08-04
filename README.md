# CypherX Interactive — website

Marketing site for **CypherX Interactive**, the Roblox game development brand of
**Spheres Hosting LLC** — creators of *SMFT: Gods*, *PlushX Tycoon* and **AXIOM Anticheat**.

Static HTML, CSS and vanilla JavaScript. No build step, no dependencies, no tracking.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage — hero, capabilities, games, AXIOM spotlight, process, studio, CTA |
| `games.html` | Title pages for SMFT: Gods and PlushX Tycoon, plus the pipeline |
| `axiom.html` | AXIOM Anticheat product page — principles, pipeline, coverage, FAQ |
| `studio.html` | About the studio and Spheres Hosting LLC |
| `contact.html` | Contact form and direct channels |
| `privacy.html` / `terms.html` | Legal templates (see the caveat below) |
| `404.html` | Not-found page |

## Running it locally

Any static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

A GitHub Actions workflow (`.github/workflows/deploy.yml`) publishes the repository root to
GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Build and
deployment → Source: GitHub Actions**.

Using a custom domain? Add a `CNAME` file containing the domain at the repository root and
point the DNS at GitHub Pages. The site also drops straight onto Netlify, Cloudflare Pages,
Vercel or any static host — just serve the root directory.

## Things to change before launch

These are the placeholders left in the markup. Search for them and swap in the real values.

1. **Domain** — `https://cypherxinteractive.com/` appears in the `canonical`, Open Graph and
   `sitemap.xml` URLs, and in `robots.txt`.
2. **Roblox experience links** — `games.html` has two "Play on Roblox" buttons pointing at
   `https://www.roblox.com/`. Replace with the real experience URLs.
3. **Social links** — Discord, Roblox group, X and GitHub URLs in every footer.
4. **Email addresses** — `hello@`, `axiom@`, `support@`, `press@` and `privacy@`
   `cypherxinteractive.com`. Used in `contact.html`, `privacy.html`, `terms.html` and
   `assets/js/main.js`.
5. **Headline figures** — the homepage stat strip ("Live titles 2", "Ops coverage 24/7") and the
   pipeline entries in `games.html` are written from the brand description. Confirm they're
   accurate, or replace with real numbers once you have them.
6. **Key art** — `assets/img/art-*.svg` are original placeholder illustrations. Drop in real
   screenshots or thumbnails (1600×1000 or any 16:10 crop) and update the `<img>` tags.
7. **Open Graph image** — social platforms don't render SVG previews. Export a 1200×630 PNG,
   save it as `assets/img/og-cover.png` and update the `og:image` tags.
8. **Legal pages** — `privacy.html` and `terms.html` are drafting starting points and carry a
   visible template notice. Have them reviewed by a qualified legal adviser and remove the
   notice once they reflect your real practices.

## Contact form

The site is static, so the form has no server behind it. Out of the box it opens the visitor's
mail client with the message pre-filled (`data-mailto` on the `<form>`).

To post to a real endpoint instead — Formspree, Basin, a Cloudflare Worker, anything that
accepts `multipart/form-data` — add the URL to the form tag in `contact.html`:

```html
<form class="form" data-contact-form data-endpoint="https://formspree.io/f/XXXXXXX" novalidate>
```

`assets/js/main.js` picks it up automatically, POSTs via `fetch`, and falls back to the mail
client if the request fails.

## Structure

```
.
├── index.html · games.html · axiom.html · studio.html · contact.html
├── privacy.html · terms.html · 404.html
├── robots.txt · sitemap.xml
├── assets/
│   ├── css/style.css      # design tokens + all components, ~1 file
│   ├── js/main.js         # nav, scroll reveal, counters, form
│   └── img/               # logo mark, favicon, key art (SVG)
└── .github/workflows/deploy.yml
```

### Design system

Tokens live at the top of `assets/css/style.css` under `:root` — palette, gradients, type
scale, radii and spacing. Change the brand colours there and the whole site follows.

- Base `#05070d`, surfaces `#0d111c` / `#121826`
- Brand gradient: cyan `#29e0f0` → violet `#8b5cf6`
- Status colours: green (cleared), amber (flagged), red (blocked)

### Accessibility

Skip link, semantic landmarks, `aria-current` on the active nav item, labelled form fields,
keyboard-dismissible mobile menu, visible focus rings, and full `prefers-reduced-motion`
support (animations and scroll reveals disable themselves).

---

© Spheres Hosting LLC. CypherX Interactive is a brand of Spheres Hosting LLC.
Not affiliated with or endorsed by Roblox Corporation.
