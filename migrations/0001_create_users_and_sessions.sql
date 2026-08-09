-- CypherX Interactive — accounts and sessions.
--
-- Apply with:
--   npx wrangler d1 migrations apply cypherx-portal --local    (development)
--   npx wrangler d1 migrations apply cypherx-portal --remote   (production)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- uuid v4
  email         TEXT NOT NULL UNIQUE,      -- always stored lowercased and trimmed
  password_hash TEXT NOT NULL,             -- pbkdf2$<iterations>$<salt>$<hash>, all base64
  display_name  TEXT,
  created_at    INTEGER NOT NULL,          -- unix seconds
  last_login_at INTEGER
);

-- Sessions are server-side so they can be revoked. The cookie carries a random
-- token; only its SHA-256 lives here, so a leaked database read does not hand
-- anyone a usable session.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,             -- sha256(token), base64url
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,             -- unix seconds
  expires_at INTEGER NOT NULL,             -- unix seconds
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
