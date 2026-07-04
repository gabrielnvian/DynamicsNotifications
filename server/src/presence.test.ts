import { expect, test } from "bun:test";
import { openDb } from "./db.ts";
import { deleteOperator } from "./metrics.ts";
import {
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
