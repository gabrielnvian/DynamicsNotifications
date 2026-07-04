// One-time backfill: synthesize presence_spans from raw_events, so presence history
// exists for days recorded BEFORE the heartbeat span log shipped. Approximate by
// nature: available-tick windows become 'available' spans, answered-call windows
// (call_ended minus handle_ms) become 'on_call' spans; windows of the same status
// merge when they touch or sit within the staleness window. AWAY CANNOT BE RECOVERED
// — there are no events for it, so that time stays a gap (reads as no signal).
// Run with the server's TZ so days split on the same local midnight as live ingest:
//   TZ=America/Los_Angeles bun scripts/backfill-presence.ts ./data-dev/metrics-snap.db
import { openDb } from "../src/db.ts";
import { PRESENCE_STALE_MS } from "../src/presence.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun scripts/backfill-presence.ts <db-path>");
  process.exit(1);
}

const db = openDb(path);

const rows = db
  .query(
    `SELECT o.install_uuid AS install, o.first_name AS name, e.type AS type,
            e.received_at AS at, e.available_seconds AS avail, e.handle_ms AS handle
     FROM raw_events e JOIN operators o ON o.id = e.operator_id
     ORDER BY o.install_uuid, o.first_name, e.received_at`,
  )
  .all() as {
    install: string;
    name: string;
    type: string;
    at: number;
    avail: number | null;
    handle: number | null;
  }[];

interface Window {
  install: string;
  name: string;
  status: string;
  start: number;
  end: number;
}

const windows: Window[] = [];
for (const r of rows) {
  if (r.type === "available_tick") {
    windows.push({ install: r.install, name: r.name, status: "available", start: r.at - (r.avail ?? 0) * 1000, end: r.at });
  } else if (r.type === "call_ended") {
    windows.push({ install: r.install, name: r.name, status: "on_call", start: r.at - (r.handle ?? 0), end: r.at });
  } else if (r.type === "call_answered") {
    windows.push({ install: r.install, name: r.name, status: "on_call", start: r.at, end: r.at });
  } else if (r.type === "call_received") {
    windows.push({ install: r.install, name: r.name, status: "available", start: r.at, end: r.at });
  }
}

// Merge same-status windows per station that touch or sit within the stale window —
// the same continuation rule live heartbeats get in recordSpan.
windows.sort((a, b) =>
  a.install < b.install ? -1 : a.install > b.install ? 1 : a.status < b.status ? -1 : a.status > b.status ? 1 : a.start - b.start,
);
const spans: Window[] = [];
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

const ins = db.query(
  `INSERT INTO presence_spans (install_uuid, first_name, status, started_at, last_beat)
   VALUES (?, ?, ?, ?, ?)`,
);
const tx = db.transaction(() => {
  db.query("DELETE FROM presence_spans").run(); // idempotent re-run on a dev snapshot
  for (const s of spans) ins.run(s.install, s.name, s.status, s.start, s.end);
});
tx();

console.log(`backfilled ${spans.length} spans from ${rows.length} events`);
