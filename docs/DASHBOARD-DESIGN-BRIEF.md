# Metrics Dashboard — Design Brief

A brief for a Claude design agent. You are designing and building the **metrics
dashboard** — a small internal web app that visualises operator call-handling
metrics collected from a Chrome extension. This document is self-contained:
everything you need (purpose, tech constraints, the exact API contract, the
screens to build, and sample data) is below.

---

## 1. Purpose (what this is)

A team lead needs to see, at a glance, how each phone operator is handling calls
day to day, and to compare operators against each other and over time. The
dashboard visualises five metrics per operator per day:

1. **Available time** — seconds the operator was logged in and *eligible to take
   calls* (Dynamics presence = "Available", and not locked/idle/away).
2. **Calls received** — how many calls were presented to them.
3. **Calls answered** — how many they picked up.
4. **Average time-to-answer** — how long from the call ringing to pickup.
5. **Average talk time** — how long from pickup to hang-up. (Original brief
   measured pickup → session close, wrap-up included, and banned the "talk time"
   label; extension v1.9 moved the end signal to hang-up, so it now *is* talk
   time and is labelled as such. Wrap-up counts as available time.)

The dashboard is a **read-only reporting tool**. It does not write data.

> Frame all copy neutrally around operational call-handling performance. Do not
> editorialise about individuals.

## 2. Audience & usage

- **Users:** one or a few team leads / supervisors. Not the operators
  themselves. Desktop-first (viewed on a laptop); responsive down to tablet is a
  plus, phone is not required.
- **Volume:** small — expect ~5–50 operators, a few hundred call events per
  operator per day, queried over ranges of days to a few months.
- **Refresh:** load-on-open + a manual refresh button and a date-range change.
  No real-time streaming needed.

## 3. Tech stack & hard constraints

- **SvelteKit** (Svelte 5) built with **`@sveltejs/adapter-static`** as a
  **single-page app** (`ssr = false`, `prerender = false`, SPA fallback). No
  server-side rendering, no database access from the dashboard — it is a pure
  client that calls the JSON API described in §6.
- Lives at **`server/dashboard/`** in this repo. Its build output
  (`server/dashboard/build`) is served by the existing Bun server at the site
  root (`/`), **same-origin** as the API (so `fetch('/v1/...')` needs no CORS,
  no base URL).
- **Charts:** use a charting library of your choice (e.g. Chart.js, LayerChart,
  or hand-rolled SVG) **bundled locally** — the app runs behind a private
  Tailscale endpoint, so **no external CDNs / Google Fonts / remote assets**.
  Everything must load offline from the bundle.
- **TypeScript** throughout. Keep dependencies lean.
- **Brand:** primary colour **`#0062A5`** (matches the parent extension). Clean,
  dense, data-first UI — this is an internal analytics tool, not a marketing
  page. Light theme is required; dark theme optional.

## 4. Authentication (context — you do not build a login)

The Bun server puts **HTTP Basic auth** in front of the dashboard and all
`/v1/metrics*` + `/v1/export*` endpoints. The browser handles the Basic-auth
prompt natively before your SPA even loads, and includes the credentials on
every same-origin `fetch` automatically. So:

- **Do not build a login screen or auth flow.** Assume requests are already
  authenticated by the browser.
- **Do** handle a `401`/`403` from a `fetch` gracefully (e.g. a "session expired
  / access denied — reload" state), in case credentials become invalid.

## 5. Metric definitions & formatting rules

| Metric | Source field | Display |
|---|---|---|
| Available time | `available_seconds` | Format as `Hh Mm` (e.g. `6h 32m`). Charts may use hours (decimal). |
| Calls received | `calls_received` | integer |
| Calls answered | `calls_answered` | integer |
| Not answered | `calls_received - calls_answered` | integer (derive client-side) |
| Answer rate | `calls_answered / calls_received` | percentage, 1 decimal; show `—` if received = 0 |
| Avg time-to-answer | `avg_time_to_answer_ms` | seconds, 1 decimal (e.g. `4.3s`); `—` if null |
| Avg talk time | `avg_handle_ms` | `Mm Ss` (e.g. `4m 22s`); talk only since v1.9 (answer → hang-up); `—` if null |
| Handle sample | `handle_sample` | small muted "(n=170)" next to avg handle — how many calls the handle time was actually measured on (it can be lower than answered, since some end signals are missed) |

Rules:
- **Days are operator-local calendar days** (`YYYY-MM-DD` strings). Do not apply
  timezone math — treat the `day` string as the label as-is.
- Averages come pre-computed from the server (exact, computed from sum/count).
  Don't average the averages when rolling up a range — request the range you
  need and use the server's numbers.
- Operators are identified by **`first_name`** plus an **`install_uuid`** (an
  anonymous id). `first_name` is **not unique** — two operators can share a
  first name and are distinguished only by `install_uuid`. Always key rows /
  chart series on `install_uuid`, and label them with `first_name` (append a
  short `install_uuid` suffix when two share a name). **The only human-readable
  identifier that exists is the first name** — there is deliberately no other
  personal data to display.

## 6. API contract (what you fetch)

All same-origin, all GET, all return JSON unless noted. Query params `from` and
`to` are inclusive `YYYY-MM-DD`. (These are the finalised shapes; the server is
built to match.)

### `GET /v1/operators`
```json
{ "operators": [ { "install_uuid": "3f2…", "first_name": "gabriel", "last_seen": "2026-06-30" } ] }
```

### `GET /v1/metrics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
Per-operator totals over the whole range, plus a team roll-up.
```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-30" },
  "operators": [
    {
      "install_uuid": "3f2…",
      "first_name": "gabriel",
      "available_seconds": 512340,
      "calls_received": 210,
      "calls_answered": 188,
      "answer_rate": 0.895,
      "avg_time_to_answer_ms": 4300,
      "avg_handle_ms": 262000,
      "handle_sample": 170
    }
  ],
  "team": {
    "operator_count": 7,
    "available_seconds": 3120450,
    "calls_received": 1420,
    "calls_answered": 1247,
    "answer_rate": 0.878,
    "avg_time_to_answer_ms": 5100,
    "avg_handle_ms": 271000,
    "handle_sample": 1100
  }
}
```

### `GET /v1/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD[&install_uuid=…]`
Daily time series. Without `install_uuid`: team totals per day **and** a
per-operator daily breakdown. With `install_uuid`: just that operator's days.
```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-07" },
  "days": [
    { "day": "2026-06-01", "available_seconds": 447200, "calls_received": 205,
      "calls_answered": 180, "avg_time_to_answer_ms": 4800, "avg_handle_ms": 268000, "handle_sample": 150 }
  ],
  "byOperator": [
    {
      "install_uuid": "3f2…", "first_name": "gabriel",
      "days": [
        { "day": "2026-06-01", "available_seconds": 61200, "calls_received": 32,
          "calls_answered": 30, "avg_time_to_answer_ms": 3900, "avg_handle_ms": 255000, "handle_sample": 27 }
      ]
    }
  ]
}
```
(When `install_uuid` is supplied, `byOperator` is omitted and `days` is that
operator's series.)

### CSV exports (trigger a file download)
- `GET /v1/export/summary.csv?from&to` — one row per operator, the §6 summary columns.
- `GET /v1/export/daily.csv?from&to[&install_uuid]` — one row per operator per day.

Serve these as links/buttons; the server sets `Content-Disposition: attachment`.
You do not format the CSV — just link to the endpoint with the current filters.

### Health (no auth) — you can ignore
- `GET /healthz` → `ok`

## 7. Screens to build

### A. Overview (`/`)
- **Date-range control** (default: last 30 days) with quick presets: Today, Last
  7 days, Last 30 days, This month. Drives every query on the page.
- **Team KPI cards** (from `team`): total available hours, calls received, calls
  answered, answer rate, avg time-to-answer, avg handle time. Each card ideally
  shows a tiny sparkline of the daily series.
- **Trend charts** (from `days`): line/area charts over the range —
  (1) calls received vs answered, (2) answer rate %, (3) avg time-to-answer,
  (4) avg handle time, (5) available hours. Group sensibly; don't overwhelm.
- **Operator comparison table** (from `operators`): one row per operator, all
  metrics as columns, **sortable by every column**, with a search/filter box.
  This is the primary tool for comparing operators — make sorting and scanning
  fast and obvious. Support a bar-chart view of the same data (e.g. answer rate
  by operator, calls answered by operator) as an alternative to the table.
- **CSV export** button → `/v1/export/summary.csv` with current range.
- Clicking an operator row → the Operator detail screen.

### B. Operator detail (`/operators/[install_uuid]`)
- Operator name header + the same date-range control.
- KPI cards for this operator over the range.
- Daily charts (same metric set as overview, single-operator series).
- A daily table (one row per day) — sortable, with CSV export
  (`/v1/export/daily.csv?...&install_uuid=…`).
- A "back to overview" affordance.

## 8. UX requirements

- **States:** every data area needs explicit **loading**, **empty** ("no data
  for this range"), and **error** (incl. 401/403) states. Empty is common early
  on — design it deliberately.
- **Formatting helpers:** centralise duration formatting (seconds→`Hh Mm`,
  ms→`s` or `Mm Ss`) and percentage formatting; reuse everywhere.
- **Sorting/filtering** on tables is essential (see §7A). Persist the selected
  range in the URL query so views are shareable/refresh-safe.
- **No external network** beyond the same-origin API (see §3).
- Accessible: keyboard-navigable tables/controls, sufficient contrast, chart
  data also available in the table (don't rely on colour alone).

## 9. Out of scope

- No authentication UI (server handles it — §4).
- No data entry / editing / write endpoints.
- No real-time/websockets.
- No multi-tenant concept, no user management.
- Don't attempt to show any operator attribute other than first name + the
  metrics — nothing else exists in the data by design.

## 10. Deliverable & how it runs

- Build the app under **`server/dashboard/`**.
- `bun install && bun run build` (with `adapter-static`) must produce
  **`server/dashboard/build/`** containing `index.html` + assets, with an SPA
  fallback (adapter-static `fallback: 'index.html'`).
- The Bun server serves that directory at `/` and proxies nothing — your
  `fetch('/v1/...')` calls hit the same origin.
- Include a short `server/dashboard/README.md` with build/run notes.

## 11. Sample data for development

Until the live API is up, mock these responses. Here is a small fixture you can
hardcode behind a `USE_MOCK` flag for `/v1/metrics/summary`:

```json
{
  "range": { "from": "2026-06-01", "to": "2026-06-30" },
  "operators": [
    { "install_uuid": "aaa", "first_name": "gabriel", "available_seconds": 540000, "calls_received": 230, "calls_answered": 214, "answer_rate": 0.930, "avg_time_to_answer_ms": 3800, "avg_handle_ms": 250000, "handle_sample": 205 },
    { "install_uuid": "bbb", "first_name": "maria",   "available_seconds": 505000, "calls_received": 198, "calls_answered": 165, "answer_rate": 0.833, "avg_time_to_answer_ms": 6100, "avg_handle_ms": 300000, "handle_sample": 150 },
    { "install_uuid": "ccc", "first_name": "sam",     "available_seconds": 300000, "calls_received": 120, "calls_answered": 70,  "answer_rate": 0.583, "avg_time_to_answer_ms": 9200, "avg_handle_ms": 340000, "handle_sample": 58 }
  ],
  "team": { "operator_count": 3, "available_seconds": 1345000, "calls_received": 548, "calls_answered": 449, "answer_rate": 0.819, "avg_time_to_answer_ms": 5600, "avg_handle_ms": 292000, "handle_sample": 413 }
}
```

Design the tables/charts so the differences between operators like the three
above read clearly at a glance.
