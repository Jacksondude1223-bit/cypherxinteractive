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

## Contact form → Discord

Submitting the form POSTs same-origin to `/api/contact`. The Worker (`src/index.js`)
validates it and relays it to a Discord channel via webhook.

**The webhook URL never reaches the browser.** It is a credential — anyone holding it can
post to that channel until it is rotated — so it lives in a Worker secret:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
# paste the URL from Discord: Server Settings → Integrations → Webhooks
```

For local development, copy `.dev.vars.example` to `.dev.vars` and put the URL there.
`.dev.vars` is gitignored.

Without the secret set, the endpoint returns `503` and the page shows the fallback message.

### What the endpoint does

| Guard | Behaviour |
| --- | --- |
| Non-POST | `405` |
| Cross-origin POST | `403` |
| Missing name / email / message | `400` |
| Malformed email | `400` |
| Honeypot field filled | `200`, silently dropped, nothing relayed |
| More than 5 posts/minute per IP | `429` with `Retry-After` |
| Discord rejects the post | `502`, logged server-side |

Two details worth keeping if you edit the relay:

- **`allowed_mentions: { parse: [] }`** — without it, a message containing `@everyone` would
  ping the whole server. Anyone on the internet can submit this form.
- **Field clamping** — Discord caps embed descriptions at 4096 characters and field values at
  1024. Oversized input is truncated rather than rejected by Discord.

The honeypot is a `company` field, positioned off-screen with `tabindex="-1"` inside an
`aria-hidden` wrapper, so people never see it and screen readers and keyboards skip it. Bots
that fill every input get a cheerful `200` and go nowhere.

The rate limiter is the `CONTACT_LIMITER` binding in `wrangler.jsonc`. If it is ever removed
the form still works — the Worker treats a missing limiter as "allow" so the endpoint cannot
be taken down by its own protection — but it would then be an open relay into your Discord.

Submissions include the visitor's country (from `CF-IPCountry`) for triage. IP addresses are
deliberately not sent to Discord.

To use something other than Discord (Formspree, Basin, your own service), point the form
elsewhere in `public/contact.html`:

```html
<form class="form" data-contact-form data-endpoint="https://…" novalidate>
```

A third-party host would also need adding to `connect-src` in `public/_headers` — the CSP
currently allows same-origin requests only.

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
