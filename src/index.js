/**
 * CypherX Interactive — Worker entrypoint.
 *
 * Static assets are served before this script runs, so page loads never invoke
 * it. Only paths with no matching asset reach `fetch` — in practice
 * POST /api/contact, which relays the contact form into Discord.
 *
 * A Discord webhook URL is a credential: anyone who holds it can post to the
 * channel until it is rotated. They live in Worker secrets and are never sent
 * to the browser.
 */

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

    if (url.pathname === ENDPOINT) {
      return handleContact(request, env);
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

  // Cheap cross-origin block. The form is same-origin, so a missing or
  // foreign Origin is either a bot or someone else's page posting for us.
  const origin = request.headers.get("Origin");
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return json({ error: "Bad origin" }, 403);
    }
    if (originHost !== new URL(request.url).host) {
      return json({ error: "Bad origin" }, 403);
    }
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
 * Per-IP throttle. Without one this endpoint is an open relay into the
 * Discord channel. The binding is optional so the Worker still runs locally
 * and in dev without it — but it should be configured in production.
 */
async function isRateLimited(request, env) {
  if (!env.CONTACT_LIMITER) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "anonymous";
  try {
    const { success } = await env.CONTACT_LIMITER.limit({ key: ip });
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
