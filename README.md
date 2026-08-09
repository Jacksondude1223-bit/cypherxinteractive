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
│   ├── index.html · games.html · axiom.html · updates.html
│   ├── studio.html · contact.html
│   ├── login.html · signup.html · portal.html
│   ├── privacy.html · terms.html · 404.html
│   ├── _headers            # security + cache headers
│   ├── robots.txt · sitemap.xml
│   └── assets/
│       ├── css/style.css   # design tokens + all components
│       ├── js/main.js      # nav, scroll reveal, counters, contact form
│       ├── js/auth.js      # sign in / create account / sign out
│       └── img/            # logo mark, favicon, key art (SVG)
├── src/
│   ├── index.js            # Worker: routing, contact relay, account endpoints
│   └── auth.js             # password hashing, sessions, validation
├── migrations/             # D1 schema, applied by scripts/d1-setup.mjs
├── scripts/
│   └── d1-setup.mjs        # resolves the D1 database + migrates, pre-deploy
├── wrangler.jsonc          # Worker config
├── package.json
└── .github/workflows/deploy.yml
```

Only `public/` is uploaded. Anything outside it — this README, the workflow, config —
stays out of the deployed bundle.

## Local development

```bash
npm install
npm run dev          # creates and migrates the local D1, then serves on :8787
```

`predev` runs `scripts/d1-setup.mjs --local` first, so a fresh clone gets a working
database without any setup. `npm run db:local` does that part on its own.

`npm run check` runs `wrangler deploy --dry-run` to validate config without publishing.

The local D1 database lives in `.wrangler/` and is gitignored. Delete that directory to
start from an empty one.

## Deploying

```bash
npm run deploy       # d1-setup, then wrangler deploy
```

Use the npm script rather than `npx wrangler deploy`. The `predeploy` hook runs
`scripts/d1-setup.mjs`, which points the config at the real D1 database and applies any
pending migrations first. Calling wrangler directly skips that and deploys the placeholder
id, which fails.

Or let CI do it: `.github/workflows/deploy.yml` deploys on every push to `main`. It needs
two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Edit Cloudflare Workers** and **D1:Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

D1:Edit is what lets the workflow look up, and if necessary create, the database. Without
it the Prepare D1 step fails with a permissions error from the API rather than something
confusing later on.

One optional repository **variable**:

| Variable | When to set it |
| --- | --- |
| `D1_DATABASE_NAME` | The account has several D1 databases and the right one isn't matched by the name in `wrangler.jsonc` |

The workflow deploys on a push to **whichever branch is currently the repository default**.
It listens on `main` and `claude/cypherx-interactive-website-ezjwrn` (the default today) and
the job itself checks `github.event.repository.default_branch`, so a push to the non-default
one is a no-op. Switch the default to `main` later and deploys follow it with no edit here;
rename it to something else and add that name to the trigger list.

`workflow_dispatch` ignores all of that, so a manual run deploys from wherever you launch it.

The Worker is named `cypherx-interactive` (change `name` in `wrangler.jsonc` if you want a
different `*.workers.dev` subdomain). To serve it on a real domain, add a route or custom
domain in the Cloudflare dashboard, or a `routes` entry in `wrangler.jsonc`.

## URLs

Workers static assets treats **extensionless paths as canonical**. `/games` serves the page;
both `/games.html` and `/games/` issue a `307` to `/games`. All internal links, canonical
tags and the sitemap use the canonical form, so navigation never takes a redirect hop.

`not_found_handling: "404-page"` means any unmatched path serves `public/404.html` with a
proper 404 status.

### run_worker_first is an allowlist

`assets.run_worker_first` in `wrangler.jsonc` lists the paths that reach the Worker before
the asset server gets a look:

```
/api/*  /portal  /portal.html  /portal/*  /login  /login.html  /signup  /signup.html
```

Once that array exists it is the **whole** list — everything else is served straight off
the asset server. `/api/*` has to be in it or the endpoints stop working in a way that
looks like a routing bug: `405` on POST, and the 404 page on GET, both from the asset
server rather than from `src/index.js`. Add any future API path or gated page here.

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
5. **Headline figures** — the homepage stat strip ("Live titles 2", "On call 24/7") and the
   pipeline entries in `games.html` were written from the brand description. Confirm they're
   accurate or replace them.
6. **Devlog entries** — `public/updates.html` ships with sample patch notes, a post-mortem
   and version numbers that are illustrative, not real history. Replace them with actual
   releases before launch; the homepage teaser repeats the three most recent, so update both.
   Dates, percentages and the "one flag in forty" figure on the AXIOM page all come from the
   same sample set.
7. **Key art** — `assets/img/art-*.svg` are original placeholder illustrations. Drop in real
   screenshots (any 16:10 crop) and update the `<img>` tags.
8. **Open Graph image** — social platforms don't render SVG previews. Export a 1200×630 PNG
   to `assets/img/og-cover.png` and update the `og:image` tags.
9. **Legal pages** — `privacy.html` and `terms.html` are drafting starting points and carry
   a visible template notice. Have them reviewed by a qualified legal adviser before you
   remove that notice. They do not yet mention accounts; the signup page tells people we
   store an email address and a password hash, and the notice should say the same.
10. **D1 API token scope** — the placeholder `database_id` in `wrangler.jsonc` is filled in
    at deploy time by `scripts/d1-setup.mjs`, so there is nothing to paste. The one thing
    to check is that `CLOUDFLARE_API_TOKEN` carries **D1:Edit** as well as Workers
    Scripts:Edit, or that step fails. See below.

## Accounts and the member portal

Visitors can create an account at `/signup`, sign in at `/login`, and reach `/portal`,
which currently says the portal is coming soon. Accounts live in **Cloudflare D1**.

### Setting it up

Nothing to do by hand. `scripts/d1-setup.mjs` runs before every deploy — as the `predeploy`
hook on `npm run deploy`, and as the **Prepare D1** step in CI — and it:

1. asks Cloudflare which D1 databases the account has;
2. picks the one this Worker should use;
3. writes that name and id into `wrangler.jsonc` in the working copy;
4. applies any migrations that have not run yet.

Step 3 edits the checkout. CI throws that away when the job ends, so **the placeholder stays
in the repo on purpose** and the real id is filled in at deploy time. Run it locally
(`npm run db:setup`) and the edit is a genuine change you can commit if you'd rather pin it.

How step 2 chooses:

| Situation | What happens |
| --- | --- |
| A database matches `database_name` | Used |
| The account has none at all | One is created with that name |
| The account has exactly one, and the config still holds the placeholder id | That one is adopted, and the script says so in the log |
| The account has several and none match | Fails, listing them, and asks for `D1_DATABASE_NAME` |

Set `D1_DATABASE_NAME` (env var locally, repository variable in CI) to pin a specific
database and skip the guessing.

The Worker reads `env.Cypher_Bind`, so the `binding` in `wrangler.jsonc` has to match the
binding name on the database in the Cloudflare dashboard. The script never touches
`binding` — rename it in both places together or not at all.

Local development needs none of this: `npm run dev` runs the same script with `--local`
first, which builds a SQLite copy under `.wrangler/` and migrates it. No account, no id, no
network.

Doing it manually instead:

```bash
npx wrangler d1 list                                     # name + database_id
npx wrangler d1 create cypherx-portal                    # or make a new one
npx wrangler d1 migrations apply <database_name> --remote
```

### Schema

`migrations/0001_create_users_and_sessions.sql` creates two tables:

| Table | Holds |
| --- | --- |
| `users` | uuid, email (lowercased, unique), password hash, optional display name, timestamps |
| `sessions` | SHA-256 of the session token, user id, created/expires, truncated user agent |

### How a session works

Signing up or in creates a row in `sessions` and sets a cookie:

```
cx_session=<random 32 bytes>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
```

Only the SHA-256 of that token is stored, so a database read does not hand anyone a live
session. Because sessions are rows rather than signed cookies, signing out actually ends
the session and any session can be revoked with a `DELETE`. Expired rows are cleaned up
whenever they are next looked at, so no cron job is needed. `Secure` is omitted on
`http://localhost` only, because Chrome refuses to store a Secure cookie there.

### Passwords

PBKDF2-HMAC-SHA256 via WebCrypto, 100,000 iterations, 16-byte salt, stored as
`pbkdf2$<iterations>$<salt>$<hash>`. Workers has no bcrypt, scrypt or argon2, so this is
the strongest option available in the runtime.

**Cost:** one verification measures ~55 ms of CPU on the dev machine. The Workers **free**
plan caps CPU at 10 ms per invocation, so sign-in will exceed it there; Workers Paid
defaults to 30 s and has plenty of room. If you must stay on the free plan, lower
`PBKDF2_ITERATIONS` in `src/auth.js` and accept the weaker hash.

The iteration count is stored inside each hash, so raising it later is safe: old hashes
still verify, and `isStaleHash()` triggers a re-hash at the next successful sign-in.

### Endpoints

| Route | Method | Behaviour |
| --- | --- | --- |
| `/api/auth/signup` | POST | Creates the account, signs in. `409` if the email is taken |
| `/api/auth/login` | POST | `401` on a bad pair, with wording that does not say which half was wrong |
| `/api/auth/logout` | POST | Deletes the session row and clears the cookie |
| `/api/auth/me` | GET | `{ user }` or `401` |
| `/portal` | GET | Redirects to `/login?next=/portal` without a session |

Shared guards: `403` on a cross-origin POST, `429` past 10 attempts per IP per minute
(`AUTH_LIMITER`), `503` when the `Cypher_Bind` binding is absent, and the same honeypot the contact
form uses.

A login for an address with no account still runs the full key derivation against a dummy
hash, so timing does not reveal which emails are registered. Measured across four attempts
each: 58 ms unknown, 60 ms known.

Signup does say when an email is already registered. That leaks membership, and the
alternative — accepting the signup silently and sending a "you already have an account"
email — needs an email provider this project does not have yet. Worth revisiting alongside
password resets.

### The portal page is not a public asset

`public/portal.html` would be served to anyone who asked for it if the asset server saw
the request first, so `/portal` is in `run_worker_first` and `src/index.js` checks the
session before calling `env.ASSETS.fetch()`. It then substitutes the signed-in account into
a placeholder comment in the HTML and responds `Cache-Control: private, no-store`, so
nothing personal is ever baked into a cacheable asset. `/login` and `/signup` are on the list too, so a signed-in visitor is
redirected to the portal server-side instead of watching the form flash first.

### Not built yet

Password reset, email verification, self-service account deletion, and any actual portal
content. The sign-in page points people at `support@` for resets, and the portal points
them at `support@` for deletion.

## Contact form → Discord

Submitting the form POSTs same-origin to `/api/contact`. The Worker (`src/index.js`)
validates it and relays it to a Discord channel via webhook, picking the channel from the
**Topic** the visitor selected.

**A webhook URL never reaches the browser.** It is a credential — anyone holding it can post
to that channel until it is rotated — so each one lives in a Worker secret:

```bash
npx wrangler secret put DISCORD_WEBHOOK_GENERAL
npx wrangler secret put DISCORD_WEBHOOK_PARTNERSHIPS
npx wrangler secret put DISCORD_WEBHOOK_APPEALS
# paste the URL from Discord: Server Settings → Integrations → Webhooks
```

For local development, copy `.dev.vars.example` to `.dev.vars` and put the URLs there.
`.dev.vars` is gitignored.

### Topic routing

| Topic in the form | Secret | Embed colour |
| --- | --- | --- |
| General enquiry | `DISCORD_WEBHOOK_GENERAL` | cyan |
| Partnership | `DISCORD_WEBHOOK_PARTNERSHIPS` | violet |
| AXIOM licensing | `DISCORD_WEBHOOK_PARTNERSHIPS` | violet |
| Ban appeal | `DISCORD_WEBHOOK_APPEALS` | amber |
| Player support · Press · Careers | fallback | cyan |

The routing table is `ROUTES` at the top of `src/index.js`. To give one of the fallback
topics its own channel, add a line there and set the matching secret — no other change is
needed.

Every secret is optional. When a topic's own webhook is missing, malformed, or still the
`replace-me` placeholder, the Worker falls back to `DISCORD_WEBHOOK_URL` (the older
single-channel setup) and then to `DISCORD_WEBHOOK_GENERAL`, so a deployment holding one
webhook still receives everything. Only when none of them resolve does the endpoint return
`503` and the page show its fallback message.

Failures name the *binding* in the log, never the URL — the token is part of the URL, and
logs are not the place for it.

### What the endpoint does

| Guard | Behaviour |
| --- | --- |
| Non-POST | `405` |
| Cross-origin POST | `403` |
| Missing name / email / message | `400` |
| Malformed email | `400` |
| Honeypot field filled | `200`, silently dropped, nothing relayed |
| More than 5 posts/minute per IP | `429` with `Retry-After` |
| No webhook resolves for the topic | `503`, binding names logged |
| Discord rejects the post | `502`, logged server-side |

Validation runs before the webhook is chosen, since the topic decides the channel. A
submission that fails validation never reaches Discord.

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
