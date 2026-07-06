import type { Database } from "bun:sqlite";
import { dayCoverage, gapSecondsBySlot, type DayCoverage } from "./presence.ts";
import type { DailyPoint, OperatorSummary } from "./types.ts";

// Identity model: the dashboard groups everything by FIRST NAME, not install_uuid.
// Shared workstations mean one person logs in on whichever of the 8 stations is free,
// so a single operator accrues many install_uuids — grouping by first name merges
// those back into one person. Storage stays per-(install_uuid, first_name); the merge
// is entirely in these read queries, so it's reversible once per-operator email lands.

function avg(sum: number, cnt: number): number | null {
  return cnt > 0 ? Math.round(sum / cnt) : null;
}

interface AggRow {
  first_name: string;
  available_seconds: number;
  calls_received: number;
  calls_answered: number;
  sum_tta_ms: number;
  cnt_tta: number;
  sum_handle_ms: number;
  cnt_handle: number;
}
interface DailyAggRow extends AggRow {
  day: string;
}

function toSummary(r: AggRow): OperatorSummary {
  return {
    first_name: r.first_name,
    available_seconds: r.available_seconds,
    // Active = available (ready) + talk time — so heavy call-takers aren't penalised for
    // the on-call time that available_seconds excludes. Computed at read time from stored
    // aggregates, so it applies retroactively to all history.
    active_seconds: r.available_seconds + Math.round(r.sum_handle_ms / 1000),
    calls_received: r.calls_received,
    calls_answered: r.calls_answered,
    answer_rate: r.calls_received > 0 ? r.calls_answered / r.calls_received : null,
    avg_time_to_answer_ms: avg(r.sum_tta_ms, r.cnt_tta),
    avg_handle_ms: avg(r.sum_handle_ms, r.cnt_handle),
    handle_sample: r.cnt_handle,
  };
}

function toDaily(r: DailyAggRow): DailyPoint {
  return {
    day: r.day,
    available_seconds: r.available_seconds,
    active_seconds: r.available_seconds + Math.round(r.sum_handle_ms / 1000),
    calls_received: r.calls_received,
    calls_answered: r.calls_answered,
    avg_time_to_answer_ms: avg(r.sum_tta_ms, r.cnt_tta),
    avg_handle_ms: avg(r.sum_handle_ms, r.cnt_handle),
    handle_sample: r.cnt_handle,
  };
}

function zeroDay(day: string): DailyPoint {
  return {
    day,
    available_seconds: 0,
    active_seconds: 0,
    calls_received: 0,
    calls_answered: 0,
    avg_time_to_answer_ms: null,
    avg_handle_ms: null,
    handle_sample: 0,
  };
}

// Fill every calendar day of [from, to], zeroing the days with no rows. The GROUP BY
// queries only return days that have data, so without this a chart of a range with
// idle days (weekends, leave) silently skips them — the x-axis compresses time and
// day-over-day shapes mislead. Zero calls is a true value; the averages stay null.
// Sanity cap: a hostile or typo'd range (the day regex allows any 4-digit year) must
// not allocate decades of zero rows. Past it, fall back to the sparse rows.
const MAX_DENSIFY_DAYS = 1000;

function densifyDays(rows: DailyPoint[], from: string, to: string): DailyPoint[] {
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  const span = (end.getTime() - cur.getTime()) / 86_400_000 + 1;
  if (!Number.isFinite(span) || span > MAX_DENSIFY_DAYS) return rows;

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DailyPoint[] = [];
  for (; cur.getTime() <= end.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
    const day = cur.toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? zeroDay(day));
  }
  return out;
}

// Intraday charts bucket by the LOCAL HOUR OF RECEIPT, which is only honest for
// events that arrived on the day they happened. The extension queues offline for up
// to 7 days — a late-flushed batch would otherwise land at the flush hour (possibly
// on a different calendar day's clock) instead of the call's hour. Late events stay
// in the daily totals (keyed on the client `day`); they are only excluded here.
const SAME_DAY_RECEIPT =
  "date(e.received_at / 1000, 'unixepoch', 'localtime') = e.day";

export function listOperators(db: Database) {
  const operators = db
    .query(
      `SELECT o.first_name AS first_name, MAX(d.day) AS last_seen,
              GROUP_CONCAT(DISTINCT o.last_agent) AS agents
       FROM operators o
       LEFT JOIN daily_aggregates d ON d.operator_id = o.id
       GROUP BY o.first_name
       ORDER BY o.first_name`,
    )
    .all();
  return { operators };
}

export function summary(db: Database, from: string, to: string) {
  const rows = db
    .query(
      `SELECT o.first_name AS first_name,
        COALESCE(SUM(d.available_seconds),0) AS available_seconds,
        COALESCE(SUM(d.calls_received),0)    AS calls_received,
        COALESCE(SUM(d.calls_answered),0)    AS calls_answered,
        COALESCE(SUM(d.sum_tta_ms),0)        AS sum_tta_ms,
        COALESCE(SUM(d.cnt_tta),0)           AS cnt_tta,
        COALESCE(SUM(d.sum_handle_ms),0)     AS sum_handle_ms,
        COALESCE(SUM(d.cnt_handle),0)        AS cnt_handle
       FROM operators o
       JOIN daily_aggregates d ON d.operator_id = o.id AND d.day BETWEEN ? AND ?
       GROUP BY o.first_name
       ORDER BY o.first_name`,
    )
    .all(from, to) as AggRow[];

  const operators = rows.map(toSummary);
  const t = rows.reduce(
    (a, r) => ({
      available_seconds: a.available_seconds + r.available_seconds,
      calls_received: a.calls_received + r.calls_received,
      calls_answered: a.calls_answered + r.calls_answered,
      sum_tta_ms: a.sum_tta_ms + r.sum_tta_ms,
      cnt_tta: a.cnt_tta + r.cnt_tta,
      sum_handle_ms: a.sum_handle_ms + r.sum_handle_ms,
      cnt_handle: a.cnt_handle + r.cnt_handle,
    }),
    {
      available_seconds: 0,
      calls_received: 0,
      calls_answered: 0,
      sum_tta_ms: 0,
      cnt_tta: 0,
      sum_handle_ms: 0,
      cnt_handle: 0,
    },
  );
  const team = {
    operator_count: rows.length,
    available_seconds: t.available_seconds,
    // Sum the per-operator values (each rounded once) — rounding the team's raw sum
    // separately makes team ≠ Σ operators by ±1s per operator, visible in CSV sums.
    active_seconds: operators.reduce((a, o) => a + o.active_seconds, 0),
    calls_received: t.calls_received,
    calls_answered: t.calls_answered,
    answer_rate: t.calls_received > 0 ? t.calls_answered / t.calls_received : null,
    avg_time_to_answer_ms: avg(t.sum_tta_ms, t.cnt_tta),
    avg_handle_ms: avg(t.sum_handle_ms, t.cnt_handle),
    handle_sample: t.cnt_handle,
  };

  return { range: { from, to }, operators, team };
}

interface SlotAggRow {
  slot: number;
  available_seconds: number;
  calls_received: number;
  calls_answered: number;
  sum_tta_ms: number;
  cnt_tta: number;
  sum_handle_ms: number;
  cnt_handle: number;
}

/** Allowed intraday bucket sizes (minutes). Route input snaps to these — the value is
 *  interpolated into SQL, so it must never be a free-form string. */
export const SLOT_MINUTES = new Set([15, 30, 60]);

function slotLabel(slot: number, slotMin: number): string {
  const min = slot * slotMin;
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Minutes-since-local-midnight of receipt, integer-divided into slot indexes. The
// process TZ decides "local" — set to Pacific in the service unit.
function slotExpr(slotMin: number): string {
  return `(CAST(strftime('%H', e.received_at / 1000, 'unixepoch', 'localtime') AS INTEGER) * 60
         + CAST(strftime('%M', e.received_at / 1000, 'unixepoch', 'localtime') AS INTEGER)) / ${slotMin}`;
}

// Intraday buckets for one operator-local day, aggregated from raw_events by the local
// time of receipt (received_at ≈ occurrence for near-real-time beats; late-flushed
// batches are excluded — see SAME_DAY_RECEIPT). Auto-sizes to the first..last slot
// that has activity (fills the slots between so the axis stays continuous), rather
// than padding empty midnight-to-now slots.
// Wall-clock slot index of an epoch ms — must match slotExpr's bucketing.
function slotOfMs(ms: number, slotMin: number): number {
  const d = new Date(ms);
  return Math.floor((d.getHours() * 60 + d.getMinutes()) / slotMin);
}

function slotPoints(
  db: Database,
  day: string,
  slotMin: number,
  name?: string,
  coverage?: DayCoverage,
): DailyPoint[] {
  const where = name ? "AND o.first_name = ? COLLATE NOCASE" : "";
  const params = name ? [day, name] : [day];
  const rows = db
    .query(
      `SELECT ${slotExpr(slotMin)} AS slot,
        SUM(CASE WHEN e.type='available_tick' THEN COALESCE(e.available_seconds,0) ELSE 0 END) AS available_seconds,
        SUM(CASE WHEN e.type='call_received'  THEN 1 ELSE 0 END) AS calls_received,
        SUM(CASE WHEN e.type='call_answered'  THEN 1 ELSE 0 END) AS calls_answered,
        SUM(CASE WHEN e.type='call_answered'  THEN COALESCE(e.time_to_answer_ms,0) ELSE 0 END) AS sum_tta_ms,
        SUM(CASE WHEN e.type='call_answered'  THEN 1 ELSE 0 END) AS cnt_tta,
        SUM(CASE WHEN e.type='call_ended'     THEN COALESCE(e.handle_ms,0) ELSE 0 END) AS sum_handle_ms,
        SUM(CASE WHEN e.type='call_ended'     THEN 1 ELSE 0 END) AS cnt_handle
       FROM raw_events e JOIN operators o ON o.id = e.operator_id
       WHERE e.day = ? AND ${SAME_DAY_RECEIPT} ${where}
       GROUP BY slot`,
    )
    .all(...params) as SlotAggRow[];
  const bySlot = new Map<number, SlotAggRow>(rows.map((r) => [r.slot, r]));
  const slots = [...bySlot.keys()];

  // Coverage context (team view): the axis widens to the staffed window, so a
  // quiet-but-staffed early hour or a trailing no-coverage stretch after the last
  // call still gets charted instead of silently dropped.
  const uncov = coverage ? gapSecondsBySlot(coverage.gaps, slotMin) : null;
  if (coverage && coverage.staffed_start_ms != null && coverage.staffed_end_ms != null) {
    slots.push(slotOfMs(coverage.staffed_start_ms, slotMin), slotOfMs(coverage.staffed_end_ms, slotMin));
  }

  if (slots.length === 0) return []; // no activity → empty chart (caller shows empty state)
  const first = Math.min(...slots);
  const last = Math.max(...slots);
  const points: DailyPoint[] = [];
  for (let s = first; s <= last; s++) {
    const r = bySlot.get(s);
    points.push({
      day,
      label: slotLabel(s, slotMin),
      available_seconds: r?.available_seconds ?? 0,
      active_seconds: (r?.available_seconds ?? 0) + Math.round((r?.sum_handle_ms ?? 0) / 1000),
      calls_received: r?.calls_received ?? 0,
      calls_answered: r?.calls_answered ?? 0,
      avg_time_to_answer_ms: r && r.cnt_tta > 0 ? Math.round(r.sum_tta_ms / r.cnt_tta) : null,
      avg_handle_ms: r && r.cnt_handle > 0 ? Math.round(r.sum_handle_ms / r.cnt_handle) : null,
      handle_sample: r?.cnt_handle ?? 0,
      ...(uncov ? { uncovered_seconds: uncov.get(s) ?? 0 } : {}),
    });
  }
  return points;
}

export function daily(db: Database, from: string, to: string, name?: string, slotMin = 60) {
  const singleDay = from === to; // single-day views chart by intraday slot, not one flat point
  if (name) {
    if (singleDay) return { range: { from, to }, name, days: slotPoints(db, from, slotMin, name) };
    const rows = db
      .query(
        `SELECT d.day AS day,
          SUM(d.available_seconds) AS available_seconds,
          SUM(d.calls_received)    AS calls_received,
          SUM(d.calls_answered)    AS calls_answered,
          SUM(d.sum_tta_ms)        AS sum_tta_ms,
          SUM(d.cnt_tta)           AS cnt_tta,
          SUM(d.sum_handle_ms)     AS sum_handle_ms,
          SUM(d.cnt_handle)        AS cnt_handle
         FROM daily_aggregates d JOIN operators o ON o.id = d.operator_id
         WHERE o.first_name = ? COLLATE NOCASE AND d.day BETWEEN ? AND ?
         GROUP BY d.day ORDER BY d.day`,
      )
      .all(name, from, to) as DailyAggRow[];
    return { range: { from, to }, name, days: densifyDays(rows.map(toDaily), from, to) };
  }

  const days = singleDay
    ? // Team day view gets the coverage context; the per-operator branch above does
      // not — zero-available is a team fact, not any one person's.
      slotPoints(db, from, slotMin, undefined, dayCoverage(db, from))
    : densifyDays(
        (
          db
            .query(
              `SELECT d.day AS day,
          SUM(d.available_seconds) AS available_seconds,
          SUM(d.calls_received)    AS calls_received,
          SUM(d.calls_answered)    AS calls_answered,
          SUM(d.sum_tta_ms)        AS sum_tta_ms,
          SUM(d.cnt_tta)           AS cnt_tta,
          SUM(d.sum_handle_ms)     AS sum_handle_ms,
          SUM(d.cnt_handle)        AS cnt_handle
         FROM daily_aggregates d
         WHERE d.day BETWEEN ? AND ?
         GROUP BY d.day ORDER BY d.day`,
            )
            .all(from, to) as DailyAggRow[]
        ).map(toDaily),
        from,
        to,
      );

  // Per-operator series, merged by first name (SUM the sums/counts across the person's
  // stations at the SQL level, then derive averages — never average pre-averaged days).
  const byOpRows = db
    .query(
      `SELECT o.first_name AS first_name, d.day AS day,
        SUM(d.available_seconds) AS available_seconds,
        SUM(d.calls_received)    AS calls_received,
        SUM(d.calls_answered)    AS calls_answered,
        SUM(d.sum_tta_ms)        AS sum_tta_ms,
        SUM(d.cnt_tta)           AS cnt_tta,
        SUM(d.sum_handle_ms)     AS sum_handle_ms,
        SUM(d.cnt_handle)        AS cnt_handle
       FROM daily_aggregates d JOIN operators o ON o.id = d.operator_id
       WHERE d.day BETWEEN ? AND ?
       GROUP BY o.first_name, d.day
       ORDER BY o.first_name, d.day`,
    )
    .all(from, to) as DailyAggRow[];

  const byOpMap = new Map<string, { first_name: string; days: DailyPoint[] }>();
  for (const r of byOpRows) {
    let entry = byOpMap.get(r.first_name);
    if (!entry) {
      entry = { first_name: r.first_name, days: [] };
      byOpMap.set(r.first_name, entry);
    }
    entry.days.push(toDaily(r));
  }
  const byOperator = [...byOpMap.values()].map((o) => ({
    first_name: o.first_name,
    days: densifyDays(o.days, from, to),
  }));

  return { range: { from, to }, days, byOperator };
}

/** Flat per-operator-per-day rows for CSV, merged by first name. */
export function dailyFlat(
  db: Database,
  from: string,
  to: string,
  name?: string,
): (DailyPoint & { first_name: string })[] {
  const where = name ? "AND o.first_name = ? COLLATE NOCASE" : "";
  const params = name ? [from, to, name] : [from, to];
  const rows = db
    .query(
      `SELECT o.first_name AS first_name, d.day AS day,
        SUM(d.available_seconds) AS available_seconds, SUM(d.calls_received) AS calls_received,
        SUM(d.calls_answered) AS calls_answered, SUM(d.sum_tta_ms) AS sum_tta_ms,
        SUM(d.cnt_tta) AS cnt_tta, SUM(d.sum_handle_ms) AS sum_handle_ms,
        SUM(d.cnt_handle) AS cnt_handle
       FROM daily_aggregates d JOIN operators o ON o.id = d.operator_id
       WHERE d.day BETWEEN ? AND ? ${where}
       GROUP BY o.first_name, d.day
       ORDER BY o.first_name, d.day`,
    )
    .all(...params) as DailyAggRow[];
  return rows.map((r) => ({ ...toDaily(r), first_name: r.first_name }));
}

export interface IntradaySeries {
  day: string; // = from (kept for older dashboard builds)
  from: string;
  to: string;
  slotMinutes: number;
  labels: string[]; // shared x-axis, e.g. ["09:00","09:15",…]
  operators: { first_name: string; answered: number[]; received: number[] }[];
}

// Per-operator intraday series — calls answered (and received) per slot-of-day, on a
// shared x-axis auto-sized to the first..last slot with any activity. Slots where an
// operator wasn't working are 0, so operators can be compared directly during the
// hours they overlap. Over a MULTI-DAY range the slots are summed across the days
// ("when does each person answer, hour by hour"). Buckets by the process-local
// (Pacific) time of receipt; late-flushed events are excluded (SAME_DAY_RECEIPT).
export function intradayByOperator(
  db: Database,
  from: string,
  to: string,
  slotMin = 30,
): IntradaySeries {
  const rows = db
    .query(
      `SELECT o.first_name AS first_name,
         ${slotExpr(slotMin)} AS slot,
         SUM(CASE WHEN e.type='call_answered' THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN e.type='call_received' THEN 1 ELSE 0 END) AS received
       FROM raw_events e JOIN operators o ON o.id = e.operator_id
       WHERE e.day BETWEEN ? AND ? AND e.type IN ('call_answered','call_received')
         AND ${SAME_DAY_RECEIPT}
       GROUP BY o.first_name, slot`,
    )
    .all(from, to) as { first_name: string; slot: number; answered: number; received: number }[];

  if (rows.length === 0) {
    return { day: from, from, to, slotMinutes: slotMin, labels: [], operators: [] };
  }

  const slots = rows.map((r) => r.slot);
  const first = Math.min(...slots);
  const last = Math.max(...slots);
  const slotList: number[] = [];
  for (let s = first; s <= last; s++) slotList.push(s);
  const labels = slotList.map((s) => slotLabel(s, slotMin));

  const byOp = new Map<string, Map<number, { answered: number; received: number }>>();
  for (const r of rows) {
    let m = byOp.get(r.first_name);
    if (!m) {
      m = new Map();
      byOp.set(r.first_name, m);
    }
    m.set(r.slot, { answered: r.answered, received: r.received });
  }
  const operators = [...byOp.entries()]
    .map(([first_name, m]) => ({
      first_name,
      answered: slotList.map((s) => m.get(s)?.answered ?? 0),
      received: slotList.map((s) => m.get(s)?.received ?? 0),
    }))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));

  return { day: from, from, to, slotMinutes: slotMin, labels, operators };
}

/** Ring timestamps that never got picked up, per operator, for one local day.
 *  Events aren't linked, so rings pair greedily with the operator's next answer
 *  within the TTA cap (oldest ring first); leftover rings are the missed calls —
 *  per day and operator the count matches received − answered. Drives the
 *  timeline's missed-call markers. */
export function missedCallTimes(db: Database, day: string): Map<string, number[]> {
  const TTA_CAP_MS = 600_000; // ingest rejects time_to_answer_ms above this, so an answer can't belong to an older ring
  const rows = db
    .query(
      `SELECT o.first_name AS name, e.type AS type, e.received_at AS at
       FROM raw_events e JOIN operators o ON o.id = e.operator_id
       WHERE e.day = ? AND e.type IN ('call_received','call_answered')
         AND ${SAME_DAY_RECEIPT}
       ORDER BY o.first_name, e.received_at`,
    )
    .all(day) as { name: string; type: string; at: number }[];

  const out = new Map<string, number[]>();
  let cur = "";
  let pending: number[] = [];
  const flush = (name: string) => {
    if (name && pending.length) out.set(name, pending);
    pending = [];
  };

  for (const r of rows) {
    if (r.name !== cur) {
      flush(cur);
      cur = r.name;
    }
    if (r.type === "call_received") {
      pending.push(r.at);
    } else {
      const i = pending.findIndex((t) => r.at >= t && r.at - t <= TTA_CAP_MS);
      if (i >= 0) pending.splice(i, 1);
    }
  }
  flush(cur);

  return out;
}

// Admin erasure (offboarding / data request). Identity is the first name, so this
// wipes EVERY station that person ever used — all operator rows sharing the first
// name, their events + rollups, and the live-board + presence-history rows (which
// also hold the name).
export function deleteOperator(db: Database, firstName: string) {
  const tx = db.transaction(() => {
    const pres = db
      .query("DELETE FROM presence WHERE first_name = ? COLLATE NOCASE")
      .run(firstName);
    db.query("DELETE FROM presence_spans WHERE first_name = ? COLLATE NOCASE").run(firstName);

    const ops = db
      .query("SELECT id FROM operators WHERE first_name = ? COLLATE NOCASE")
      .all(firstName) as { id: number }[];
    for (const { id } of ops) {
      db.query("DELETE FROM raw_events WHERE operator_id = ?").run(id);
      db.query("DELETE FROM daily_aggregates WHERE operator_id = ?").run(id);
      db.query("DELETE FROM operators WHERE id = ?").run(id);
    }
    return { deleted: ops.length || (pres.changes > 0 ? 1 : 0) };
  });
  return tx();
}
