# Dashboard Integration Runbook

> **STATUS: BUILT.** The dashboard is implemented as a Svelte 5 + adapter-static SPA
> under `server/dashboard/` (`src/lib` + `src/routes`). Rebuild with `cd server &&
> bun run build:dashboard` → `dashboard/build`, served by the Bun server at `/`
> (`DASHBOARD_DIR`, behind Basic auth). Type-check: `cd server/dashboard && bun run
> check`. This doc is retained as the API-contract reference. **Updates since first
> draft:** the server now returns `answer_rate: null` when `received === 0` (the SPA
> renders it as `—`), and the live board adds `GET /v1/presence` → the `/live` route
> (statuses available / on_call / away / offline).

**Audience:** whoever maintains or re-integrates the SvelteKit dashboard.
This is **not** the design brief. The design brief (`DASHBOARD-DESIGN-BRIEF.md`)
tells the designer *what to build*; this tells you *how the finished artifact bolts
onto the server* and the exact API contract.

The API contract below is transcribed from the **actual implementation**
(`server/src/index.ts`, `metrics.ts`, `csv.ts`, `auth.ts`, `types.ts`), not from
memory. If the server changes, re-verify against those files.

---

## 1. Where it goes / how it's served

- Drop the SvelteKit **source** into `server/dashboard/`.
- `bun run build:dashboard` (already in `server/package.json`) runs
  `cd dashboard && bun install && bun run build`.
- The build output must land at `server/dashboard/build` — the server reads
  `DASHBOARD_DIR` (default `./dashboard/build`, see `.env.example`).
- The Bun server serves it at `/` via `serveStatic()` (`src/index.ts:91`), behind
  Basic auth, with an **SPA fallback to `index.html`** and a symlink-escape guard.

## 2. Hard requirements on the delivered app

1. **Adapter must be `@sveltejs/adapter-static` with `fallback: 'index.html'`.**
   Any unknown GET path falls through to `serveStatic`, which serves
   `index.html` — so client-side routing only works if the app is a proper SPA
   fallback build. A prerender-only build with no fallback will 404 on deep links.
2. **Call the API with same-origin *relative* paths** (`/v1/metrics/summary?...`),
   never a hardcoded host. The dashboard is served from the same origin as the
   API, so relative fetches inherit the browser's Basic-auth credentials
   automatically. A hardcoded `https://dynops...` host would break auth + invite
   CORS. No `credentials: 'include'` gymnastics needed for same-origin Basic auth.
3. **Do not implement a login form.** Auth is HTTP Basic (`auth.ts`): the first
   navigation triggers the browser's native auth dialog (`WWW-Authenticate: Basic
   realm="Metrics"`); every subsequent fetch reuses it. (A shared `DASHBOARD_TOKEN`
   is also accepted as the Basic password with any username, or as `Bearer` — but
   the default deploy uses `DASHBOARD_USER`/`DASHBOARD_PASSWORD`.)
4. **Avoid route paths that collide** with server-handled routes: `/healthz`,
   `/readyz`, and anything under `/v1/*` are intercepted before `serveStatic`.

## 3. API contract (exact)

All read endpoints require Basic auth and return `application/json` unless noted.
Date params are `YYYY-MM-DD` in the **operator's local day**. Range defaults to
the **last 30 days** (`from = today-29`, `to = today`) when omitted; a malformed
`from`/`to` returns `400 {error:"invalid from/to"}`.

### `GET /v1/operators`
```jsonc
{ "operators": [ { "install_uuid": "…", "first_name": "Sam", "last_seen": "2026-07-01" } ] }
```

### `GET /v1/metrics/summary?from=&to=`
```jsonc
{
  "range": { "from": "…", "to": "…" },
  "operators": [ OperatorSummary, … ],
  "team": {
    "operator_count": 3,
    "available_seconds": 12345,
    "calls_received": 40,
    "calls_answered": 37,
    "answer_rate": 0.925,               // 0..1 FRACTION, not a percentage
    "avg_time_to_answer_ms": 4200,      // number | null (null = no samples)
    "avg_handle_ms": null,              // number | null
    "handle_sample": 0                  // # calls avg_handle_ms was computed over
  }
}
```
`OperatorSummary` = `{ install_uuid, first_name, available_seconds, calls_received,
calls_answered, answer_rate (0..1), avg_time_to_answer_ms (num|null),
avg_handle_ms (num|null), handle_sample }`.

### `GET /v1/metrics?from=&to=[&install_uuid=]`
Without `install_uuid` (team view):
```jsonc
{
  "range": {…},
  "days": [ DailyPoint, … ],                     // team totals per day
  "byOperator": [ { "install_uuid", "first_name", "days": [ DailyPoint, … ] } ]
}
```
With `install_uuid` (single operator):
```jsonc
{ "range": {…}, "install_uuid": "…", "days": [ DailyPoint, … ] }
```
`DailyPoint` = `{ day, available_seconds, calls_received, calls_answered,
avg_time_to_answer_ms (num|null), avg_handle_ms (num|null), handle_sample }`.

### `GET /v1/export/summary.csv?from=&to=`
### `GET /v1/export/daily.csv?from=&to=[&install_uuid=]`
Return `text/csv` with `content-disposition: attachment`. A plain `<a href>` (or
`window.location`) download works — the browser reuses the Basic-auth session.
`summary.csv` columns: `install_uuid, first_name, available_seconds,
calls_received, calls_answered, not_answered, answer_rate, avg_time_to_answer_ms,
avg_handle_ms, handle_sample`. `daily.csv` inserts `day` after `first_name` and
drops `answer_rate`. `not_answered = max(0, received - answered)`.

## 4. Semantics the UI MUST get right

- **`answer_rate` is 0..1** — multiply by 100 for a percentage.
- **`avg_time_to_answer_ms` / `avg_handle_ms` can be `null`** (no samples in
  range) — render `—`, never `0 ms` or `NaN`.
- **`available_seconds` is seconds** — format to h/m.
- **Handle time is Phase B and OFF until a live call confirms it.** Until then
  `avg_handle_ms` is `null` and `handle_sample` is `0` for everyone. The UI must
  **degrade gracefully**: hide the handle-time column/chart or show "pending"
  when `handle_sample === 0`, rather than a wall of `—`. Don't hard-depend on it.

## 5. Verify before declaring done

1. `cd server && bun run build:dashboard` — clean build into `dashboard/build`.
2. Set `DASHBOARD_USER`/`DASHBOARD_PASSWORD` + seed data (`bun run scripts/seed.ts`
   if present), start the server, open `/` — native auth dialog appears, app loads.
3. Click through every view; confirm charts/tables render with `null` avg fields
   showing `—` and Phase-B handle fields degrading cleanly.
4. Deep-link a sub-route and hard-refresh — SPA fallback must serve it (proves the
   adapter config is right).
5. Trigger both CSV downloads — files download with the right filename + rows.
6. Confirm no requests go to any origin other than same-origin (network tab).

## 6. Common failure modes

- **Blank page on deep-link refresh** → adapter isn't `adapter-static` with
  `fallback: 'index.html'`.
- **401 loop / repeated auth prompts** → the app is calling an absolute host, or
  `DASHBOARD_USER/PASSWORD` unset (server locks reads to 401 by design when creds
  are unset — see `src/index.ts:216`).
- **`0 ms` / `NaN` in avg cells** → not handling `null` averages.
- **CSV opens as JSON / wrong name** → hitting the JSON endpoint instead of
  `/v1/export/*.csv`.
