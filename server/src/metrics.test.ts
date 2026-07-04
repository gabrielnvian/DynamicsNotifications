import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { ingest, validateEnvelope } from "./ingest.ts";
import { daily, dailyFlat, summary } from "./metrics.ts";
import type { Database } from "bun:sqlite";

const cfg = loadConfig({});

function feed(db: Database, operator: string, events: Record<string, unknown>[], at = 1000): void {
  const v = validateEnvelope(
    { install: "aaaaaaaa-1111-2222-3333-444444444444", operator, events },
    cfg,
  );
  expect(v.ok).toBe(true);
  if (v.ok) ingest(db, v.value, at);
}

test("team equals the sum of per-operator values, including rounded active_seconds", () => {
  const db = openDb(":memory:");
  // 1500ms handle each: per-operator active rounds to 2s; the team's RAW sum
  // (3000ms → 3s) would disagree — the team must sum the per-operator values.
  feed(db, "Ada", [
    { event_id: "aaaa0001", type: "available_tick", day: "2026-06-01", available_seconds: 100 },
    { event_id: "aaaa0002", type: "call_ended", day: "2026-06-01", handle_ms: 1500 },
  ]);
  feed(db, "Bea", [
    { event_id: "bbbb0001", type: "available_tick", day: "2026-06-01", available_seconds: 200 },
    { event_id: "bbbb0002", type: "call_ended", day: "2026-06-01", handle_ms: 1500 },
  ]);

  const s = summary(db, "2026-06-01", "2026-06-01");
  const sums = s.operators.reduce(
    (a, o) => ({
      active: a.active + o.active_seconds,
      available: a.available + o.available_seconds,
      received: a.received + o.calls_received,
      answered: a.answered + o.calls_answered,
    }),
    { active: 0, available: 0, received: 0, answered: 0 },
  );
  expect(s.operators.map((o) => o.active_seconds)).toEqual([102, 202]);
  expect(s.team.active_seconds).toBe(sums.active); // 304, not round(300.3)=300+3
  expect(s.team.available_seconds).toBe(sums.available);
  expect(s.team.calls_received).toBe(sums.received);
  expect(s.team.calls_answered).toBe(sums.answered);
  db.close();
});

test("range averages are event-weighted, never average-of-day-averages", () => {
  const db = openDb(":memory:");
  // Day 1: one answer at 1000ms. Day 2: three answers at 5000ms each.
  // Event-weighted range avg = 16000/4 = 4000; average-of-averages would be 3000.
  feed(db, "Ada", [
    { event_id: "cccc0001", type: "call_answered", day: "2026-06-01", time_to_answer_ms: 1000 },
    { event_id: "cccc0002", type: "call_answered", day: "2026-06-02", time_to_answer_ms: 5000 },
    { event_id: "cccc0003", type: "call_answered", day: "2026-06-02", time_to_answer_ms: 5000 },
    { event_id: "cccc0004", type: "call_answered", day: "2026-06-02", time_to_answer_ms: 5000 },
  ]);

  const s = summary(db, "2026-06-01", "2026-06-02");
  expect(s.operators[0].avg_time_to_answer_ms).toBe(4000);
  expect(s.team.avg_time_to_answer_ms).toBe(4000);
  db.close();
});

test("daily points carry server-computed active_seconds (clients must not reconstruct)", () => {
  const db = openDb(":memory:");
  feed(db, "Ada", [
    { event_id: "dddd0001", type: "available_tick", day: "2026-06-01", available_seconds: 60 },
    { event_id: "dddd0002", type: "call_ended", day: "2026-06-01", handle_ms: 90_500 },
  ]);

  const d = daily(db, "2026-06-01", "2026-06-02");
  expect(d.days[0].active_seconds).toBe(60 + 91); // 90.5s rounds once, server-side
  expect(d.days[1].active_seconds).toBe(0); // densified zero-day
  expect(d.byOperator[0].days[0].active_seconds).toBe(151);
  db.close();
});

test("?operator= matching is case-insensitive (hand-typed URLs, API consumers)", () => {
  const db = openDb(":memory:");
  // Receipt time on the event's own local day, or the single-day (intraday) path
  // would drop it via the same-day-receipt filter before case matching even runs.
  feed(
    db,
    "Dana",
    [{ event_id: "eeee0001", type: "call_received", day: "2026-06-01" }],
    new Date(2026, 5, 1, 10).getTime(),
  );

  expect(daily(db, "2026-06-01", "2026-06-01", "dana").days.length).toBeGreaterThan(0);
  expect(dailyFlat(db, "2026-06-01", "2026-06-01", "DANA").length).toBe(1);
  db.close();
});
