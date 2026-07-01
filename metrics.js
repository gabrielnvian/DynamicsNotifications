// Dynamics Notifications — Team Metrics engine (metrics.js)
//
// The "accountant + delivery" layer, imported by the background service worker.
// Fully decoupled from the alert code. Metrics are mandatory (recorded per employer
// policy); delivery still no-ops until a valid operator first name is detected.
//
// DATA MINIMISATION: outbound payloads are assembled key-by-key from constants
// (buildEvent / buildEnvelope) — we NEVER spread a DOM node or a runtime message
// object into a payload. The only personal field that can leave the device is the
// operator's FIRST NAME (first token), plus an anonymous install UUID.

// ── Constants ──────────────────────────────────────────────────────────────
export const SCHEMA_V = 1;

// Fixed metrics endpoint for the pilot: the self-hosted Bun server behind
// Tailscale Funnel. Hard-coded (not a user setting) because the extension is
// force-installed with a matching required host_permission and metrics are
// mandatory; it moves to a company host when the pilot graduates.
const SERVER_URL = "https://dynops.tail068f9.ts.net";

const SETTINGS_DEFAULTS = {
  metricsFirstName: "",
  metricsInstallId: "",
};

const Q_PREFIX = "q/"; // one queued event per key: `q/<enqMs>-<uuid>`
const CLOCK_KEY = "metrics.clock"; // { effectiveAvailable, sinceTs }
const BACKOFF_KEY = "metrics.backoff"; // { attempt, nextTs }

const QUEUE_CAP = 2000; // FIFO cap; drop oldest beyond this
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // sweep events older than 7 days
const AVAILABLE_CLAMP_MS = 150_000; // gaps larger than this = sleep/eviction → dropped
const BATCH_MAX = 200; // events per POST
const ANON_INSTALL = "00000000-0000-0000-0000-000000000000";

const NAME_RE = /^\p{L}[\p{L}.'\-]*$/u;

// ── Small helpers ────────────────────────────────────────────────────────
export function sanitizeFirstName(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFC").trim();
  if (!s) return "";
  s = s.split(/\s+/)[0].slice(0, 40); // first token only
  return NAME_RE.test(s) ? s : "";
}

function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function localMidnightAfter(ms) {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// Serialise storage read-modify-write sequences (the SW handles messages
// concurrently). The mutex lives in memory; on eviction a partial write is
// re-reconciled on the next heartbeat, so drift is bounded to seconds.
let _chain = Promise.resolve();
export function withLock(fn) {
  const p = _chain.then(fn, fn);
  _chain = p.then(
    () => {},
    () => {},
  );
  return p;
}

// ── Allowlist builders (the ONLY place payload keys are constructed) ───────
export function buildEvent(type, day, extra = {}) {
  const e = { event_id: crypto.randomUUID(), type, day };
  if (type === "available_tick") e.available_seconds = clampInt(extra.available_seconds, 1, 86400);
  else if (type === "call_answered") e.time_to_answer_ms = clampInt(extra.time_to_answer_ms, 0, 600000);
  else if (type === "call_ended") e.handle_ms = clampInt(extra.handle_ms, 0, 86400000);
  else if (type !== "call_received") throw new Error(`bad event type: ${type}`);
  return e;
}

export function buildEnvelope(settings, events) {
  const operator = sanitizeFirstName(settings.metricsFirstName);
  if (!operator) throw new Error("no valid first name");
  return {
    v: SCHEMA_V,
    install: settings.metricsInstallId || ANON_INSTALL,
    operator,
    agent: chrome.runtime.getManifest().version,
    batchId: crypto.randomUUID(),
    sentAt: Date.now(),
    events,
  };
}

// ── Settings / install id ──────────────────────────────────────────────────
export async function getSettings() {
  return await chrome.storage.sync.get(SETTINGS_DEFAULTS);
}

export async function ensureInstallId() {
  const { metricsInstallId } = await chrome.storage.sync.get({ metricsInstallId: "" });
  if (metricsInstallId) return metricsInstallId;
  const id = crypto.randomUUID();
  await chrome.storage.sync.set({ metricsInstallId: id });
  return id;
}

// ── Durable queue (one key per event) ──────────────────────────────────────
export async function enqueue(ev) {
  const key = `${Q_PREFIX}${String(Date.now()).padStart(13, "0")}-${ev.event_id}`;
  await chrome.storage.local.set({ [key]: ev });
  const all = await chrome.storage.local.get(null);
  const qKeys = Object.keys(all).filter((k) => k.startsWith(Q_PREFIX)).sort();
  if (qKeys.length > QUEUE_CAP) {
    await chrome.storage.local.remove(qKeys.slice(0, qKeys.length - QUEUE_CAP));
  }
}

export async function sweepOld(now = Date.now()) {
  const all = await chrome.storage.local.get(null);
  const cutoff = now - MAX_AGE_MS;
  const drop = Object.keys(all).filter((k) => {
    if (!k.startsWith(Q_PREFIX)) return false;
    const ts = Number(k.slice(Q_PREFIX.length).split("-")[0]);
    return Number.isFinite(ts) && ts < cutoff;
  });
  if (drop.length) await chrome.storage.local.remove(drop);
}

// ── Call metric recorders (called from background message handlers) ────────
export async function recordCallReceived(now = Date.now()) {
  await enqueue(buildEvent("call_received", localDay(now)));
}
export async function recordCallAnswered(ttaMs, now = Date.now()) {
  await enqueue(buildEvent("call_answered", localDay(now), { time_to_answer_ms: ttaMs }));
}
export async function recordCallEnded(handleMs, now = Date.now()) {
  await enqueue(buildEvent("call_ended", localDay(now), { handle_ms: handleMs }));
}

// ── Availability clock (only ever credits "available" seconds) ─────────────
export async function setEffectiveAvailable(available, now = Date.now()) {
  await tickIfAvailable(now);
  const g = await chrome.storage.local.get(CLOCK_KEY);
  const cur = g[CLOCK_KEY] || { effectiveAvailable: false, sinceTs: now };
  cur.effectiveAvailable = !!available;
  cur.sinceTs = now;
  await chrome.storage.local.set({ [CLOCK_KEY]: cur });
}

export async function tickIfAvailable(now = Date.now()) {
  const g = await chrome.storage.local.get(CLOCK_KEY);
  const cur = g[CLOCK_KEY];
  if (!cur) return;
  if (!cur.effectiveAvailable) {
    cur.sinceTs = now; // don't accrue non-available time
    await chrome.storage.local.set({ [CLOCK_KEY]: cur });
    return;
  }
  const elapsed = now - cur.sinceTs;
  if (elapsed <= 0) return;
  if (elapsed > AVAILABLE_CLAMP_MS) {
    // sleep / SW eviction / browser closed — drop the gap, never credit it
    cur.sinceTs = now;
    await chrome.storage.local.set({ [CLOCK_KEY]: cur });
    return;
  }
  // credit available seconds, split at local midnight into per-day ticks
  let c = cur.sinceTs;
  while (c < now) {
    const stop = Math.min(now, localMidnightAfter(c));
    const secs = Math.round((stop - c) / 1000);
    if (secs >= 1) {
      await enqueue(buildEvent("available_tick", localDay(c), { available_seconds: secs }));
    }
    c = stop;
  }
  cur.sinceTs = now;
  await chrome.storage.local.set({ [CLOCK_KEY]: cur });
}

// ── Delivery (batched flush with retry/backoff) ────────────────────────────
async function underBackoff(now) {
  const g = await chrome.storage.local.get(BACKOFF_KEY);
  const b = g[BACKOFF_KEY];
  return !!(b && now < b.nextTs);
}
async function bumpBackoff() {
  const now = Date.now();
  const g = await chrome.storage.local.get(BACKOFF_KEY);
  const b = g[BACKOFF_KEY] || { attempt: 0 };
  b.attempt = Math.min(b.attempt + 1, 12);
  const base = Math.min(30 * 60_000, 30_000 * 2 ** (b.attempt - 1));
  const jitter = 0.8 + Math.random() * 0.4;
  b.nextTs = now + Math.round(base * jitter);
  await chrome.storage.local.set({ [BACKOFF_KEY]: b });
}
async function resetBackoff() {
  await chrome.storage.local.remove(BACKOFF_KEY);
}

export async function flush() {
  const settings = await getSettings();
  if (!sanitizeFirstName(settings.metricsFirstName)) return; // no operator identity detected yet
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const now = Date.now();
  if (await underBackoff(now)) return;

  const all = await chrome.storage.local.get(null);
  const qKeys = Object.keys(all).filter((k) => k.startsWith(Q_PREFIX)).sort();
  if (qKeys.length === 0) return;

  const batchKeys = qKeys.slice(0, BATCH_MAX);
  const events = batchKeys.map((k) => all[k]);

  let env;
  try {
    env = buildEnvelope(settings, events);
  } catch {
    return; // no valid first name / install — nothing to send
  }

  const url = SERVER_URL + "/v1/events";
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env),
    });
  } catch (_) {
    await bumpBackoff(); // network error — retry later
    return;
  }

  if (res.ok) {
    await chrome.storage.local.remove(batchKeys);
    await resetBackoff();
    return; // remaining events drain on the next heartbeat
  }
  if (res.status >= 400 && res.status < 500) {
    // permanent (validation / auth / CIDR): drop this batch so it can't wedge
    // the queue, but keep the server as the source of truth.
    await chrome.storage.local.remove(batchKeys);
    console.warn("[Dynamics Notifications] metrics batch rejected:", res.status);
    return;
  }
  await bumpBackoff(); // 5xx — retry later
}

// ── Live presence heartbeat (drives the real-time operator board) ──────────
// Fire-and-forget: liveness is disposable, so unlike events there is NO durable
// queue. A dropped beat is corrected by the next one; a lapse in beats (tab closed,
// machine locked/off) is what the server reads as "offline". keepalive lets a final
// beat survive page unload. status is one of: available | on_call | away.
export async function sendPresence(status) {
  const settings = await getSettings();
  const operator = sanitizeFirstName(settings.metricsFirstName);
  if (!operator) return; // no operator identity detected yet
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const body = {
    install: settings.metricsInstallId || ANON_INSTALL,
    operator,
    status,
  };
  try {
    await fetch(SERVER_URL + "/v1/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch (_) {
    // Network error — drop it; the next heartbeat re-reports the current status.
  }
}
