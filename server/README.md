# Metrics Server

Ingest API + (SvelteKit) dashboard host for Dynamics operator call-handling
metrics. Runtime: **Bun** + `bun:sqlite`. Zero runtime dependencies.

Only two identity fields are ever accepted: an anonymous `install` UUID and the
operator's `operator` **first name** (the only PII). Every other field is a
non-PII scalar; unknown fields are rejected (400).

## Quick start

```sh
cd server
cp .env.example .env            # then edit (set ALLOWED_CIDRS, dashboard creds)
bun install                     # dev types only; no runtime deps
bun test                        # unit tests (CIDR + ingest/idempotency)
bun run seed                    # optional: fill ./data/metrics.db with sample data
bun run start                   # start on 127.0.0.1:$PORT
```

For local dev without a tunnel, set `CIDR_ENFORCE=false` in `.env` (otherwise the
empty allowlist fails closed and denies everything).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/events` | CIDR only | Ingest a batch (`{v,install,operator,agent?,batchId?,sentAt?,events[]}`). Idempotent on `event_id`. Returns `{ok,accepted,duplicates}`. |
| DELETE | `/v1/metrics` | CIDR only | Erase one operator: body `{install, operator}`. |
| GET | `/v1/operators` | CIDR + Basic | `{operators:[{install_uuid,first_name,last_seen}]}` |
| GET | `/v1/metrics/summary?from&to` | CIDR + Basic | Per-operator totals + team roll-up over the range. |
| GET | `/v1/metrics?from&to[&install_uuid]` | CIDR + Basic | Daily series (team + per-operator, or a single operator). |
| GET | `/v1/export/summary.csv?from&to` | CIDR + Basic | CSV, one row per operator. |
| GET | `/v1/export/daily.csv?from&to[&install_uuid]` | CIDR + Basic | CSV, one row per operator per day. |
| GET | `/healthz`, `/readyz` | none | Liveness / readiness (local probes). |
| GET | `/*` | CIDR + Basic | Serves the built dashboard SPA from `DASHBOARD_DIR`. |

`from`/`to` are inclusive `YYYY-MM-DD`; default is the last 30 days.

### Event types (inside `events[]`)
- `available_tick` → `available_seconds` (1..86400)
- `call_received` → (count only)
- `call_answered` → `time_to_answer_ms` (0..600000)
- `call_ended` → `handle_ms` (0..86400000) — Accept→session-close handle time

## Data model

- `operators(install_uuid, first_name, …)` — the only PII column is `first_name`.
- `raw_events(event_id PK, …)` — immutable, idempotent ledger. No IPs stored.
- `daily_aggregates(operator_id, day, sum+count …)` — additive rollup,
  rebuildable from `raw_events`. Averages computed from sum/count (exact).

## Security

- **CIDR gate** on every route (except health), from the **leftmost**
  `X-Forwarded-For` (Tailscale replaces it), via `node:net` `BlockList`,
  **fail-closed**. Requires loopback bind. See `deploy/TAILSCALE.md` (incl. the
  mandatory spoof-test).
- **Basic auth** on the dashboard + read/CSV endpoints.
- Never logs request bodies or client IPs (except an audit line on CIDR denial).
- `maxRequestBodySize` cap and graceful SIGTERM/SIGINT (checkpoints WAL and
  closes the DB). No rate limiting: only trusted company-CIDR traffic reaches
  these routes, so throttling it would just risk dropping legitimate metrics.

## Deploy

- **systemd:** `deploy/metrics-server.service` (hardened; single instance).
- **pm2:** `deploy/ecosystem.config.cjs` (fork mode, `instances: 1` — SQLite is
  single-writer; never cluster).
- **Tunnel:** `deploy/TAILSCALE.md`.
- **Backups:** `sqlite3 <db> ".backup <dest>"` (WAL-safe), not raw `cp`.

## Dashboard

The SvelteKit dashboard lives in `server/dashboard/` (built separately per
`docs/DASHBOARD-DESIGN-BRIEF.md`) and builds to `server/dashboard/build`, which
this server serves at `/`. Build it with `bun run build:dashboard`.
