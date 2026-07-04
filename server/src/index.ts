import { realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { authRole, matchRole, unauthorized } from "./auth.ts";
import { getClientIp, makeCidrGate } from "./cidr.ts";
import { clearSessionCookie, makeSessionCookie, sessionInfo, shouldRefresh } from "./session.ts";
import { dashboardAuthEnabled, loadConfig, VERSION } from "./config.ts";
import { dailyCsv, summaryCsv } from "./csv.ts";
import { openDb } from "./db.ts";
import { ingest, normalizeFirstName, validateEnvelope, validFirstName } from "./ingest.ts";
import {
  daily,
  dailyFlat,
  deleteOperator,
  intradayByOperator,
  listOperators,
  missedCallTimes,
  SLOT_MINUTES,
  summary,
} from "./metrics.ts";
import {
  listPresence,
  onlineSummary,
  PRESENCE_STATUSES,
  presenceTimeline,
  recordPresence,
} from "./presence.ts";

const cfg = loadConfig();
const gate = makeCidrGate(cfg.allowedCidrs, cfg.cidrEnforce);
const db = openDb(cfg.dbPath);
const startedAt = Date.now();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function log(event: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function parseRange(
  url: URL,
): { ok: true; from: string; to: string } | { ok: false } {
  const today = new Date();
  const from = url.searchParams.get("from") || ymd(new Date(today.getTime() - 29 * 86400000));
  const to = url.searchParams.get("to") || ymd(today);
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return { ok: false };
  return { ok: true, from, to };
}

/** Intraday bucket size: `?slot=15|30|60`, snapped to the allowed set (the value is
 *  interpolated into SQL, so anything else falls back to the route default). */
function parseSlot(url: URL, dflt: number): number {
  const n = Number(url.searchParams.get("slot"));
  return SLOT_MINUTES.has(n) ? n : dflt;
}

async function handleIngest(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const v = validateEnvelope(body, cfg);
  if (!v.ok) return json({ error: v.error }, 400);
  try {
    const res = ingest(db, v.value, Date.now());
    return json({ ok: true, ...res });
  } catch (e) {
    log("ingest_error", { error: String(e) });
    return json({ error: "internal error" }, 500);
  }
}

async function handleDelete(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (typeof body?.operator !== "string") {
    return json({ error: "operator (first name) required" }, 400);
  }
  // Identity is the first name, so erasure targets the person across every station.
  const res = deleteOperator(db, normalizeFirstName(body.operator));
  return json({ ok: true, ...res });
}

async function handlePresence(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (typeof body?.install !== "string" || typeof body?.operator !== "string") {
    return json({ error: "install and operator required" }, 400);
  }
  if (typeof body?.status !== "string" || !PRESENCE_STATUSES.has(body.status)) {
    return json({ error: "invalid status" }, 400);
  }
  const name = normalizeFirstName(body.operator);
  if (!validFirstName(name, cfg.firstNameMaxLen)) {
    return json({ error: "invalid operator (first name)" }, 400);
  }

  recordPresence(db, body.install, name, body.status, Date.now());
  return json({ ok: true });
}

async function handleLogin(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (typeof body?.user !== "string" || typeof body?.pass !== "string") {
    return json({ error: "user and pass required" }, 400);
  }
  const role = matchRole(cfg, body.user, body.pass);
  if (!role) {
    return json({ error: "invalid credentials" }, 401);
  }
  // The client uses `role` to route (live → operator-status board only) and hide nav.
  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": makeSessionCookie(cfg, Date.now(), role),
    },
  });
}

function handleLogout(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": clearSessionCookie(),
    },
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const base = resolve(cfg.dashboardDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return text("bad request", 400);
  }
  if (rel.includes("\0")) return text("bad request", 400);
  if (rel === "/") rel = "/index.html";
  const target = resolve(join(base, rel));
  if (target !== base && !target.startsWith(base + sep)) {
    return text("forbidden", 403);
  }
  const file = Bun.file(target);
  if (await file.exists()) {
    // Re-verify containment through the filesystem so a symlink can't escape base.
    try {
      const real = realpathSync(target);
      if (real !== base && !real.startsWith(base + sep)) return text("forbidden", 403);
    } catch {
      /* vanished between exists() and realpath — fall through to SPA/404 */
    }
    // Content-hashed build assets are immutable; everything else (manifest, icons,
    // service worker, index) must revalidate so a redeploy propagates to installed PWAs.
    const headers: Record<string, string> = {
      "cache-control": rel.startsWith("/_app/immutable/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
    // Bun infers most content-types from the extension, but not .webmanifest.
    if (target.endsWith(".webmanifest")) {
      headers["content-type"] = "application/manifest+json; charset=utf-8";
    }
    return new Response(file, { headers });
  }
  // SPA fallback — the app shell must always revalidate.
  const index = Bun.file(join(base, "index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    });
  }
  return text("dashboard not built (run: bun run build:dashboard)", 404);
}

const server = Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  maxRequestBodySize: cfg.maxBodyBytes,
  development: false,
  error(err) {
    log("handler_error", { error: String(err) });
    return text("internal error", 500);
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health probes: no CIDR / no auth (reached locally, no XFF).
    if (path === "/healthz") return text("ok");
    if (path === "/readyz") {
      try {
        db.query("SELECT 1").get();
        return text("ready");
      } catch {
        return text("not ready", 503);
      }
    }

    // CIDR gate on everything else.
    const ip = getClientIp(req, server.requestIP(req)?.address ?? "");
    if (!gate.allowed(ip)) {
      log("route_denied", { reason: "cidr", ip, path });
      return text("forbidden", 403);
    }

    // CIDR-only, no dashboard auth: ingest, presence heartbeats, and login/logout.
    if (path === "/v1/events" && req.method === "POST") return handleIngest(req);
    if (path === "/v1/presence" && req.method === "POST") return handlePresence(req);
    if (path === "/v1/login" && req.method === "POST") return handleLogin(req);
    if (path === "/v1/logout" && req.method === "POST") return handleLogout();

    // The static SPA (shell, assets, client routes incl. /login) loads WITHOUT
    // dashboard auth so the login page is reachable — it carries no data. Only the
    // /v1/* data endpoints below are gated.
    if (req.method === "GET" && !path.startsWith("/v1/")) return serveStatic(path);

    // Data endpoints require a valid session cookie (login form) OR Basic/Bearer
    // (curl / API). Fail CLOSED — role is null when no creds are set/matched.
    const now = Date.now();
    const headerRole = authRole(req, cfg); // Basic / Bearer
    const sess = headerRole ? null : sessionInfo(req, cfg, now); // login-form cookie
    const role = headerRole ?? sess?.role ?? null;
    if (!role) return unauthorized();

    // The client reads its role to route + hide nav. Both roles may ask. The layout
    // calls this on every app open, so it's also where we SLIDE the cookie forward
    // (past its half-life) — that's what keeps an active user logged in across updates.
    if (req.method === "GET" && path === "/v1/whoami") {
      const headers: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
      };
      if (sess && shouldRefresh(sess.exp, now)) {
        headers["set-cookie"] = makeSessionCookie(cfg, now, role);
      }
      return new Response(JSON.stringify({ role }), { status: 200, headers });
    }

    // The scoped `live` credential may read ONLY the live presence board. Every other
    // data route (metrics, CSV, erasure) is full-access — 403 for live (authenticated
    // but not authorised).
    if (role === "live" && !(req.method === "GET" && path === "/v1/presence")) {
      return text("forbidden", 403);
    }

    // Erasure is admin-only (offboarding / cleanup). Metrics are mandatory, so an
    // operator must NOT be able to wipe their own record — hence below the gate.
    if (path === "/v1/metrics" && req.method === "DELETE") return handleDelete(req);

    if (req.method === "GET") {
      if (path === "/v1/operators") return json(listOperators(db));
      if (path === "/v1/presence") return json(listPresence(db, Date.now()));
      // Status timeline: exact-timestamp spans for one local day, decorated with the
      // missed-call ring timestamps. Full role only (unlike the live board) — a day
      // of history reveals schedules.
      if (path === "/v1/presence/timeline") {
        const day = url.searchParams.get("day") ?? ymd(new Date());
        if (!DAY_RE.test(day)) return json({ error: "invalid day" }, 400);
        const tl = presenceTimeline(db, day);
        const missed = missedCallTimes(db, day);
        const operators = tl.operators.map((o) => ({
          ...o,
          missed_ms: missed.get(o.first_name) ?? [],
        }));
        // An operator with missed rings but no presence spans that day still gets a
        // lane — the misses matter more than the empty track.
        for (const [name, times] of missed) {
          if (!tl.operators.some((o) => o.first_name === name)) {
            operators.push({ first_name: name, online_seconds: 0, spans: [], missed_ms: times });
          }
        }
        return json({ ...tl, operators });
      }
      // Online-time rollup (any-status heartbeat) — the "online" side of the
      // active-vs-online comparison. Full role only, like /history.
      if (path === "/v1/presence/online") {
        const r = parseRange(url);
        if (!r.ok) return json({ error: "invalid from/to" }, 400);
        const operatorRaw = url.searchParams.get("operator");
        const operator = operatorRaw ? normalizeFirstName(operatorRaw) : undefined;
        return json(onlineSummary(db, r.from, r.to, operator));
      }

      if (path === "/v1/metrics/summary") {
        const r = parseRange(url);
        if (!r.ok) return json({ error: "invalid from/to" }, 400);
        return json(summary(db, r.from, r.to));
      }
      if (path === "/v1/metrics") {
        const r = parseRange(url);
        if (!r.ok) return json({ error: "invalid from/to" }, 400);
        const operatorRaw = url.searchParams.get("operator");
        const operator = operatorRaw ? normalizeFirstName(operatorRaw) : undefined;
        return json(daily(db, r.from, r.to, operator, parseSlot(url, 60)));
      }
      // Per-operator slot-of-day series (the operator heatmap). Single day by default;
      // from/to sums the slots across a multi-day range. `?day=` kept for old clients.
      if (path === "/v1/metrics/intraday") {
        const day = url.searchParams.get("day");
        if (day && !DAY_RE.test(day)) return json({ error: "invalid day" }, 400);
        const from = url.searchParams.get("from") ?? day ?? ymd(new Date());
        const to = url.searchParams.get("to") ?? day ?? from;
        if (!DAY_RE.test(from) || !DAY_RE.test(to)) return json({ error: "invalid from/to" }, 400);
        return json(intradayByOperator(db, from, to, parseSlot(url, 30)));
      }
      if (path === "/v1/export/summary.csv") {
        const r = parseRange(url);
        if (!r.ok) return text("invalid from/to", 400);
        const s = summary(db, r.from, r.to);
        return csvResponse(`metrics-summary_${r.from}_${r.to}.csv`, summaryCsv(s.operators));
      }
      if (path === "/v1/export/daily.csv") {
        const r = parseRange(url);
        if (!r.ok) return text("invalid from/to", 400);
        const operatorRaw = url.searchParams.get("operator");
        const operator = operatorRaw ? normalizeFirstName(operatorRaw) : undefined;
        return csvResponse(
          `metrics-daily_${r.from}_${r.to}.csv`,
          dailyCsv(dailyFlat(db, r.from, r.to, operator)),
        );
      }
    }

    return text("not found", 404);
  },
});

log("server_started", {
  version: VERSION,
  host: cfg.host,
  port: cfg.port,
  cidrEnforce: cfg.cidrEnforce,
  allowedCidrs: cfg.allowedCidrs.length,
  cidrValid: gate.count,
  dashboardAuth: dashboardAuthEnabled(cfg),
  db: cfg.dbPath,
});

if (!dashboardAuthEnabled(cfg)) {
  log("warning", {
    message:
      "dashboard credentials not set — read/CSV/dashboard routes are LOCKED (401). Set DASHBOARD_USER/PASSWORD or DASHBOARD_TOKEN to enable them.",
  });
}

function shutdown(signal: string): void {
  log("server_stopping", { signal, uptime_ms: Date.now() - startedAt });
  try {
    server.stop(true);
  } catch {
    /* ignore */
  }
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
