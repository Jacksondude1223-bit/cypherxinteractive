/**
 * CypherX Interactive — accounts.
 *
 * Passwords are hashed with PBKDF2-HMAC-SHA256 through WebCrypto, which is the
 * strongest KDF the Workers runtime offers natively (no bcrypt, scrypt or
 * argon2). The iteration count is stored inside the hash string, so it can be
 * raised later and old hashes still verify; isStaleHash() spots the ones worth
 * rewriting at the next successful sign-in.
 *
 * Sessions are rows in D1 rather than signed cookies, so signing out actually
 * ends the session and a stolen cookie can be revoked. The cookie holds a
 * random token; the table holds only its SHA-256.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const SESSION_COOKIE = "cx_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TOKEN_BYTES = 32;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const EMAIL_MAX = 200;
export const NAME_MAX = 60;

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Always does the full derivation, even for a malformed stored hash, so a
 * caller cannot tell "no such user" from "wrong password" by timing.
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  const [scheme, iterationsRaw, saltRaw, hashRaw] = parts;

  const iterations = Number.parseInt(iterationsRaw, 10);
  const usable =
    parts.length === 4 &&
    scheme === "pbkdf2" &&
    Number.isFinite(iterations) &&
    iterations > 0;

  // Dummy parameters keep the work (and therefore the timing) comparable.
  const salt = usable ? unb64(saltRaw) : new Uint8Array(SALT_BYTES);
  const expected = usable ? unb64(hashRaw) : new Uint8Array(KEY_BITS / 8);
  const actual = await pbkdf2(password, salt, usable ? iterations : PBKDF2_ITERATIONS);

  return usable && timingSafeEqual(actual, expected);
}

/** True when a stored hash was made with fewer iterations than we now use. */
export function isStaleHash(stored) {
  const iterations = Number.parseInt(String(stored).split("$")[1], 10);
  return Number.isFinite(iterations) && iterations < PBKDF2_ITERATIONS;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

/** Creates a session row and returns the raw token for the cookie. */
export async function createSession(db, userId, userAgent) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const now = nowSeconds();

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      await tokenId(token),
      userId,
      now,
      now + SESSION_TTL_SECONDS,
      (userAgent || "").slice(0, 200) || null
    )
    .run();

  return { token, maxAge: SESSION_TTL_SECONDS };
}

/**
 * Resolves the session cookie to a user, or null. Expired rows are deleted on
 * the way past, which keeps the table tidy without a cron job.
 */
export async function currentUser(request, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const id = await tokenId(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.created_at, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .bind(id)
    .first();

  if (!row) return null;

  if (row.expires_at <= nowSeconds()) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export async function destroySession(request, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await tokenId(token)).run();
}

/**
 * Secure is omitted on http://localhost only — Chrome refuses to store a
 * Secure cookie there, which would make local development impossible.
 */
export function sessionCookie(token, maxAge, url) {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure} ` +
    `SameSite=Lax; Max-Age=${maxAge}`
  );
}

export function clearedSessionCookie(url) {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

async function tokenId(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return b64url(new Uint8Array(digest));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function normaliseEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function emailProblem(email) {
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX) return "That email address is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "That email address is not valid.";
  return null;
}

export function passwordProblem(password) {
  if (typeof password !== "string" || !password) return "Choose a password.";
  if (password.length < PASSWORD_MIN) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
