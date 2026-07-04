import { dirname, join } from "node:path";

export const VERSION = "0.1.0";

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  /** CIDR allowlist (IPv4/IPv6). Client IP is derived from the leftmost
   *  X-Forwarded-For (see cidr.ts) — valid only because Tailscale Funnel
   *  REPLACES XFF and the port is bound to loopback. */
  allowedCidrs: string[];
  /** When true, CIDR is enforced on every non-health route and an empty/invalid
   *  allowlist FAILS CLOSED (denies all). Set false only for local dev. */
  cidrEnforce: boolean;
  dashboardUser: string;
  dashboardPassword: string;
  dashboardToken: string;
  /** Scoped "operator status only" credential. When set, these creds authenticate a
   *  `live` role that may read ONLY the live presence board (/v1/presence) — every
   *  metrics/CSV/erasure route returns 403 for it. Full dashboard access still uses
   *  dashboardUser/Password/Token. */
  liveUser: string;
  livePassword: string;
  /** Signing key for session cookies. Decoupled from the dashboard credentials so a
   *  redeploy or a password change does NOT log everyone out. If empty, the server
   *  persists a random key at `sessionKeyPath` (in the kept data/ dir) and reuses it
   *  across restarts/updates. */
  sessionSecret: string;
  sessionKeyPath: string;
  dashboardDir: string;
  maxBodyBytes: number;
  firstNameMaxLen: number;
  availableState: string;
}

function str(v: string | undefined, d: string): string {
  return v != null && v !== "" ? v : d;
}
function int(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(v: string | undefined, d: boolean): boolean {
  if (v == null || v === "") return d;
  return /^(1|true|yes|on)$/i.test(v);
}
function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  return {
    host: str(env.HOST, "127.0.0.1"),
    port: int(env.PORT, 3000),
    dbPath: str(env.DB_PATH, "./data/metrics.db"),
    allowedCidrs: list(env.ALLOWED_CIDRS),
    cidrEnforce: bool(env.CIDR_ENFORCE, true),
    dashboardUser: str(env.DASHBOARD_USER, ""),
    dashboardPassword: str(env.DASHBOARD_PASSWORD, ""),
    dashboardToken: str(env.DASHBOARD_TOKEN, ""),
    liveUser: str(env.LIVE_USER, ""),
    livePassword: str(env.LIVE_PASSWORD, ""),
    sessionSecret: str(env.SESSION_SECRET, ""),
    // Defaults alongside the SQLite db (the persisted data/ dir), so it survives updates.
    sessionKeyPath: str(
      env.SESSION_KEY_PATH,
      join(dirname(str(env.DB_PATH, "./data/metrics.db")), "session.key"),
    ),
    dashboardDir: str(env.DASHBOARD_DIR, "./dashboard/build"),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 512 * 1024),
    firstNameMaxLen: int(env.FIRST_NAME_MAX_LEN, 40),
    availableState: str(env.AVAILABLE_STATE, "available").toLowerCase(),
  };
}

export function dashboardAuthEnabled(cfg: Config): boolean {
  return Boolean(
    (cfg.dashboardUser && cfg.dashboardPassword) || cfg.dashboardToken,
  );
}
