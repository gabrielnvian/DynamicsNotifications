# Operations Runbook (notes-to-self)

Two gated/scheduled procedures that are easy to get wrong from cold context.

---

## A. Deploy to `dynops` — GATED on gvian's explicit approval

**Do not run any of this until gvian approves.** Deployment is owner-gated
(standing rule). The container is already built and waiting (peer `pdm`):
CT 106 `dynops` @ prox-hilltop-3, unprivileged, Bun 1.3.14, Debian 13 trixie,
user `metrics`, app dir `/opt/metrics-server`, funnel host
`dynops.tail068f9.ts.net` (funnel enabled), `:3000` loopback-locked via nftables.
Not serving yet.

**Inputs required from gvian before deploy (still owed):**
1. `ALLOWED_CIDRS` — the operators' **egress** CIDR range(s), comma-separated.
   This is what the ingest gate matches against the leftmost `X-Forwarded-For`.
2. Dashboard credentials — `DASHBOARD_USER` + `DASHBOARD_PASSWORD` (reads/CSV/
   dashboard are locked to 401 until these are set — fail-closed by design).

**Sequence once approved + inputs in hand:**
1. Build `server/.env` from `server/.env.example`: set `ALLOWED_CIDRS`,
   `CIDR_ENFORCE=true`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `HOST=127.0.0.1`,
   `PORT=3000`, `DB_PATH=/opt/metrics-server/data/metrics.db`. **Never commit
   `.env`** (it's gitignored).
2. `cd server && bun run build:dashboard` so `dashboard/build` is in the tarball.
3. Stage the tarball (exclude `node_modules`, `data`, keep `bun.lock` +
   `dashboard/build`). A prior stage lives at scratchpad `metrics-server.tgz` —
   rebuild it fresh so it includes the built dashboard.
4. Hand off: `cohub push pdm <tarball>` + send `.env` **separately/securely**
   (contains the dashboard password — prefer `cohub push` with `--keep` off, or
   have pdm generate creds locally). Tell pdm the target: untar into
   `/opt/metrics-server`, `bun install --production` is not needed (zero deps;
   pure Bun + built-ins), run under systemd (`deploy/metrics-server.service`) or
   pm2 (`deploy/ecosystem.config.cjs`).
5. **Confirm the destructive/outward step with gvian before pdm flips it live**
   (`cohub send user … --options approve,reject`).

**Post-deploy verification (run these, don't assume):**
- `curl -s http://127.0.0.1:3000/readyz` on the container → `ready`.
- From outside the allowlist over funnel → ingest returns `403`.
- **XFF spoof test** (per `deploy/TAILSCALE.md`): forge an `X-Forwarded-For` with
  an allowed IP prepended → must still be rejected (funnel replaces XFF; we read
  the **leftmost** = funnel-injected client IP). If a spoof gets through, the gate
  is misconfigured — stop and fix before go-live.
- Dashboard `/` prompts for Basic auth and loads (built SPA in `dashboard/build`);
  unauth reads → `401`; deep-links like `/live` and `/operators/<id>` load via SPA
  fallback.
- Erasure is admin-only: `DELETE /v1/metrics` without Basic auth → `401`.
- Live board: `GET /v1/presence` (with auth) returns operators; `POST /v1/presence`
  is CIDR-only like ingest. (No rate limiter — only trusted CIDR traffic reaches it.)

---

## B. Phase B — enable live call tracking (handle time + on_call status)

Needs a LIVE call to confirm the DOM signal. Both the **handle-time metric** and
the live **`on_call`** status are fully coded in `content.js` but gated behind one
flag, `CALL_TRACKING_ENABLED = false`. **Definition (updated in v1.9):** a call
spans Accept → **presence flipping back to "Available"** (Dynamics auto-sets DND
during a call and restores Available the instant of hang-up), so `handle_ms` is
**talk time only** — after-call wrap-up counts as available time. The **session
tab detaching** (end of wrap-up) stays as the backstop end signal for the rare
"went straight to Away after the call" case. (Pre-v1.9 the tab detach was the
primary signal, which *included* wrap-up — dashboards must label the metric
"talk time", not "handle time incl. wrap-up".)

**Procedure:**
1. On the next live test call, have peer `red` capture the DOM through all states
   (ringing → connected → wrap-up → closed) in the **top frame** (workspace body
   is a cross-origin PowerApps iframe, unreachable — see `DOM-CAPTURE.md`).
2. **Confirm the one open assumption:** a *voice* call opens a
   `button[role="tab"][id^="session-id-"]` in
   `div[role="tablist"][aria-label="Session list"]`, and that tab is **removed**
   when the call ends. If the real id prefix / tablist differs for voice, correct
   the selectors in `content.js` accordingly.
3. Flip `CALL_TRACKING_ENABLED = true` (turns on both handle time and live on_call).
4. Re-verify the bundle: `cd server`-independent — from repo root run the same
   `bun build` sanity check used for the other modules (no bundler errors), and
   reload the unpacked extension.
5. Live-fire: take a call, hang up, confirm a `call_ended` event with a sane
   `handle_ms` (0..86_400_000) reaches the server and `avg_handle_ms` /
   `handle_sample` populate in `/v1/metrics/summary`.
6. Confirm `on_call` appears on the live board (`/live`) during an active call, and
   handle time populates once `handle_sample > 0`. The dashboard already renders
   both — no dashboard change needed.

**Server side needs no change** — `call_ended` / `handle_ms` are accepted, folded
(`ingest.ts`), and surfaced (`metrics.ts`); `on_call` is already a valid
`/v1/presence` status. Only the client flag + selector confirmation are outstanding.
