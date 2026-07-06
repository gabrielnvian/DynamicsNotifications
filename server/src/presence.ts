import type { Database } from "bun:sqlite";

// Statuses an operator may report. "offline" is normally DERIVED at read time from
// staleness, but the extension also sends it EXPLICITLY the instant its last Dynamics
// tab closes — so a clean exit shows offline immediately instead of waiting out the
// staleness window.
export const PRESENCE_STATUSES = new Set(["available", "on_call", "away", "offline"]);

// Backstop: an operator with no explicit offline (crash / sleep / network drop) flips
// to "offline" this long after their last heartbeat. The content-script beat is ~5s in
// the foreground but throttles to ~1/min when its Dynamics tab is backgrounded, so the
// guaranteed keepalive is the service-worker alarm (every 1 min). 75s clears one missed
// alarm without flapping; a clean tab-close is instant via the explicit offline beat.
export const PRESENCE_STALE_MS = 75_000;

export interface LiveOperator {
  first_name: string;
  status: string; // available | on_call | away | offline (offline is derived)
  last_seen_ms: number; // most recent heartbeat of any kind across the person's stations
  last_online_ms: number; // last time available/on-call (i.e. taking calls); 0 if never
}

// Statuses that count as "online" (available for / on a call) for last-online tracking.
function isOnline(status: string): boolean {
  return status === "available" || status === "on_call";
}

// Merge priority when one person is signed in on several shared stations at once:
// the most "present" signal wins. on_call (definitely at the desk, handling a call)
// beats available beats away beats offline.
const MERGE_PRIORITY: Record<string, number> = {
  on_call: 0,
  available: 1,
  away: 2,
  offline: 3,
};

export function recordPresence(
  db: Database,
  install: string,
  firstName: string,
  status: string,
  now: number,
): void {
  // Storage stays per-station (keyed by install_uuid + first_name) — the merge into
  // one row per person happens at read time in listPresence. last_online_ms bumps to
  // `now` only while online (available/on_call); away/offline heartbeats leave it
  // untouched, so it marks when they were last taking calls.
  const online = isOnline(status) ? 1 : 0;
  db.query(
    `INSERT INTO presence (install_uuid, first_name, status, updated_at, last_online_ms)
     VALUES (?1, ?2, ?3, ?4, CASE WHEN ?5 = 1 THEN ?4 ELSE 0 END)
     ON CONFLICT(install_uuid, first_name) DO UPDATE SET
       status = ?3, updated_at = ?4,
       last_online_ms = CASE WHEN ?5 = 1 THEN ?4 ELSE last_online_ms END`,
  ).run(install, firstName, status, now, online);

  // History: extend or open a status span (also used by scripts/backfill-presence.ts).
  // Explicit "offline" beats write nothing — the open span just stops extending, so
  // its end IS the last heartbeat and the silence after it reads as offline.
  if (status === "offline") return;
  recordSpan(db, install, firstName, status, now);
}

/** Extend the open span if it's the same status and the beat arrived within the
 *  staleness window; otherwise open a new one. One row per status change. */
export function recordSpan(
  db: Database,
  install: string,
  firstName: string,
  status: string,
  now: number,
): void {
  const open = db
    .query(
      `SELECT id, status, last_beat FROM presence_spans
       WHERE install_uuid = ? AND first_name = ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(install, firstName) as { id: number; status: string; last_beat: number } | null;

  if (open && open.status === status && now - open.last_beat <= PRESENCE_STALE_MS && now >= open.last_beat) {
    db.query("UPDATE presence_spans SET last_beat = ? WHERE id = ?").run(now, open.id);
    return;
  }
  db.query(
    `INSERT INTO presence_spans (install_uuid, first_name, status, started_at, last_beat)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(install, firstName, status, now, now);
}

// Local-midnight bounds of a YYYY-MM-DD day (server TZ; d+1 handles DST correctly).
function dayBoundsMs(day: string): { start: number; end: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() };
}

function localYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

interface SpanRow {
  first_name: string;
  status: string;
  started_at: number;
  last_beat: number;
}

function spansOverlapping(db: Database, startMs: number, endMs: number, name?: string): SpanRow[] {
  const where = name ? "AND first_name = ? COLLATE NOCASE" : "";
  const params = name ? [endMs, startMs, name] : [endMs, startMs];
  return db
    .query(
      `SELECT first_name AS first_name, status AS status,
              started_at AS started_at, last_beat AS last_beat
       FROM presence_spans
       WHERE started_at < ? AND last_beat > ? ${where}
       ORDER BY first_name, started_at`,
    )
    .all(...params) as SpanRow[];
}

/** Merge [start,end] ms intervals into a sorted, non-overlapping union. */
function unionIntervals(iv: Array<[number, number]>): Array<[number, number]> {
  if (iv.length === 0) return [];
  iv.sort((a, b) => a[0] - b[0]);

  const out: Array<[number, number]> = [[iv[0][0], iv[0][1]]];
  for (let i = 1; i < iv.length; i++) {
    const [s, e] = iv[i];
    const last = out[out.length - 1];
    if (s > last[1]) out.push([s, e]);
    else if (e > last[1]) last[1] = e;
  }

  return out;
}

/** Seconds covered by the UNION of [start,end] ms intervals — the same person signed
 *  in on two stations at once must not double-count. */
function unionSeconds(iv: Array<[number, number]>): number {
  const total = unionIntervals(iv).reduce((a, [s, e]) => a + (e - s), 0);
  return Math.round(total / 1000);
}

export interface CoverageGap {
  start_ms: number;
  end_ms: number;
}

export interface DayCoverage {
  staffed_start_ms: number | null; // first..last presence signal of the day (any status)
  staffed_end_ms: number | null; // null when the day has no presence history at all
  uncovered_seconds: number; // Σ gaps
  gaps: CoverageGap[];
}

/** Phone coverage for one server-local day. "Covered" = at least ONE operator in the
 *  "available" status — only they get routed a new call; when everyone is on_call /
 *  away (incl. Dynamics "Busy") / offline, callers go straight to voicemail without
 *  ringing anyone, so the call events never see them. The gaps are the zero-available
 *  windows inside the STAFFED window (first..last presence signal of the day, any
 *  status). Before the first sign-in / after the last sign-off we can't tell a
 *  coverage failure from the office simply being closed, so those edges are excluded
 *  rather than guessed. */
export function dayCoverage(db: Database, day: string): DayCoverage {
  const { start, end } = dayBoundsMs(day);
  const rows = spansOverlapping(db, start, end);
  if (rows.length === 0) {
    return { staffed_start_ms: null, staffed_end_ms: null, uncovered_seconds: 0, gaps: [] };
  }

  const byOp = new Map<string, TimelineSpan[]>();
  for (const r of rows) {
    const clipped = {
      status: r.status,
      start_ms: Math.max(r.started_at, start),
      end_ms: Math.min(r.last_beat, end),
    };
    if (clipped.end_ms < clipped.start_ms) continue;
    const list = byOp.get(r.first_name);
    if (list) list.push(clipped);
    else byOp.set(r.first_name, [clipped]);
  }

  // Resolve each PERSON to one status per instant first (a second station can say
  // "available" while they're actually on a call — most-present wins, same rule as
  // the timeline), then union the truly-available intervals across people.
  const flat = [...byOp.values()].map((spans) =>
    flattenSpans(spans.sort((a, b) => a.start_ms - b.start_ms)),
  );

  const all = flat.flat();
  const staffedStart = Math.min(...all.map((s) => s.start_ms));
  const staffedEnd = Math.max(...all.map((s) => s.end_ms));

  const avail = unionIntervals(
    all
      .filter((s) => s.status === "available" && s.end_ms > s.start_ms)
      .map((s) => [s.start_ms, s.end_ms] as [number, number]),
  );

  // A status flip leaves a beat-interval hole between the old span's last beat and
  // the new span's first (5s foreground / up to 60s background cadence) — counting
  // those as "nobody available" would add a phantom minute per transition. Only a
  // hole of a full minute or more is a real coverage gap.
  const MIN_GAP_MS = 60_000;

  const gaps: CoverageGap[] = [];
  let cursor = staffedStart;
  for (const [s, e] of avail) {
    if (s - cursor >= MIN_GAP_MS) gaps.push({ start_ms: cursor, end_ms: s });
    cursor = Math.max(cursor, e);
  }
  if (staffedEnd - cursor >= MIN_GAP_MS) gaps.push({ start_ms: cursor, end_ms: staffedEnd });

  const uncovered = Math.round(gaps.reduce((a, g) => a + (g.end_ms - g.start_ms), 0) / 1000);
  return {
    staffed_start_ms: staffedStart,
    staffed_end_ms: staffedEnd,
    uncovered_seconds: uncovered,
    gaps,
  };
}

/** Split coverage gaps into intraday slot buckets → seconds per slot index. Slots are
 *  wall-clock minutes-since-midnight / slotMin — the SAME bucketing as the metrics
 *  slot queries (slotExpr), so the two stay aligned even across a DST change. */
export function gapSecondsBySlot(gaps: CoverageGap[], slotMin: number): Map<number, number> {
  const bySlot = new Map<number, number>();
  for (const g of gaps) {
    let t = g.start_ms;
    while (t < g.end_ms) {
      const d = new Date(t);
      const slot = Math.floor((d.getHours() * 60 + d.getMinutes()) / slotMin);
      const slotEnd = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        0,
        (slot + 1) * slotMin,
      ).getTime();
      if (slotEnd <= t) {
        // Wall-clock repeat (DST fall-back): dump the remainder here rather than loop.
        bySlot.set(slot, (bySlot.get(slot) ?? 0) + (g.end_ms - t) / 1000);
        break;
      }
      const e = Math.min(g.end_ms, slotEnd);
      bySlot.set(slot, (bySlot.get(slot) ?? 0) + (e - t) / 1000);
      t = e;
    }
  }

  // Round once at the end so a gap split across slots doesn't accumulate drift.
  for (const [k, v] of bySlot) bySlot.set(k, Math.round(v));
  return bySlot;
}

const MAX_SUMMARY_DAYS = 1000; // same sanity cap as the metrics densify

export interface OnlineSummary {
  range: { from: string; to: string };
  days: { day: string; online_seconds: number }[]; // person-seconds summed per day
  operators: { first_name: string; online_seconds: number }[];
}

/** Online time (ANY status: available/on_call/away) from the presence spans — per
 *  day and per operator over [from, to]. Person-seconds, so the team-day totals
 *  compare 1:1 with active_seconds. Only days with any signal are returned. */
export function onlineSummary(
  db: Database,
  from: string,
  to: string,
  name?: string,
): OnlineSummary {
  const empty: OnlineSummary = { range: { from, to }, days: [], operators: [] };
  const first = dayBoundsMs(from);
  const last = dayBoundsMs(to);
  const spanDays = (last.end - first.start) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays <= 0 || spanDays > MAX_SUMMARY_DAYS) return empty;

  const rows = spansOverlapping(db, first.start, last.end, name);
  const byOp = new Map<string, SpanRow[]>();
  for (const r of rows) {
    const list = byOp.get(r.first_name);
    if (list) list.push(r);
    else byOp.set(r.first_name, [r]);
  }

  const days: { day: string; online_seconds: number }[] = [];
  const perOp = new Map<string, number>();
  for (let t = first.start; t < last.end; ) {
    const { start, end } = dayBoundsMs(localYmd(t));
    let daySecs = 0;
    for (const [op, spans] of byOp) {
      const iv = spans
        .map((s) => [Math.max(s.started_at, start), Math.min(s.last_beat, end)] as [number, number])
        .filter(([s, e]) => e > s);
      const secs = unionSeconds(iv);
      if (secs > 0) {
        daySecs += secs;
        perOp.set(op, (perOp.get(op) ?? 0) + secs);
      }
    }
    if (daySecs > 0) days.push({ day: localYmd(t), online_seconds: daySecs });
    t = end;
  }

  const operators = [...perOp.entries()]
    .map(([first_name, online_seconds]) => ({ first_name, online_seconds }))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
  return { range: { from, to }, days, operators };
}

interface TimelineSpan {
  status: string;
  start_ms: number;
  end_ms: number;
}

// Resolve overlapping spans (two stations, or an on_call window inside a merged
// available window) into ONE status per instant — the most-present wins, mirroring
// the live board's merge rule. Output is non-overlapping, sorted, with adjacent
// same-status segments coalesced; isolated single-beat spans survive.
function flattenSpans(spans: TimelineSpan[]): TimelineSpan[] {
  if (spans.length <= 1) return spans;

  const bounds = [...new Set(spans.flatMap((s) => [s.start_ms, s.end_ms]))].sort((a, b) => a - b);
  const out: TimelineSpan[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    let best: string | null = null;
    for (const sp of spans) {
      if (sp.start_ms <= s && sp.end_ms >= e) {
        if (best == null || (MERGE_PRIORITY[sp.status] ?? 99) < (MERGE_PRIORITY[best] ?? 99)) {
          best = sp.status;
        }
      }
    }
    if (best == null) continue;
    const last = out[out.length - 1];
    if (last && last.status === best && last.end_ms === s) last.end_ms = e;
    else out.push({ status: best, start_ms: s, end_ms: e });
  }

  // A lone-beat span (start == end) spans no sweep segment — keep it unless a real
  // segment already covers that instant.
  for (const sp of spans) {
    if (sp.start_ms === sp.end_ms && !out.some((o) => o.start_ms <= sp.start_ms && o.end_ms >= sp.end_ms)) {
      out.push(sp);
    }
  }

  return out.sort((a, b) => a.start_ms - b.start_ms);
}

export interface PresenceTimeline {
  day: string;
  start_ms: number; // local-midnight bounds of the day
  end_ms: number;
  operators: {
    first_name: string;
    online_seconds: number;
    spans: TimelineSpan[];
  }[];
}

/** Exact status timeline for one server-local day — spans clipped to the day, one
 *  lane per person. Gaps between spans are offline/no-signal time. */
export function presenceTimeline(db: Database, day: string): PresenceTimeline {
  const { start, end } = dayBoundsMs(day);
  const rows = spansOverlapping(db, start, end);

  const byOp = new Map<string, SpanRow[]>();
  for (const r of rows) {
    const list = byOp.get(r.first_name);
    if (list) list.push(r);
    else byOp.set(r.first_name, [r]);
  }

  const operators = [...byOp.entries()]
    .map(([first_name, spans]) => {
      const clipped = spans
        .map((s) => ({
          status: s.status,
          start_ms: Math.max(s.started_at, start),
          end_ms: Math.min(s.last_beat, end),
        }))
        .filter((s) => s.end_ms >= s.start_ms)
        .sort((a, b) => a.start_ms - b.start_ms);
      const flat = flattenSpans(clipped);
      return {
        first_name,
        online_seconds: unionSeconds(flat.map((s) => [s.start_ms, s.end_ms])),
        spans: flat,
      };
    })
    .filter((o) => o.spans.length > 0)
    .sort((a, b) => b.online_seconds - a.online_seconds || a.first_name.localeCompare(b.first_name));

  return { day, start_ms: start, end_ms: end, operators };
}

// One live row PER PERSON (first name), merged across every station they're signed in
// on. Shared workstations mean the same operator accrues many install_uuids over time;
// collapsing by first name is the current identity model (until per-operator email is
// approved). Each station's status is aged to offline independently, then the freshest
// / most-present signal wins.
export function listPresence(db: Database, now: number) {
  const rows = db
    .query(
      `SELECT first_name AS first_name, status AS status,
              updated_at AS updated_at, last_online_ms AS last_online_ms
       FROM presence`,
    )
    .all() as {
      first_name: string;
      status: string;
      updated_at: number;
      last_online_ms: number;
    }[];

  const byName = new Map<string, LiveOperator>();
  for (const r of rows) {
    const eff = now - r.updated_at > PRESENCE_STALE_MS ? "offline" : r.status;
    const cur = byName.get(r.first_name);
    if (!cur) {
      byName.set(r.first_name, {
        first_name: r.first_name,
        status: eff,
        last_seen_ms: r.updated_at,
        last_online_ms: r.last_online_ms,
      });
      continue;
    }
    if ((MERGE_PRIORITY[eff] ?? 99) < (MERGE_PRIORITY[cur.status] ?? 99)) {
      cur.status = eff;
    }
    if (r.updated_at > cur.last_seen_ms) cur.last_seen_ms = r.updated_at;
    if (r.last_online_ms > cur.last_online_ms) cur.last_online_ms = r.last_online_ms;
  }

  const operators = [...byName.values()].sort((a, b) =>
    a.first_name.localeCompare(b.first_name),
  );
  return { now, stale_after_ms: PRESENCE_STALE_MS, operators };
}
