import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { ingest, validateEnvelope } from "./ingest.ts";
import {
  daily,
  deleteOperator,
  intradayByOperator,
  listOperators,
  missedCallTimes,
  summary,
} from "./metrics.ts";

const cfg = loadConfig({});
const INSTALL = "aaaaaaaa-1111-2222-3333-444444444444";

function envelope(overrides: Record<string, unknown> = {}) {
  return { install: INSTALL, operator: "Gabriel", events: [], ...overrides };
}

test("rejects an unknown envelope field (data minimisation)", () => {
  const r = validateEnvelope(
    {
      ...envelope({
        events: [{ event_id: "e1aaaaaa", type: "call_received", day: "2026-06-01" }],
      }),
      caller: "Bob",
    },
    cfg,
  );
  expect(r.ok).toBe(false);
});

test("rejects an unknown event field (e.g. a caller name leaking in)", () => {
  const r = validateEnvelope(
    envelope({
      events: [
        { event_id: "e1aaaaaa", type: "call_received", day: "2026-06-01", callerName: "Bob" },
      ],
    }),
    cfg,
  );
  expect(r.ok).toBe(false);
});

test("rejects a first name that is not a plain name", () => {
  const base = { events: [{ event_id: "e1aaaaaa", type: "call_received", day: "2026-06-01" }] };
  expect(validateEnvelope(envelope({ ...base, operator: "Gabriel123" }), cfg).ok).toBe(false);
  expect(validateEnvelope(envelope({ ...base, operator: "a@b.com" }), cfg).ok).toBe(false);
  expect(validateEnvelope(envelope({ ...base, operator: "Jean-Pierre" }), cfg).ok).toBe(true);
});

test("fold, idempotency, and exact averages", () => {
  const db = openDb(":memory:");
  const e = envelope({
    events: [
      { event_id: "11111111-a", type: "available_tick", day: "2026-06-01", available_seconds: 3600 },
      { event_id: "22222222-a", type: "call_received", day: "2026-06-01" },
      { event_id: "33333333-a", type: "call_answered", day: "2026-06-01", time_to_answer_ms: 4000 },
      { event_id: "44444444-a", type: "call_ended", day: "2026-06-01", handle_ms: 120000 },
    ],
  });
  const v = validateEnvelope(e, cfg);
  expect(v.ok).toBe(true);
  if (!v.ok) return;

  const r1 = ingest(db, v.value, 1000);
  expect(r1).toEqual({ accepted: 4, duplicates: 0 });

  // Re-sending the same batch is a safe no-op (idempotent on event_id).
  const r2 = ingest(db, v.value, 2000);
  expect(r2).toEqual({ accepted: 0, duplicates: 4 });

  const s = summary(db, "2026-06-01", "2026-06-30");
  expect(s.operators.length).toBe(1);
  const op = s.operators[0];
  expect(op.first_name).toBe("Gabriel");
  expect(op.available_seconds).toBe(3600);
  expect(op.calls_received).toBe(1);
  expect(op.calls_answered).toBe(1);
  expect(op.answer_rate).toBe(1);
  expect(op.avg_time_to_answer_ms).toBe(4000);
  expect(op.avg_handle_ms).toBe(120000);
  expect(op.handle_sample).toBe(1);

  // Day series are densified: every calendar day of the range is present, with the
  // idle days zero-filled (counts 0, averages null) so charts never skip time.
  const d = daily(db, "2026-06-01", "2026-06-30");
  expect(d.days.length).toBe(30);
  expect(d.days[0].calls_received).toBe(1);
  expect(d.days[1]).toEqual({
    day: "2026-06-02",
    available_seconds: 0,
    active_seconds: 0,
    calls_received: 0,
    calls_answered: 0,
    avg_time_to_answer_ms: null,
    avg_handle_ms: null,
    handle_sample: 0,
  });
  expect(d.byOperator.length).toBe(1);
  expect(d.byOperator[0].days.length).toBe(30);
  expect(d.byOperator[0].days[0].calls_received).toBe(1);

  const del = deleteOperator(db, "Gabriel");
  expect(del).toEqual({ deleted: 1 });
  expect(summary(db, "2026-06-01", "2026-06-30").operators.length).toBe(0);
  db.close();
});

test("listOperators surfaces the extension version (agent) per operator", () => {
  const db = openDb(":memory:");
  const e = envelope({
    agent: "1.9",
    events: [{ event_id: "aa11bb22-c", type: "call_received", day: "2026-06-01" }],
  });
  const v = validateEnvelope(e, cfg);
  expect(v.ok).toBe(true);
  if (!v.ok) return;
  ingest(db, v.value, 1000);
  const op = (listOperators(db).operators as { first_name: string; agents: string }[])[0];
  expect(op.first_name).toBe("Gabriel");
  expect(op.agents).toBe("1.9");
  db.close();
});

test("single-day range returns hourly buckets with hour labels", () => {
  const db = openDb(":memory:");
  const e = envelope({
    events: [
      { event_id: "ab000011-a", type: "call_received", day: "2026-06-15" },
      { event_id: "ab000022-a", type: "call_answered", day: "2026-06-15", time_to_answer_ms: 3000 },
    ],
  });
  const v = validateEnvelope(e, cfg);
  expect(v.ok).toBe(true);
  if (!v.ok) return;
  ingest(db, v.value, Date.UTC(2026, 5, 15, 10, 0, 0));

  const d = daily(db, "2026-06-15", "2026-06-15");
  // Single-day view is HOURLY, auto-sized to the hours with activity — one call in one
  // hour → exactly one bucket, labelled "HH:00".
  expect(d.days.length).toBe(1);
  expect(d.days[0].label).toMatch(/^\d{2}:00$/);
  expect(d.days[0].calls_received).toBe(1);
  expect(d.days[0].calls_answered).toBe(1);
  db.close();
});

test("intradayByOperator returns per-operator half-hour series on a shared axis", () => {
  const db = openDb(":memory:");
  const eA = {
    install: INSTALL,
    operator: "Lucas",
    events: [{ event_id: "cc000011-a", type: "call_answered", day: "2026-06-15", time_to_answer_ms: 2000 }],
  };
  const eB = {
    install: "bbbbbbbb-1111-2222-3333-444444444444",
    operator: "Zach",
    events: [{ event_id: "cc000022-a", type: "call_answered", day: "2026-06-15", time_to_answer_ms: 2000 }],
  };
  const vA = validateEnvelope(eA, cfg);
  const vB = validateEnvelope(eB, cfg);
  expect(vA.ok && vB.ok).toBe(true);
  if (!vA.ok || !vB.ok) return;
  ingest(db, vA.value, Date.UTC(2026, 5, 15, 17, 10, 0));
  ingest(db, vB.value, Date.UTC(2026, 5, 15, 18, 40, 0));

  const r = intradayByOperator(db, "2026-06-15", "2026-06-15");
  expect(r.slotMinutes).toBe(30);
  expect(r.operators.map((o) => o.first_name)).toEqual(["Lucas", "Zach"]); // sorted
  // Shared x-axis: every operator's series is the same length as labels, 0 where idle.
  for (const o of r.operators) {
    expect(o.answered.length).toBe(r.labels.length);
    expect(o.answered.reduce((s, x) => s + x, 0)).toBe(1);
  }
  expect(r.labels.every((l) => /^\d{2}:(00|30)$/.test(l))).toBe(true);
  db.close();
});

test("late-flushed events stay in daily totals but out of the hourly buckets", () => {
  const db = openDb(":memory:");
  // Queued offline and flushed the NEXT day: the receipt hour says nothing about when
  // the call happened, so intraday charts must exclude it — daily totals keep it.
  const e = envelope({
    events: [{ event_id: "dd000011-a", type: "call_received", day: "2026-06-15" }],
  });
  const v = validateEnvelope(e, cfg);
  expect(v.ok).toBe(true);
  if (!v.ok) return;
  ingest(db, v.value, Date.UTC(2026, 5, 16, 9, 0, 0)); // received Jun 16, day = Jun 15

  expect(summary(db, "2026-06-15", "2026-06-15").team.calls_received).toBe(1);
  expect(daily(db, "2026-06-15", "2026-06-15").days.length).toBe(0); // hourly: excluded
  expect(intradayByOperator(db, "2026-06-15", "2026-06-15").operators.length).toBe(0);
  db.close();
});

test("missedCallTimes pairs rings with the next answer; leftovers are the misses", () => {
  const db = openDb(":memory:");
  const at = (h: number, m: number, s = 0) => new Date(2026, 5, 15, h, m, s).getTime();
  const ins = db.query(
    `INSERT INTO operators (install_uuid, first_name, first_seen, last_seen) VALUES (?, ?, 0, 0)`,
  );
  ins.run(INSTALL, "Luna");
  const ev = db.query(
    `INSERT INTO raw_events (event_id, operator_id, day, type, received_at) VALUES (?, 1, '2026-06-15', ?, ?)`,
  );
  ev.run("m1", "call_received", at(10, 0)); // answered 20s later
  ev.run("m2", "call_answered", at(10, 0, 20));
  ev.run("m3", "call_received", at(10, 5)); // never answered → missed
  ev.run("m4", "call_received", at(11, 0)); // ring, then a second ring, one answer
  ev.run("m5", "call_received", at(11, 0, 30));
  ev.run("m6", "call_answered", at(11, 1)); // pairs with the OLDEST ring (11:00)

  const missed = missedCallTimes(db, "2026-06-15");
  expect(missed.get("Luna")).toEqual([at(10, 5), at(11, 0, 30)]);
  db.close();
});

test("answer_rate is null when no calls were received", () => {
  const db = openDb(":memory:");
  // An operator with availability but zero calls: answer_rate is undefined, not 0%
  // — the dashboard renders it as "—" and never flags it below the answer target.
  const e = envelope({
    operator: "Sam",
    events: [
      { event_id: "aaaa1111-b", type: "available_tick", day: "2026-06-02", available_seconds: 1800 },
    ],
  });
  const v = validateEnvelope(e, cfg);
  expect(v.ok).toBe(true);
  if (!v.ok) return;

  ingest(db, v.value, 1000);

  const s = summary(db, "2026-06-01", "2026-06-30");
  const op = s.operators.find((o) => o.first_name === "Sam");
  expect(op?.calls_received).toBe(0);
  expect(op?.answer_rate).toBeNull();
  expect(s.team.answer_rate).toBeNull();
  db.close();
});
