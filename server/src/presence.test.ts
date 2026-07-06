import { expect, test } from "bun:test";
import { openDb } from "./db.ts";
import { deleteOperator } from "./metrics.ts";
import {
  dayCoverage,
  gapSecondsBySlot,
  listPresence,
  onlineSummary,
  PRESENCE_STALE_MS,
  presenceTimeline,
  recordPresence,
} from "./presence.ts";

const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";

test("presence upserts (latest wins) and derives offline from staleness", () => {
  const db = openDb(":memory:");

  recordPresence(db, A, "Gabriel", "available", 100_000);
  recordPresence(db, A, "Gabriel", "on_call", 200_000); // same operator → overwrite
  recordPresence(db, B, "Sam", "available", 100_000);

  const now = 200_000 + PRESENCE_STALE_MS - 1; // Gabriel fresh, Sam long stale
  const board = listPresence(db, now);
  const gabriel = board.operators.find((o) => o.first_name === "Gabriel");
  const sam = board.operators.find((o) => o.first_name === "Sam");

  expect(gabriel?.status).toBe("on_call");
  expect(gabriel?.last_seen_ms).toBe(200_000);
  expect(sam?.status).toBe("offline");
  db.close();
});

test("last_online_ms marks the last time taking calls (available/on_call), not away", () => {
  const db = openDb(":memory:");
  recordPresence(db, A, "Gabriel", "available", 100_000);
  recordPresence(db, A, "Gabriel", "away", 200_000); // away does NOT bump last_online

  const g1 = listPresence(db, 200_000).operators.find((o) => o.first_name === "Gabriel");
  expect(g1?.last_online_ms).toBe(100_000);

  recordPresence(db, A, "Gabriel", "on_call", 300_000); // on_call IS online → bumps
  const g2 = listPresence(db, 300_000).operators.find((o) => o.first_name === "Gabriel");
  expect(g2?.last_online_ms).toBe(300_000);
  db.close();
});

test("deleteOperator also erases the presence row (PII must not survive erasure)", () => {
  const db = openDb(":memory:");
  recordPresence(db, A, "Gabriel", "available", 100_000);
  expect(listPresence(db, 100_000).operators.length).toBe(1);

  const res = deleteOperator(db, "Gabriel");
  expect(res.deleted).toBe(1); // presence-only operator still counts as erased
  expect(listPresence(db, 100_000).operators.length).toBe(0);
  db.close();
});

test("explicit offline beat is accepted and shown immediately (not stale-derived)", () => {
  const db = openDb(":memory:");
  recordPresence(db, A, "Gabriel", "available", 100_000);
  // Last Dynamics tab closed → the extension sends an explicit "offline" beat.
  recordPresence(db, A, "Gabriel", "offline", 200_000);
  const g = listPresence(db, 200_000).operators.find((o) => o.first_name === "Gabriel");
  expect(g?.status).toBe("offline"); // fresh, so it's the reported status, not derived
  expect(g?.last_online_ms).toBe(100_000); // offline never bumps last-online
  db.close();
});

test("heartbeats build exact status spans; silence breaks them; offline writes nothing", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number, s = 0) => new Date(2026, 5, 15, h, m, s).getTime();
  // Available 10:00–10:01 (two beats extend one span), status change to on_call at
  // 10:02, then SILENCE past the stale window — the next available beat at 10:30
  // must open a NEW span, not bridge the gap. An offline beat writes nothing.
  recordPresence(db, A, "Gabriel", "available", at(10, 0));
  recordPresence(db, A, "Gabriel", "available", at(10, 1));
  recordPresence(db, A, "Gabriel", "on_call", at(10, 2));
  recordPresence(db, A, "Gabriel", "available", at(10, 30));
  recordPresence(db, A, "Gabriel", "available", at(10, 31));
  recordPresence(db, A, "Gabriel", "offline", at(10, 32));

  const t = presenceTimeline(db, "2026-06-15");
  const g = t.operators.find((o) => o.first_name === "Gabriel");
  expect(g?.spans.map((s) => [s.status, s.start_ms, s.end_ms])).toEqual([
    ["available", at(10, 0), at(10, 1)],
    ["on_call", at(10, 2), at(10, 2)],
    ["available", at(10, 30), at(10, 31)],
  ]);
  expect(g?.online_seconds).toBe(120); // 60 + 0 + 60 — the silent gap is NOT credited

  deleteOperator(db, "Gabriel");
  expect(presenceTimeline(db, "2026-06-15").operators.length).toBe(0); // erased
  db.close();
});

test("timeline flattens overlapping spans — one status per instant, on_call wins", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();
  // Available 13:00–13:17 with an on_call span 13:16–13:20 overlapping its tail
  // (the backfill's merged tick windows produce exactly this shape). The timeline
  // must show available UNTIL 13:16, then on_call — never both at once.
  db.query(
    `INSERT INTO presence_spans (install_uuid, first_name, status, started_at, last_beat)
     VALUES (?, 'Zach', 'available', ?, ?), (?, 'Zach', 'on_call', ?, ?)`,
  ).run(A, at(13, 0), at(13, 17), A, at(13, 16), at(13, 20));

  const g = presenceTimeline(db, "2026-06-15").operators.find((o) => o.first_name === "Zach");
  expect(g?.spans).toEqual([
    { status: "available", start_ms: at(13, 0), end_ms: at(13, 16) },
    { status: "on_call", start_ms: at(13, 16), end_ms: at(13, 20) },
  ]);
  expect(g?.online_seconds).toBe(20 * 60);
  db.close();
});

test("onlineSummary unions spans into person-seconds; two stations never double-count", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();
  // Gabriel on TWO stations with overlapping availability 10:00–10:01 / 10:00–10:02 —
  // union is 2 min, not 3. Sam on a call 11:00–11:05. Away still counts as online.
  recordPresence(db, A, "Gabriel", "available", at(10, 0));
  recordPresence(db, A, "Gabriel", "available", at(10, 1));
  // (beats must be ≤ the stale window apart to form one span: 10:01 → 10:02 is 60s)
  recordPresence(db, B, "Gabriel", "away", at(10, 1));
  recordPresence(db, B, "Gabriel", "away", at(10, 2));
  const C = "cccccccc-1111-2222-3333-444444444444";
  recordPresence(db, C, "Sam", "on_call", at(11, 0));
  recordPresence(db, C, "Sam", "on_call", at(11, 1));

  const o = onlineSummary(db, "2026-06-15", "2026-06-15");
  expect(o.days).toEqual([{ day: "2026-06-15", online_seconds: 180 }]); // 120 + 60
  expect(o.operators).toEqual([
    { first_name: "Gabriel", online_seconds: 120 },
    { first_name: "Sam", online_seconds: 60 },
  ]);

  expect(onlineSummary(db, "2026-06-15", "2026-06-15", "Sam").days[0].online_seconds).toBe(60);
  db.close();
});

test("presence merges shared-station sessions into one row per first name", () => {
  const db = openDb(":memory:");
  // Same person (Gabriel) signed in on two stations; a third stale station.
  const C = "cccccccc-1111-2222-3333-444444444444";
  recordPresence(db, A, "Gabriel", "away", 300_000); // station A: away, fresh
  recordPresence(db, B, "Gabriel", "on_call", 300_000); // station B: on a call, fresh
  recordPresence(db, C, "Gabriel", "available", 100_000); // station C: stale → offline

  const board = listPresence(db, 300_000 + PRESENCE_STALE_MS - 1);
  const gabriels = board.operators.filter((o) => o.first_name === "Gabriel");
  expect(gabriels.length).toBe(1); // merged
  // Most-present signal wins: on_call beats away beats (stale) offline.
  expect(gabriels[0]?.status).toBe("on_call");
  expect(gabriels[0]?.last_seen_ms).toBe(300_000);
  db.close();
});

// Coverage tests write spans directly (like scripts/backfill-day.ts) — building an
// arbitrary-length span from ≤75s heartbeats would take hundreds of recordPresence
// calls for no extra fidelity.
function span(
  db: ReturnType<typeof openDb>,
  install: string,
  name: string,
  status: string,
  startMs: number,
  endMs: number,
): void {
  db.query(
    `INSERT INTO presence_spans (install_uuid, first_name, status, started_at, last_beat)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(install, name, status, startMs, endMs);
}

test("dayCoverage: gaps are the zero-available windows inside the staffed window", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();
  // Gabriel: available 9:00–9:30, away 9:30–10:30, available 10:30–11:00.
  // Sam covers part of Gabriel's away stretch: available 9:45–9:50.
  span(db, A, "Gabriel", "available", at(9, 0), at(9, 30));
  span(db, A, "Gabriel", "away", at(9, 30), at(10, 30));
  span(db, A, "Gabriel", "available", at(10, 30), at(11, 0));
  span(db, B, "Sam", "available", at(9, 45), at(9, 50));

  const c = dayCoverage(db, "2026-06-15");
  expect(c.staffed_start_ms).toBe(at(9, 0));
  expect(c.staffed_end_ms).toBe(at(11, 0));
  expect(c.gaps).toEqual([
    { start_ms: at(9, 30), end_ms: at(9, 45) },
    { start_ms: at(9, 50), end_ms: at(10, 30) },
  ]);
  expect(c.uncovered_seconds).toBe(15 * 60 + 40 * 60);
  db.close();
});

test("dayCoverage: leading/trailing non-available time counts; an empty day is null", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();
  // On shift (away = signed in, e.g. Dynamics "Busy") before and after the only
  // available stretch — both edges are gaps: callers reached voicemail while
  // someone was at a desk.
  span(db, A, "Gabriel", "away", at(8, 0), at(8, 30));
  span(db, A, "Gabriel", "available", at(8, 30), at(9, 0));
  span(db, A, "Gabriel", "on_call", at(9, 0), at(9, 20));

  const c = dayCoverage(db, "2026-06-15");
  expect(c.gaps).toEqual([
    { start_ms: at(8, 0), end_ms: at(8, 30) },
    { start_ms: at(9, 0), end_ms: at(9, 20) },
  ]);
  expect(c.uncovered_seconds).toBe(50 * 60);

  expect(dayCoverage(db, "2026-06-14")).toEqual({
    staffed_start_ms: null,
    staffed_end_ms: null,
    uncovered_seconds: 0,
    gaps: [],
  });
  db.close();
});

test("gapSecondsBySlot splits gaps on wall-clock slot boundaries", () => {
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();

  // 13:02–13:31 stays in hour-slot 13; 13:50–14:10 splits 600/600 across 13 and 14.
  const hourly = gapSecondsBySlot(
    [
      { start_ms: at(13, 2), end_ms: at(13, 31) },
      { start_ms: at(13, 50), end_ms: at(14, 10) },
    ],
    60,
  );
  expect(hourly.get(13)).toBe(29 * 60 + 10 * 60);
  expect(hourly.get(14)).toBe(10 * 60);

  // Same gap in 30-min slots: 13:50–14:00 → slot 27, 14:00–14:10 → slot 28.
  const half = gapSecondsBySlot([{ start_ms: at(13, 50), end_ms: at(14, 10) }], 30);
  expect(half.get(27)).toBe(600);
  expect(half.get(28)).toBe(600);
});

test("dayCoverage drops sub-minute holes (status-flip beat jitter, not real gaps)", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number, s = 0) => new Date(2026, 5, 15, h, m, s).getTime();
  // available → (20s hole from the beat cadence) → on_call 10 min → available.
  // The 20s hole is measurement noise; the 10-min on_call stretch is the real gap.
  span(db, A, "Gabriel", "available", at(9, 0), at(9, 30));
  span(db, A, "Gabriel", "on_call", at(9, 30, 20), at(9, 40, 20));
  span(db, A, "Gabriel", "available", at(9, 40, 40), at(10, 0));

  const c = dayCoverage(db, "2026-06-15");
  expect(c.gaps).toEqual([{ start_ms: at(9, 30), end_ms: at(9, 40, 40) }]);
  expect(c.uncovered_seconds).toBe(640);
  db.close();
});

test("dayCoverage: a second station saying 'available' mid-call does not count as covered", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number) => new Date(2026, 5, 15, h, m).getTime();
  // Gabriel's station A reports available all hour, but station B shows him on a
  // call 9:20–9:40 — per person the most-present status wins, so that stretch is
  // NOT coverage (he can't take another call) and nobody else is available.
  span(db, A, "Gabriel", "available", at(9, 0), at(10, 0));
  span(db, B, "Gabriel", "on_call", at(9, 20), at(9, 40));

  const c = dayCoverage(db, "2026-06-15");
  expect(c.gaps).toEqual([{ start_ms: at(9, 20), end_ms: at(9, 40) }]);
  expect(c.uncovered_seconds).toBe(1200);
  db.close();
});
