import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.ts";

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * HTTP Basic auth for the dashboard + read/CSV endpoints (the ingest endpoint is
 * CIDR-only and does NOT go through this). Supports either user+password or a
 * shared token (accepted as the Basic password with any username, or as a
 * `Bearer` token). Constant-time comparison.
 */
// Two access levels: `full` (the whole dashboard) and `live` (the operator-status
// board ONLY — see config.liveUser). Route gating in index.ts restricts `live`.
export type Role = "full" | "live";

/** Constant-time check of a user+password (or shared token) against the FULL-access
 *  config. Reused by both Basic auth and the login form. */
export function credsMatch(cfg: Config, user: string, pass: string): boolean {
  if (cfg.dashboardUser && cfg.dashboardPassword) {
    return eq(user, cfg.dashboardUser) && eq(pass, cfg.dashboardPassword);
  }
  if (cfg.dashboardToken) return eq(pass, cfg.dashboardToken);
  return false;
}

/** Constant-time check against the scoped operator-status-only credential. */
export function liveCredsMatch(cfg: Config, user: string, pass: string): boolean {
  if (!cfg.liveUser || !cfg.livePassword) return false;
  return eq(user, cfg.liveUser) && eq(pass, cfg.livePassword);
}

/** Resolve a user+password to its role, full taking precedence. null = no match. */
export function matchRole(cfg: Config, user: string, pass: string): Role | null {
  if (credsMatch(cfg, user, pass)) return "full";
  if (liveCredsMatch(cfg, user, pass)) return "live";
  return null;
}

/** Role carried by a request's Authorization header (Basic user:pass, or Bearer
 *  token → full). null when absent/invalid. */
export function authRole(req: Request, cfg: Config): Role | null {
  const h = req.headers.get("authorization") || "";

  if (h.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    } catch {
      return null;
    }
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return matchRole(cfg, decoded.slice(0, i), decoded.slice(i + 1));
  }

  if (h.startsWith("Bearer ") && cfg.dashboardToken) {
    return eq(h.slice(7).trim(), cfg.dashboardToken) ? "full" : null;
  }

  return null;
}

export function checkAuth(req: Request, cfg: Config): boolean {
  return authRole(req, cfg) != null;
}

export function unauthorized(): Response {
  // Deliberately NO WWW-Authenticate: the SPA handles 401 by routing to its own
  // /login page, so we must not trigger the browser's native Basic-auth popup.
  // `curl -u` still works — the server accepts Basic creds regardless of this hint.
  return new Response("authentication required", { status: 401 });
}
