// Reconstruct ONE past day's presence spans from recorded evidence — prod-safe.
//
//   bun scripts/backfill-day.ts <db-path> <YYYY-MM-DD>       (run in the server's TZ)
//
// Sources (nothing else is invented):
//   • available_tick: the extension's clock credited [received_at − seconds, received_at]
//     of genuine Available time. Totals are exact; PLACEMENT is only as fine as the
//     ~1-minute flush batching, so treat boundaries as ±1 min.
//   • call_ended: the measured call window [received_at − handle_ms, received_at].
//   • call_answered: a zero-length on_call marker (fallback for calls with no ended).
// Same-status windows merge across gaps ≤ PRESENCE_STALE_MS — the identical
// continuation rule the LIVE span recorder uses, so backfilled days are
// methodologically comparable to live ones. AWAY is never reconstructed (it was
// never evented): that time stays a gap. Only same-day-received events are used —
// late flushes can't be placed honestly.
//
// Scope safety: touches ONLY spans overlapping the target local day (idempotent
// re-run); live history on other days is never read or written. Prints a
// per-operator verification table (credited vs reconstructed seconds) — inspect it.
import { openDb } from "../src/db.ts";
import { PRESENCE_STALE_MS } from "../src/presence.ts";

const [dbPath, day] = [process.argv[2], process.argv[3]];
if (!dbPath || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error("usage: bun scripts/backfill-day.ts <db-path> <YYYY-MM-DD>");
  process.exit(1);
}

const [y, m, d] = day.split("-").map(Number);
const dayStart = new Date(y, m - 1, d).getTime();
const dayEnd = new Date(y, m - 1, d + 1).getTime();

const db = openDb(dbPath);

const rows = db
  .query(
    `SELECT o.install_uuid AS install, o.first_name AS name, e.type AS type,
            e.received_at AS at, e.available_seconds AS avail, e.handle_ms AS handle
     FROM raw_events e JOIN operators o ON o.id = e.operator_id
     WHERE e.day = ?
       AND date(e.received_at / 1000, 'unixepoch', 'localtime') = e.day
       AND e.type IN ('available_tick', 'call_ended', 'call_answered')
     ORDER BY o.install_uuid, o.first_name, e.received_at`,
  )
  .all(day) as {
    install: string;
    name: string;
    type: string;
    at: number;
    avail: number | null;
    handle: number | null;
  }[];

interface Win {
  install: string;
  name: string;
  status: string;
  start: number;
  end: number;
}

const windows: Win[] = rows.map((r) =>
  r.type === "available_tick"
    ? { install: r.install, name: r.name, status: "available", start: r.at - (r.avail ?? 0) * 1000, end: r.at }
    : r.type === "call_ended"
      ? { install: r.install, name: r.name, status: "on_call", start: r.at - (r.handle ?? 0), end: r.at }
      : { install: r.install, name: r.name, status: "on_call", start: r.at, end: r.at },
);

// Merge per station+status (live continuation rule), then clip to the day.
windows.sort((a, b) =>
  a.install < b.install ? -1 : a.install > b.install ? 1 : a.status < b.status ? -1 : a.status > b.status ? 1 : a.start - b.start,
);
const spans: Win[] = [];
for (const w of windows) {
  const last = spans[spans.length - 1];
  if (
    last &&
    last.install === w.install &&
    last.name === w.name &&
    last.status === w.status &&
    w.start - last.end <= PRESENCE_STALE_MS
  ) {
    last.end = Math.max(last.end, w.end);
  } else {
    spans.push({ ...w });
  }
}
for (const s of spans) {
  s.start = Math.max(s.start, dayStart);
  s.end = Math.min(s.end, dayEnd);
}
const clipped = spans.filter((s) => s.end >= s.start);

const tx = db.transaction(() => {
  const del = db
    .query("DELETE FROM presence_spans WHERE started_at < ? AND last_beat > ?")
    .run(dayEnd, dayStart);
  const ins = db.query(
    `INSERT INTO presence_spans (install_uuid, first_name, status, started_at, last_beat)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const s of clipped) ins.run(s.install, s.name, s.status, s.start, s.end);
  return del.changes;
});
const replaced = tx();

// ── Verification: reconstructed union vs the exact credited/measured sums ──
function unionSecs(iv: Array<[number, number]>): number {
  if (iv.length === 0) return 0;
  iv.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = iv[0];
  for (const [s, e] of iv.slice(1)) {
    if (s > ce) {
      total += ce - cs;
      [cs, ce] = [s, e];
    } else if (e > ce) ce = e;
  }
  return Math.round((total + ce - cs) / 1000);
}

const names = [...new Set(rows.map((r) => r.name))].sort();
console.log(`${day}: replaced ${replaced} overlapping spans, inserted ${clipped.length}`);
console.log("operator | credited avail s | green span s | delta | measured call s | blue span s");
for (const n of names) {
  const credited = rows
    .filter((r) => r.name === n && r.type === "available_tick")
    .reduce((a, r) => a + (r.avail ?? 0), 0);
  const green = unionSecs(
    clipped.filter((s) => s.name === n && s.status === "available").map((s) => [s.start, s.end]),
  );
  const callMs = rows
    .filter((r) => r.name === n && r.type === "call_ended")
    .reduce((a, r) => a + (r.handle ?? 0), 0);
  const blue = unionSecs(
    clipped.filter((s) => s.name === n && s.status === "on_call").map((s) => [s.start, s.end]),
  );
  const deltaPct = credited > 0 ? (((green - credited) / credited) * 100).toFixed(1) : "0.0";
  console.log(
    `${n} | ${credited} | ${green} | ${deltaPct}% | ${Math.round(callMs / 1000)} | ${blue}`,
  );
}
