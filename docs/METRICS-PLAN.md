# Operator Metrics — Implementation Plan

Status: **IMPLEMENTED (Phase A).** This was the original plan; the delivered design
diverged in a few deliberate ways — see the banner below. Deploy remains gated on
gvian's approval (see `RUNBOOK.md`).

> **Divergences from this plan (authoritative = the code + `RUNBOOK.md`):**
> - **Mandatory, not opt-in.** Metrics are always on (internal, unlisted, per
>   employer policy); the popup shows a read-only notice, not a toggle.
> - **Identity = random install UUID** in `chrome.storage.sync` (a hashed-UPN
>   scheme was considered and dropped — a hash of a last-name-based email is
>   reversible from a roster, and a random UUID carries no PII).
> - **Live presence board** added (`/v1/presence` → `/live`): available / on_call /
>   away / offline. `on_call` + handle time are Phase B (gated `CALL_TRACKING_ENABLED`).
> - **No rate limiter** — only trusted CIDR traffic reaches `/v1/*`.
> - **Erasure is admin-only** (Basic auth), not operator self-service.
> - **Dashboard is BUILT** (SvelteKit SPA under `server/dashboard/`, served at `/`).

This plan folds in a multi-agent strategy workflow (6 design dimensions + 2
adversarial verifications), the interview answers, and the Hub's proven
CIDR-over-Funnel implementation guide.

---

## 1. Scope

Add an **opt-in, OFF-by-default** "Team Metrics" pipeline to the extension that
ships aggregate call-handling metrics to a self-hosted Bun server, plus a
SvelteKit dashboard to view them. Five metrics per operator per local day:
available time, calls received, calls answered, avg time-to-answer, avg handle
time. The **only** personal datum transmitted is the operator's **first name**
(plus an anonymous install UUID).

## 2. Two verified findings

**A. CIDR filtering over Tailscale Funnel is viable** (confirmed by your own
working Hub deployment; an earlier verifier relied on a stale 2024 source and was
wrong). Funnel terminates TLS locally and forwards to the backend injecting
**`X-Forwarded-For`**, **replacing** any client-sent XFF with the IP it observed.
Enforcement: read the **leftmost** XFF entry as the client IP, match against the
CIDR allowlist, **fail closed** on empty/malformed. Safe **only** with two
load-bearing preconditions: (1) the funnel/proxy replaces XFF (does not append),
and (2) Bun is bound to `127.0.0.1` / the port is firewalled to the proxy so
nothing can connect directly and forge XFF. Validated by an **XFF spoof-test** (a
spoofed `X-Forwarded-For` sent *through* the funnel must still be denied). So the
CIDR-only choice stands and is justified.

**B. Exact talk-time is not observable** from a content script (no CIF event, CIF
is unreachable from the isolated world, most calls end by the customer hanging up
with no agent click). Metric #5 ships as **handle time = Accept → the call's
session tab detaching** from the Omnichannel session panel — exactly your stated
definition, and explicitly *not* the presence/"ready" event. It includes
wrap-up, is labelled as such, degrades to null when the end signal is missed, and
is capped defensively.

## 3. Decisions

1. **Auth boundary — RESOLVED.** CIDR-only over plain HTTPS funnel (your original
   choice), enforced from the **leftmost** `X-Forwarded-For` via `node:net`
   `BlockList`, **fail-closed**, with Bun bound to `127.0.0.1`. Acceptance
   criterion: pass the XFF spoof-test before relying on it. A bearer token is
   available as optional defense-in-depth but is **not required**. The dashboard
   keeps HTTP Basic auth on top of CIDR.
2. **Consent / compliance gate.** Collecting metrics on employees is workplace
   monitoring. Before enabling: update `PRIVACY-POLICY.md` + the CWS data
   declaration (drafted — see `docs/CHROME-WEBSTORE-DATA-DISCLOSURE.md`), keep it
   opt-in/default-off, get whatever internal/legal sign-off your jurisdiction
   needs. A release gate, not an engineering step.
3. **First-name source.** You chose **auto-detect from Dynamics**: read the
   logged-in user's display name, keep **only the first token**, sanitise
   (letters/`.'- ` only, ≤40 chars), with a manual override field in the popup as
   fallback. (Requires a Phase-0 selector capture — see §8.)

## 4. Architecture

Three tiers, with the metrics path fully decoupled from the existing alert code.

### 4.1 Extension (sensors + accountant + delivery)
- **content.js — presence sensor:** a dedicated attribute-only `MutationObserver`
  on the existing presence button's `aria-label` (+ a 30s freshness re-report),
  emitting `METRIC_PRESENCE{available}` where available = `aria-label` lowercases
  to `"available"`. Separate from the body-wide alert observer.
- **content.js — call-lifecycle tracker:** a self-contained state machine
  (its own `ringId/tRing/tAnswer`), decoupled from `alertsActive/stopAllAlerts`.
  On a new ring → `METRIC_CALL_RECEIVED`. Capture-phase listeners on
  `#acceptButton` → `METRIC_CALL_ANSWERED{ttaMs}` and start handle tracking;
  `#declineButton` → end tracking (declined = received-not-answered). Handle end:
  snapshot the newly-selected session-tab node and observe the session-tab list
  container; when that node detaches → `METRIC_CALL_ENDED{handleMs}`. Null-honest
  if no end signal; 4h safety cap. **No CIF APIs.**
- **background.js (accountant + delivery, the singleton so N tabs can't
  double-count):** owns a single global "effective-available" clock in
  `chrome.storage.local` (available only when `hasDynamicsTab AND !locked AND
  !idle AND presence==available`), mints one raw event per key `q/<uuid>`, and
  flushes batches on a 1-min `chrome.alarms` heartbeat with idempotent retry +
  exponential backoff. New `METRIC_*` message types (never reuse the alert
  `CALL_ENDED`). All gated on `metricsEnabled` + a valid first name.
- **new `metrics.js`:** the accountant, allowlist **builder** (assembles each
  payload key-by-key from a constant — never spreads a DOM/message object),
  first-name sanitiser, and flush/backoff logic.
- **popup:** a "Team Metrics (optional)" section — enable toggle (default OFF),
  first-name field (auto-filled, editable), server URL, install-ID toggle,
  "Test metric", and "Delete my metrics from server". Opt-in toggle triggers
  `chrome.permissions.request` for the server origin (revert if denied).
- **manifest:** add `"alarms"`; add `optional_host_permissions` for the funnel
  origin (requested at runtime); make the service worker a module if `metrics.js`
  is an ES module.

### 4.2 Server (Bun + bun:sqlite, zero deps)
- `Bun.serve` bound to `127.0.0.1`, `bun:sqlite` (WAL, `synchronous=NORMAL`,
  `busy_timeout`), graceful shutdown, JSON logs (never logs bodies or IPs).
- **CIDR gate (all routes):** derive client IP from the **leftmost**
  `X-Forwarded-For`, match with `node:net` `BlockList` (normalize IPv4-mapped
  IPv6 first), **fail-closed** on empty/malformed allowlist, audit denials.
- **Ingest `POST /v1/events`** — CIDR gate + rate limit + **strict closed-key
  validation** (400 on any unknown field — enforces minimisation server-side),
  all folded in one transaction: upsert operator, `INSERT OR IGNORE` each event
  by `event_id` (idempotent dedup), and on real inserts apply the additive
  rollup delta. Returns `{accepted, duplicates}`.
- **Read `GET /v1/metrics`, `/v1/metrics/summary`, `/v1/operators`** — CIDR +
  Basic auth; return per-operator-per-day + range summaries.
- **CSV `GET /v1/export/summary.csv`, `/v1/export/daily.csv`.**
- **`DELETE /v1/metrics`** — erasure for one operator. **`/healthz` `/readyz`.**
- Deploy under **systemd** (preferred; hardened) or **pm2** (fork mode,
  `instances: 1` — SQLite is single-writer). `sqlite3 .backup` for backups.
- **Funnel:** plain HTTPS `tailscale funnel` (ports 443/8443/10000); confirm it
  replaces XFF; keep Bun on loopback so tailscaled is the only path in.

### 4.3 Dashboard (SvelteKit SPA — built by a separate design agent)
- Per `docs/DASHBOARD-DESIGN-BRIEF.md`: SvelteKit + adapter-static SPA, charts
  bundled (no CDN), served by the Bun server at `/`. Charts, sortable comparison
  tables, per-operator drill-down, CSV export. Behind CIDR + Basic auth.
  **I am not coding this — the brief is the handoff.**

## 5. Data model

**Client** (`chrome.storage`): `sync` = settings
(`metricsEnabled:false, metricsFirstName, metricsServerUrl,
metricsShareInstallId:true, metricsInstallId:<uuid>`); `local` = install id, the
global presence clock `{effectiveAvailable, sinceTs}`, flush metadata, and one
queued event per key `q/<uuid>` (FIFO cap 2000, 7-day sweep).

**Raw event** (immutable, one scalar each, all non-PII):
`{event_id, type, day('YYYY-MM-DD' operator-LOCAL), …}` where type ∈
`available_tick`(→`available_seconds`) | `call_received` | `call_answered`
(→`time_to_answer_ms`) | `call_ended`(→`handle_ms`). Availability uses a
crash-safe heartbeat-delta model that only ever credits `available` seconds
(gaps >~150s dropped, so sleep/eviction never inflates the number).

**Server:** `raw_events` (immutable, keyed by `event_id`) + `daily_aggregates`
(sum+count so averages stay exact, rebuildable from raw_events). `operators`
table's only PII column is `first_name`.

### Outbound field whitelist (the complete set that may leave the device)
`v` (schema), `install` (anon UUID), `operator` (**first name — the only PII**),
`agent` (ext version), `batchId`, `sentAt`; per event: `event_id`, `type`,
`day`, and one of `available_seconds` | `time_to_answer_ms` | `handle_ms`.
**Forbidden & rejected:** caller name/number, ring text, presence label text,
full name/email/agent id/call GUID, tab URL/title, timezone, IP, geo, UA, and
any presence bucket other than available.

## 6. Security & privacy summary
- **CIDR (leftmost XFF) is the auth boundary** — safe iff funnel replaces XFF
  **and** Bun binds `127.0.0.1` (validated by the spoof-test); fail-closed on
  empty/malformed allowlist. Optional bearer token as defense-in-depth.
- Server never stores request IPs next to metrics (keeps install-UUID non-PII).
- Opt-in/default-off; on-device allowlist builder + server-side 400-on-unknown;
  privacy policy + CWS declaration updated **before** shipping.

## 7. Phased delivery
- **Phase 0 (blockers, ~1 day):** live-tenant DevTools capture — confirm presence
  `aria-label`=="available", capture the session-tab-list selector and the
  first-name source selector, check for a call-duration timer; finalise the
  funnel hostname; run the XFF spoof-test on the deployment; update policy + CWS
  docs.
- **Phase 1 (server):** build/verify the Bun + bun:sqlite app (ingest, read, CSV,
  erasure, health; leftmost-XFF `BlockList` CIDR gate fail-closed; rate limit;
  loopback; graceful shutdown); systemd + HTTPS funnel; curl end-to-end
  (idempotency, 400-on-unknown, CIDR allow/deny + spoof-test).
- **Phase 2 (extension, 4 high-confidence metrics):** manifest, `metrics.js`,
  background wiring, popup consent UI; ship availability + calls received +
  answered + time-to-answer.
- **Phase 3 (handle time):** the decoupled call-lifecycle tracker →
  `METRIC_CALL_ENDED{handleMs}`, null-honest + capped.
- **Phase 4 (dashboard + hardening):** integrate the design agent's dashboard
  against the live API; monitoring for CIDR-deny/selector-miss counters; nightly
  aggregate-rebuild consistency check.

## 8. Phase-0 unknowns to capture on a live tenant
Presence `aria-label` exact string; session-tab-list container selector (for
handle-time end); the logged-in operator's name element (for auto first-name);
whether a live talk-duration timer exists; the exact `<node>.<tailnet>.ts.net`
funnel hostname for the manifest; XFF spoof-test result.

## 9. Top risks
CIDR-over-funnel works only if funnel replaces XFF **and** the port is locked to
the proxy (must pass a spoof-test, else trivially spoofable); handle-time rides a
tenant-fragile selector (null-honest, log misses); presence depends on the
`aria-label` string (breaks on non-English tenant / UI refactor); a careless edit
could leak caller data into a metric (builder must never spread DOM objects); the
live CWS "collects no data" declaration becomes false the moment metrics ship
(must update first).
