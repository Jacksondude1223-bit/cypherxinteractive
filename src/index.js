/**
 * CypherX Interactive — Worker entrypoint.
 *
 * Static assets are normally served before this script runs, so ordinary page
 * loads never invoke it. Two kinds of request do reach `fetch`:
 *
 *   - /api/*, which has no matching asset: the contact relay and the account
 *     endpoints.
 *   - the paths listed under assets.run_worker_first in wrangler.jsonc
 *     (/portal, /login, /signup), where the Worker has to see the request
 *     before the asset server hands the file over.
 *
 * A Discord webhook URL is a credential: anyone who holds it can post to the
 * channel until it is rotated. They live in Worker secrets and are never sent
 * to the browser.
 */

import {
  clearedSessionCookie,
  createSession,
  currentUser,
  destroySession,
  emailProblem,
  hashPassword,
  isStaleHash,
  NAME_MAX,
  normaliseEmail,
  nowSeconds,
  passwordProblem,
  sessionCookie,
  verifyPassword,
} from "./auth.js";

const ENDPOINT = "/api/contact";

// Discord's own ceilings are 4096 for an embed description and 1024 for a
// field value. Staying under them keeps the webhook from rejecting the post.
const LIMITS = {
  name: 100,
  email: 200,
  studio: 120,
  topic: 60,
  message: 3500,
};

const TOPICS = [
  "General enquiry",
  "AXIOM licensing",
  "Partnership",
  "Player support",
  "Ban appeal",
  "Press",
  "Careers",
];

/**
 * Which secret holds the webhook for each topic, and the embed colour that
 * goes with it. Topics absent from this map (Player support, Press, Careers)
 * go to the fallbacks below, so adding an option to the form's <select> keeps
 * working before that option has a channel of its own.
 *
 * Every binding named here is optional. Set only the ones you have.
 */
const ROUTES = {
  "General enquiry": { secret: "DISCORD_WEBHOOK_GENERAL", color: 0x29e0f0 },
  Partnership: { secret: "DISCORD_WEBHOOK_PARTNERSHIPS", color: 0x8b5cf6 },
  "AXIOM licensing": { secret: "DISCORD_WEBHOOK_PARTNERSHIPS", color: 0x8b5cf6 },
  "Ban appeal": { secret: "DISCORD_WEBHOOK_APPEALS", color: 0xfbbf24 },
};

/**
 * Tried in order when a topic has no channel of its own, or when the one it
 * has is missing or malformed. General is included so a deployment that sets
 * a single webhook still receives every topic rather than answering 503.
 */
const FALLBACK_SECRETS = ["DISCORD_WEBHOOK_URL", "DISCORD_WEBHOOK_GENERAL"];

const DEFAULT_COLOR = 0x29e0f0;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\.html$/, "").replace(/(.)\/$/, "$1");

    if (path === ENDPOINT) return handleContact(request, env);

    if (path.startsWith("/api/auth/")) return handleAuth(request, env, url, path);

    // Gated page. The asset exists, so without run_worker_first the asset
    // server would hand it over before this ran.
    if (path === "/portal") return handlePortal(request, env, url);

    // Signed-in visitors have no use for these two.
    if (path === "/login" || path === "/signup") {
      if (await maybeUser(request, env)) {
        return Response.redirect(new URL("/portal", url).toString(), 302);
      }
      return env.ASSETS.fetch(request);
    }

    // Everything else is a static asset. Going through the binding keeps
    // not_found_handling ("404-page") working for unmatched paths.
    return env.ASSETS.fetch(request);
  },
};

/* ------------------------------------------------------------------ */

async function handleContact(request, env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  // Cheap cross-origin block. The form is same-origin, so a foreign Origin is
  // either a bot or someone else's page posting for us.
  if (!sameOrigin(request, new URL(request.url))) {
    return json({ error: "Bad origin" }, 403);
  }

  const fields = await readFields(request);
  if (!fields) {
    return json({ error: "Could not read the submission" }, 400);
  }

  // Honeypot. Real people never fill a field they cannot see, so a value here
  // means a bot. Answer 200 so it has no signal to adapt to.
  if (fields.company) {
    return json({ ok: true });
  }

  const name = clamp(fields.name, LIMITS.name);
  const email = clamp(fields.email, LIMITS.email);
  const message = clamp(fields.message, LIMITS.message);
  const studio = clamp(fields.studio, LIMITS.studio);
  const rawTopic = clamp(fields.topic, LIMITS.topic);
  const topic = TOPICS.includes(rawTopic) ? rawTopic : "General enquiry";

  if (!name || !email || !message) {
    return json({ error: "Name, email and message are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "That email address is not valid" }, 400);
  }

  // The topic decides the channel, so this can only be resolved once the
  // submission has been read and validated.
  const route = resolveWebhook(env, topic);
  if (!route) {
    // Misconfiguration, not the visitor's fault: stay vague in the response,
    // but log the binding names actually present so a name typo or a secret
    // added to the wrong Worker is obvious in `wrangler tail`. Names only —
    // never values.
    console.error(
      `No usable webhook for topic "${topic}". Bindings visible to this Worker: ` +
        (Object.keys(env).join(", ") || "(none)")
    );
    return json({ error: "Contact form is not configured" }, 503);
  }

  const limited = await isRateLimited(request, env);
  if (limited) {
    return json({ error: "Too many messages. Try again shortly." }, 429, {
      "Retry-After": "60",
    });
  }

  const country = request.headers.get("CF-IPCountry") || "unknown";

  const res = await fetch(route.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "CypherX Website",
      // Without this, a message containing @everyone would ping the server.
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `New enquiry — ${topic}`,
          description: message,
          color: route.color,
          fields: [
            { name: "Name", value: name, inline: true },
            { name: "Email", value: email, inline: true },
            { name: "Studio / Roblox", value: studio || "—", inline: true },
            { name: "Country", value: country, inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "cypherxinteractive.com contact form" },
        },
      ],
    }),
  });

  if (!res.ok) {
    // Name the binding, never the URL: the token is in the URL.
    console.error(
      `Discord webhook failed via ${route.binding}`,
      res.status,
      await safeText(res)
    );
    return json({ error: "Could not deliver the message" }, 502);
  }

  return json({ ok: true });
}

/* ------------------------------------------------------------------ */

/**
 * Picks the webhook for a topic: its own channel if one is configured and
 * usable, otherwise the catch-all. Returns null when neither is set, which is
 * the only case the caller treats as "not configured".
 */
function resolveWebhook(env, topic) {
  const route = ROUTES[topic];

  const candidates = route ? [route.secret] : [];
  for (const secret of FALLBACK_SECRETS) {
    if (!candidates.includes(secret)) candidates.push(secret);
  }

  for (const binding of candidates) {
    const raw = typeof env[binding] === "string" ? env[binding].trim() : "";
    if (!raw) continue;
    if (!isUsableWebhook(raw, binding)) continue;
    return { url: raw, binding, color: route ? route.color : DEFAULT_COLOR };
  }

  return null;
}

/** Logs and rejects placeholders and malformed values rather than posting into the void. */
function isUsableWebhook(raw, binding) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`${binding} is set but is not a valid URL`);
    return false;
  }

  if (!/^https?:$/.test(url.protocol) || raw.includes("replace-me")) {
    console.error(
      `${binding} looks like a placeholder or has the wrong scheme. ` +
        "Expected https://discord.com/api/webhooks/<id>/<token>"
    );
    return false;
  }

  // Warn but continue on a non-Discord host: local development points this at
  // a stub, and that must keep working.
  if (!/(^|\.)discord(app)?\.com$/.test(url.hostname)) {
    console.warn(`${binding} host is not discord.com:`, url.hostname);
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

async function handleAuth(request, env, url, path) {
  if (!env.Cypher_Bind) {
    console.error(
      "No Cypher_Bind binding. Add the d1_databases entry to wrangler.jsonc and " +
        "create the database. Bindings visible to this Worker: " +
        (Object.keys(env).join(", ") || "(none)")
    );
    return json({ error: "Accounts are not configured yet" }, 503);
  }

  if (path === "/api/auth/me") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    }
    const user = await currentUser(request, env.Cypher_Bind);
    return user
      ? json({ user: { email: user.email, displayName: user.displayName } })
      : json({ user: null }, 401);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }
  if (!sameOrigin(request, url)) {
    return json({ error: "Bad origin" }, 403);
  }

  switch (path) {
    case "/api/auth/signup":
      return handleSignup(request, env, url);
    case "/api/auth/login":
      return handleLogin(request, env, url);
    case "/api/auth/logout":
      return handleLogout(request, env, url);
    default:
      return json({ error: "Not found" }, 404);
  }
}

async function handleSignup(request, env, url) {
  const fields = await readFields(request);
  if (!fields) return json({ error: "Could not read the submission" }, 400);

  // Same honeypot as the contact form. Bots fill every field they can see.
  if (fields.company) return json({ ok: true, redirect: "/portal" });

  const email = normaliseEmail(fields.email);
  const password = typeof fields.password === "string" ? fields.password : "";
  const displayName = clamp(fields.name, NAME_MAX);

  const problem = emailProblem(email) || passwordProblem(password);
  if (problem) return json({ error: problem }, 400);

  const limited = await isRateLimited(request, env, env.AUTH_LIMITER);
  if (limited) {
    return json({ error: "Too many attempts. Try again shortly." }, 429, {
      "Retry-After": "60",
    });
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await env.Cypher_Bind.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, email, passwordHash, displayName || null, nowSeconds())
      .run();
  } catch (err) {
    // UNIQUE(email). Anything else is a genuine fault worth surfacing in logs.
    if (String(err).includes("UNIQUE")) {
      return json({ error: "There's already an account with that email." }, 409);
    }
    console.error("signup insert failed", err);
    return json({ error: "Could not create the account" }, 500);
  }

  return withSession(env.Cypher_Bind, id, request, url, { ok: true, redirect: "/portal" });
}

async function handleLogin(request, env, url) {
  const fields = await readFields(request);
  if (!fields) return json({ error: "Could not read the submission" }, 400);

  const email = normaliseEmail(fields.email);
  const password = typeof fields.password === "string" ? fields.password : "";

  if (!email || !password) {
    return json({ error: "Enter your email and password." }, 400);
  }

  const limited = await isRateLimited(request, env, env.AUTH_LIMITER);
  if (limited) {
    return json({ error: "Too many attempts. Try again shortly." }, 429, {
      "Retry-After": "60",
    });
  }

  const row = await env.Cypher_Bind.prepare(
    "SELECT id, password_hash FROM users WHERE email = ?"
  )
    .bind(email)
    .first();

  // verifyPassword derives a hash either way, so an unknown address takes the
  // same time as a wrong password and the reply is identical.
  const ok = await verifyPassword(password, row ? row.password_hash : "");
  if (!row || !ok) {
    return json({ error: "That email and password don't match an account." }, 401);
  }

  await env.Cypher_Bind.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .bind(nowSeconds(), row.id)
    .run();

  // Cheap moment to re-hash at the current cost, now that the plaintext is here.
  if (isStaleHash(row.password_hash)) {
    try {
      await env.Cypher_Bind.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(await hashPassword(password), row.id)
        .run();
    } catch (err) {
      console.error("password rehash failed", err); // Not worth failing the login.
    }
  }

  return withSession(env.Cypher_Bind, row.id, request, url, { ok: true, redirect: "/portal" });
}

async function handleLogout(request, env, url) {
  await destroySession(request, env.Cypher_Bind);
  return json({ ok: true, redirect: "/" }, 200, {
    "Set-Cookie": clearedSessionCookie(url),
  });
}

async function withSession(db, userId, request, url, body) {
  const { token, maxAge } = await createSession(
    db,
    userId,
    request.headers.get("User-Agent")
  );
  return json(body, 200, { "Set-Cookie": sessionCookie(token, maxAge, url) });
}

/** Resolves the session without exploding when D1 isn't bound yet. */
async function maybeUser(request, env) {
  if (!env.Cypher_Bind) return null;
  try {
    return await currentUser(request, env.Cypher_Bind);
  } catch (err) {
    console.error("session lookup failed", err);
    return null;
  }
}

/**
 * Serves the portal to signed-in visitors and bounces everyone else to the
 * sign-in page. The account's email is stitched into the HTML here rather than
 * fetched by the page, so nothing personal sits in a cacheable asset.
 */
async function handlePortal(request, env, url) {
  const user = await maybeUser(request, env);
  if (!user) {
    return Response.redirect(new URL("/login?next=/portal", url).toString(), 302);
  }

  const asset = await env.ASSETS.fetch(new URL("/portal", url));
  if (!asset.ok) return asset;

  const html = (await asset.text()).replace(
    "<!--account-email-->",
    escapeHtml(user.displayName || user.email)
  );

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Signed-in HTML must never sit in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // No Origin at all is not a cross-site post.
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */

/** Accepts multipart/form-data (what the page sends) or JSON. */
async function readFields(request) {
  const type = request.headers.get("Content-Type") || "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? body : null;
    }
    const form = await request.formData();
    return Object.fromEntries(form);
  } catch {
    return null;
  }
}

function clamp(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

/**
 * Per-IP throttle. Without one the contact endpoint is an open relay into the
 * Discord channel and the login endpoint is a password-guessing machine. The
 * bindings are optional so the Worker still runs locally and in dev without
 * them — but both should be configured in production.
 */
async function isRateLimited(request, env, limiter = env.CONTACT_LIMITER) {
  if (!limiter) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  try {
    const { success } = await limiter.limit({ key: ip });
    return !success;
  } catch (err) {
    // Never let the limiter failing take the form down with it.
    console.error("rate limiter error", err);
    return false;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable>";
  }
}
