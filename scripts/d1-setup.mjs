/**
 * Makes the D1 database ready before a deploy, so nobody has to paste an id
 * into wrangler.jsonc by hand.
 *
 *   node scripts/d1-setup.mjs              resolve the database, then migrate --remote
 *   node scripts/d1-setup.mjs --local      migrate the local SQLite copy only
 *   node scripts/d1-setup.mjs --preflight  check the config is deployable, change nothing
 *
 * This has to run BEFORE wrangler starts, which is why it is the `predeploy`
 * npm hook and not wrangler's `build.command`: wrangler parses wrangler.jsonc
 * before it runs the build command, so a build step editing the file cannot
 * affect the deploy it belongs to. Deploy with `npm run deploy`.
 *
 * Remote runs do three things:
 *
 *   1. Ask Cloudflare which D1 databases the account has.
 *   2. Work out which one this Worker should use, creating it if the account
 *      has none at all.
 *   3. Write that name and id into wrangler.jsonc, then apply any migrations
 *      that have not run yet.
 *
 * Step 3 edits the working copy. In CI that copy is thrown away afterwards; run
 * it locally and the edit is a real change worth committing.
 *
 * Authentication is whatever wrangler already uses: CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID in CI, or `wrangler login` at a terminal. The token
 * needs **D1:Edit** on top of Workers Scripts:Edit. Set D1_DATABASE_NAME to
 * pin a specific database when the account has several.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG = new URL("../wrangler.jsonc", import.meta.url);

/* ------------------------------------------------------------------ *
 * Pure helpers, exported so the tests can drive them without a network
 * ------------------------------------------------------------------ */

/** Strips // and /* *\/ comments, leaving anything inside a string alone. */
export function stripJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }

  // Trailing commas are legal in JSONC and fatal to JSON.parse.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function readD1Config(text) {
  const parsed = JSON.parse(stripJsonc(text));
  const entry = (parsed.d1_databases || [])[0];
  if (!entry) throw new Error("wrangler.jsonc has no d1_databases entry");
  return { binding: entry.binding, name: entry.database_name, id: entry.database_id };
}

const PLACEHOLDER_ID = /^0+(-0+)*$/;

export function isPlaceholderId(id) {
  return !id || PLACEHOLDER_ID.test(id);
}

/**
 * Decides which database to use.
 *
 * A configured id wins outright — it is unambiguous, and it means the config
 * keeps working when the name in it was a guess. A name match is next. Failing
 * both, an account with no databases gets a new one, and an account with
 * exactly one gets that one, on the grounds that a project with a single D1
 * database and a placeholder in its config means the two were meant to be each
 * other. Two or more is genuinely ambiguous and the caller has to say which,
 * because guessing wrong points the Worker at someone else's data.
 */
export function chooseDatabase(configured, existing) {
  if (!isPlaceholderId(configured.id)) {
    const byId = existing.find((db) => db.id === configured.id);
    if (byId) return { action: "matched", name: byId.name, id: byId.id };
  }

  const byName = existing.find((db) => db.name === configured.name);
  if (byName) return { action: "matched", name: byName.name, id: byName.id };

  if (existing.length === 0) {
    return { action: "create", name: configured.name, id: null };
  }

  if (existing.length === 1 && isPlaceholderId(configured.id)) {
    return { action: "adopted", name: existing[0].name, id: existing[0].id };
  }

  const names = existing.map((db) => db.name).join(", ");
  throw new Error(
    `No D1 database named "${configured.name}", and this account has ${existing.length} ` +
      `to choose from: ${names}.\n` +
      "Set D1_DATABASE_NAME to the one this Worker should use, or put its name in " +
      "wrangler.jsonc."
  );
}

/** Rewrites database_name and database_id inside the d1_databases block only. */
export function writeD1Config(text, { name, id }) {
  const start = text.indexOf('"d1_databases"');
  if (start === -1) throw new Error("wrangler.jsonc has no d1_databases entry");
  const end = text.indexOf("]", start);
  if (end === -1) throw new Error("d1_databases entry is not closed");

  const before = text.slice(0, start);
  const block = text.slice(start, end);
  const after = text.slice(end);

  const patched = block
    .replace(/("database_name"\s*:\s*)"[^"]*"/, `$1"${name}"`)
    .replace(/("database_id"\s*:\s*)"[^"]*"/, `$1"${id}"`);

  return before + patched + after;
}

/** `wrangler d1 list --json` has used both keys for the id over the years. */
export function normaliseList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((db) => ({ name: db.name, id: db.uuid || db.database_id || db.id }))
    .filter((db) => db.name && db.id);
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function wrangler(args, { capture = false } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: process.env,
  });
}

/**
 * Runs as wrangler's build command, which fires on `dev` as well as `deploy`,
 * so it must be quick and must not touch the network. All it does is stop a CI
 * deploy that is about to fail on the placeholder id, with a message that beats
 * the API's "database '00000000-…' was not found".
 */
function preflight(configured) {
  const inCI = Boolean(process.env.WORKERS_CI || process.env.CI);
  if (!inCI || !isPlaceholderId(configured.id)) return;

  throw new Error(
    "wrangler.jsonc still has the placeholder D1 database_id, so this deploy " +
      "would fail.\n" +
      "  This build ran `wrangler deploy` directly, which skips the setup step. " +
      "Either:\n" +
      "  - set the deploy command to `npm run deploy` (Workers Builds → Settings " +
      "→ Build), which resolves the id first; or\n" +
      "  - run `npm run db:setup` once and commit the database_id it writes."
  );
}

function main() {
  const local = process.argv.includes("--local");
  const text = readFileSync(CONFIG, "utf8");
  const configured = readD1Config(text);

  if (process.argv.includes("--preflight")) {
    preflight(configured);
    return;
  }

  if (local) {
    // The local database is a SQLite file keyed by name; no id, no account, no
    // network. Handy for `npm run dev` on a fresh clone.
    console.log(`d1-setup: migrating local database "${configured.name}"`);
    wrangler(["d1", "migrations", "apply", configured.name, "--local"]);
    return;
  }

  // CI authenticates with CLOUDFLARE_API_TOKEN; a developer at a terminal has
  // usually run `wrangler login` instead. Don't insist on the token — let
  // wrangler use whichever it has and report its own auth error if it has
  // neither, since its message is better than anything invented here.
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log("d1-setup: no CLOUDFLARE_API_TOKEN, relying on wrangler's own login");
  }

  const wanted = { ...configured, name: process.env.D1_DATABASE_NAME || configured.name };

  const existing = normaliseList(
    JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }) || "[]")
  );

  let choice = chooseDatabase(wanted, existing);

  if (choice.action === "create") {
    console.log(`d1-setup: no D1 databases on this account, creating "${choice.name}"`);
    wrangler(["d1", "create", choice.name]);
    const after = normaliseList(
      JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }) || "[]")
    );
    const created = after.find((db) => db.name === choice.name);
    if (!created) throw new Error(`Created "${choice.name}" but it is not in d1 list`);
    choice = { action: "created", ...created };
  }

  if (choice.action === "adopted") {
    console.log(
      `d1-setup: wrangler.jsonc has a placeholder id and this account has exactly ` +
        `one D1 database, so using "${choice.name}" (${choice.id}). Set ` +
        "D1_DATABASE_NAME if that is the wrong one."
    );
  }

  if (choice.name !== configured.name || choice.id !== configured.id) {
    writeFileSync(CONFIG, writeD1Config(text, choice));
    console.log(
      `d1-setup: wrangler.jsonc now points at "${choice.name}" (${choice.id}). ` +
        "Commit that if you are running this locally."
    );
  } else {
    console.log(`d1-setup: wrangler.jsonc already points at "${choice.name}"`);
  }

  console.log(`d1-setup: applying migrations to "${choice.name}"`);
  wrangler(["d1", "migrations", "apply", choice.name, "--remote"]);
  console.log("d1-setup: done");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`d1-setup: ${err.message}`);
    process.exit(1);
  }
}
