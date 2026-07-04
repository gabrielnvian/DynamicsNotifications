import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { Config } from "./config.ts";
import type { Role } from "./auth.ts";

// Stateless signed-cookie session for the dashboard login form (no session store).
// The cookie is `<expiryMs>.<role>.<hmac>`; the signed role is what the route gate trusts.
//
// The HMAC key is a DEDICATED secret (SESSION_SECRET env, else a random key persisted at
// cfg.sessionKeyPath in the kept data/ dir) — deliberately NOT derived from the dashboard
// credentials, so redeploys and password changes DON'T log everyone out. The key is
// resolved once and cached; the persisted file survives updates because data/ is kept.

const COOKIE = "dash_session";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — sliding (refreshed on app open, see index.ts)

const KEY_RE = /^[0-9a-f]{64}$/; // 32 random bytes, hex

// Read the persisted key, or null if absent/unreadable/malformed (→ regenerate). A
// partially-written or corrupt file is treated as absent rather than used as a weak key.
function loadPersistedKey(path: string): string | null {
  if (!existsSync(path)) return null;
  let k: string;
  try {
    k = readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
  if (!KEY_RE.test(k)) {
    console.error(`[session] malformed key at ${path}; regenerating`);
    return null;
  }
  // The signing key is a secret — tighten perms if it's group/other-accessible.
  try {
    if ((statSync(path).mode & 0o077) !== 0) {
      chmodSync(path, 0o600);
      console.error(`[session] tightened ${path} to 0600 (was group/other-readable)`);
    }
  } catch {
    /* best effort */
  }
  return k;
}

// Atomic write (temp + rename) so a crash mid-write can't leave a half-written key.
function persistKey(path: string, key: string): boolean {
  try {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, key, { mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

let cachedKey: string | null = null;
let warnedNoPersist = false;
/** The dedicated cookie-signing key: explicit env override, else a persisted random key.
 *  Never derived from credentials — that would silently reintroduce the deploy-logout bug. */
function signingKey(cfg: Config): string {
  if (cfg.sessionSecret) return cfg.sessionSecret; // explicit — no fs, no cache
  if (cachedKey) return cachedKey;

  const existing = loadPersistedKey(cfg.sessionKeyPath);
  if (existing) return (cachedKey = existing);

  const key = randomBytes(32).toString("hex");
  if (persistKey(cfg.sessionKeyPath, key)) return (cachedKey = key);

  // Couldn't persist (read-only / full data dir — the app is barely usable then, since
  // SQLite needs the same dir). Use an in-memory key: still decoupled from credentials
  // (no silent security downgrade), but sessions reset on restart until the operator
  // fixes data/ writability or sets SESSION_SECRET. Warn loudly, once.
  if (!warnedNoPersist) {
    warnedNoPersist = true;
    console.error(
      `[session] could not persist a signing key at ${cfg.sessionKeyPath}; using an ` +
        `in-memory key (sessions reset on restart). Fix data/ writability or set SESSION_SECRET.`,
    );
  }
  return (cachedKey = key);
}

function sign(cfg: Config, payload: string): string {
  return createHmac("sha256", signingKey(cfg)).update(payload).digest("hex");
}

export function makeSessionCookie(cfg: Config, now: number, role: Role): string {
  const exp = now + TTL_MS;
  const payload = `${exp}.${role}`;
  const value = `${payload}.${sign(cfg, payload)}`;
  const maxAge = Math.floor(TTL_MS / 1000);
  // Secure + HttpOnly + SameSite=Strict: not readable by JS, HTTPS-only (Funnel is
  // always TLS), not sent cross-site.
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Role + remaining lifetime of a valid, unexpired session cookie, or null. */
export function sessionInfo(
  req: Request,
  cfg: Config,
  now: number,
): { role: Role; exp: number } | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const part = header.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!part) return null;

  // `<exp>.<role>.<hexsig>` — exp is digits, role has no dot, sig is hex: exactly 3 parts.
  const value = part.slice(COOKIE.length + 1);
  const seg = value.split(".");
  if (seg.length !== 3) return null;
  const [expS, role, sig] = seg;

  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < now) return null;
  if (role !== "full" && role !== "live") return null;

  const got = Buffer.from(sig);
  const want = Buffer.from(sign(cfg, `${expS}.${role}`));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { role, exp };
}

/** The signed role from a valid, unexpired session cookie, or null. */
export function sessionRole(req: Request, cfg: Config, now: number): Role | null {
  return sessionInfo(req, cfg, now)?.role ?? null;
}

export function hasValidSession(req: Request, cfg: Config, now: number): boolean {
  return sessionInfo(req, cfg, now) != null;
}

// Slide the cookie forward once it's past its half-life, so an actively-used session
// never hits the TTL wall. index.ts calls this on /v1/whoami (fired on every app open).
export const SESSION_TTL_MS = TTL_MS;
export function shouldRefresh(exp: number, now: number): boolean {
  return exp - now < TTL_MS / 2;
}
