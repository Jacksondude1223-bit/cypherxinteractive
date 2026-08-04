# CypherX Interactive — website

Marketing site for **CypherX Interactive**, the Roblox game development brand of
**Spheres Hosting LLC** — creators of *SMFT: Gods*, *PlushX Tycoon* and **AXIOM Anticheat**.

Static HTML, CSS and vanilla JavaScript, served from a **Cloudflare Worker** using
[Workers static assets](https://developers.cloudflare.com/workers/static-assets/). No build
step, no framework, no tracking.

## Layout

```
.
├── public/                 # everything served to the browser
│   ├── index.html · games.html · axiom.html · studio.html · contact.html
│   ├── privacy.html · terms.html · 404.html
│   ├── _headers            # security + cache headers
│   ├── robots.txt · sitemap.xml
│   └── assets/
│       ├── css/style.css   # design tokens + all components
│       ├── js/main.js      # nav, scroll reveal, counters, form
│       └── img/            # logo mark, favicon, key art (SVG)
├── wrangler.jsonc          # Worker config
├── package.json
└── .github/workflows/deploy.yml
```

Only `public/` is uploaded. Anything outside it — this README, the workflow, config —
stays out of the deployed bundle.

## Local development

```bash
npm install
npm run dev          # wrangler dev — serves on http://localhost:8787
```

`npm run check` runs `wrangler deploy --dry-run` to validate config without publishing.

## Deploying

```bash
npm run deploy       # wrangler deploy
```

Or let CI do it: `.github/workflows/deploy.yml` deploys on every push to `main`. It needs
two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with the **Edit Cloudflare Workers** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

The Worker is named `cypherx-interactive` (change `name` in `wrangler.jsonc` if you want a
different `*.workers.dev` subdomain). To serve it on a real domain, add a route or custom
domain in the Cloudflare dashboard, or a `routes` entry in `wrangler.jsonc`.

## URLs

Workers static assets treats **extensionless paths as canonical**. `/games` serves the page;
both `/games.html` and `/games/` issue a `307` to `/games`. All internal links, canonical
tags and the sitemap use the canonical form, so navigation never takes a redirect hop.

`not_found_handling: "404-page"` means any unmatched path serves `public/404.html` with a
proper 404 status.

## Headers

`public/_headers` sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` and a Content-Security-Policy.

The CSP allows `'unsafe-inline'` for **styles only** — the pages use inline `style`
attributes. Scripts get no such exemption. Removing those attributes in favour of classes
would let you drop it.

CSS and JS are cached for one hour, not a year, because filenames are not content-hashed —
a long `max-age` would strand visitors on stale styles after a deploy. Images cache for a
week. If you add a hashing build step, raise the CSS/JS values.

## Things to change before launch

1. **Domain** — `https://cypherxinteractive.com/` appears in canonical tags, Open Graph
   tags and `public/sitemap.xml`, and in `public/robots.txt`.
2. **Roblox experience links** — `public/games.html` has two "Play on Roblox" buttons
   pointing at `https://www.roblox.com/`. Replace with the real experience URLs.
3. **Social links** — Discord, Roblox group, X and GitHub URLs in every footer.
4. **Email addresses** — `hello@`, `axiom@`, `support@`, `press@` and `privacy@`
   `cypherxinteractive.com`, used across the pages and in `assets/js/main.js`.
5. **Headline figures** — the homepage stat strip ("Live titles 2", "Ops coverage 24/7")
   and the pipeline entries in `games.html` were written from the brand description.
   Confirm they're accurate or replace them.
6. **Key art** — `assets/img/art-*.svg` are original placeholder illustrations. Drop in real
   screenshots (any 16:10 crop) and update the `<img>` tags.
7. **Open Graph image** — social platforms don't render SVG previews. Export a 1200×630 PNG
   to `assets/img/og-cover.png` and update the `og:image` tags.
8. **Legal pages** — `privacy.html` and `terms.html` are drafting starting points and carry
   a visible template notice. Have them reviewed by a qualified legal adviser before you
   remove that notice.

## Contact form

The form has no backend yet. By default it opens the visitor's mail client with the message
pre-filled (`data-mailto` on the `<form>`).

To POST somewhere instead, set an endpoint on the form in `public/contact.html`:

```html
<form class="form" data-contact-form data-endpoint="https://…" novalidate>
```

`assets/js/main.js` picks it up, POSTs via `fetch`, and falls back to the mail client if the
request fails.

Since this already runs on a Worker, the natural home for that endpoint is the same Worker:
add a `main` script to `wrangler.jsonc` handling `POST /api/contact` and forwarding to an
email provider. Note that requests matching a static asset skip the script entirely, so
adding one costs nothing for normal page loads. The CSP's `connect-src 'self'` already
permits a same-origin endpoint; a third-party form service would need adding to that list.

### Design system

Tokens live at the top of `public/assets/css/style.css` under `:root` — palette, gradients,
type scale, radii, spacing. Change the brand colours there and the whole site follows.

- Base `#05070d`, surfaces `#0d111c` / `#121826`
- Brand gradient: cyan `#29e0f0` → violet `#8b5cf6`
- Status colours: green (cleared), amber (flagged), red (blocked)

### Accessibility

Skip link, semantic landmarks, `aria-current` on the active nav item, labelled form fields,
keyboard-dismissible mobile menu, visible focus rings, and full `prefers-reduced-motion`
support.

---

© Spheres Hosting LLC. CypherX Interactive is a brand of Spheres Hosting LLC.
Not affiliated with or endorsed by Roblox Corporation.
