import type { Database } from "bun:sqlite";
import type { Config } from "./config.ts";
import type { Envelope, EventType, RawEvent } from "./types.ts";

// Closed key-sets. The server REJECTS any field outside these — this is the
// server-side half of data-minimisation (the client builds an allowlisted
// payload; the server refuses anything else).
const ENVELOPE_KEYS = new Set([
  "v",
  "install",
  "operator",
  "agent",
  "batchId",
  "sentAt",
  "events",
]);
const EVENT_KEYS: Record<EventType, Set<string>> = {
  available_tick: new Set(["event_id", "type", "day", "available_seconds"]),
  call_received: new Set(["event_id", "type", "day"]),
  call_answered: new Set(["event_id", "type", "day", "time_to_answer_ms"]),
  call_ended: new Set(["event_id", "type", "day", "handle_ms"]),
};
const TYPES = new Set<EventType>([
  "available_tick",
  "call_received",
  "call_answered",
  "call_ended",
]);

const UUID_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// First name: starts with a letter, then letters / space / . ' - only. No
// digits, no @, no control chars. Unicode-aware.
const NAME_RE = /^\p{L}[\p{L} .'\-]*$/u;

export interface ValidationOk {
  ok: true;
  value: Envelope;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

function err(error: string): ValidationErr {
  return { ok: false, error };
}
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isIntInRange(x: unknown, lo: number, hi: number): boolean {
  return typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
}
function validDay(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  return y >= 2000 && y <= 3000 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

export function normalizeFirstName(x: string): string {
  return x.normalize("NFC").trim();
}

// Same first-name rule the ingest envelope enforces, reused by the presence route
// so both paths accept exactly the same set of names.
export function validFirstName(name: string, maxLen: number): boolean {
  return name.length > 0 && name.length <= maxLen && NAME_RE.test(name);
}

export function validateEnvelope(
  body: unknown,
  cfg: Config,
): ValidationOk | ValidationErr {
  if (!isPlainObject(body)) return err("body must be an object");
  for (const k of Object.keys(body)) {
    if (!ENVELOPE_KEYS.has(k)) return err(`unknown field: ${k}`);
  }

  if (typeof body.install !== "string" || !UUID_RE.test(body.install)) {
    return err("invalid install");
  }
  if (typeof body.operator !== "string") {
    return err("operator (first name) must be a string");
  }
  const name = normalizeFirstName(body.operator);
  if (name.length === 0) return err("operator (first name) is empty");
  if (name.length > cfg.firstNameMaxLen) {
    return err("operator (first name) too long");
  }
  if (!NAME_RE.test(name)) {
    return err("operator (first name) has invalid characters");
  }

  if (body.v !== undefined && !isIntInRange(body.v, 0, 1_000_000)) {
    return err("invalid v");
  }
  if (
    body.agent !== undefined &&
    (typeof body.agent !== "string" || body.agent.length > 32)
  ) {
    return err("invalid agent");
  }
  if (
    body.batchId !== undefined &&
    (typeof body.batchId !== "string" || !UUID_RE.test(body.batchId))
  ) {
    return err("invalid batchId");
  }
  if (body.sentAt !== undefined && !isIntInRange(body.sentAt, 0, 9e15)) {
    return err("invalid sentAt");
  }

  if (!Array.isArray(body.events)) return err("events must be an array");
  if (body.events.length === 0) return err("events is empty");
  if (body.events.length > 1000) return err("too many events (max 1000)");
  for (const e of body.events) {
    const bad = validateEvent(e);
    if (bad) return bad;
  }

  return { ok: true, value: body as unknown as Envelope };
}

function validateEvent(e: unknown): ValidationErr | null {
  if (!isPlainObject(e)) return err("event must be an object");
  if (typeof e.type !== "string" || !TYPES.has(e.type as EventType)) {
    return err("unknown event type");
  }
  const type = e.type as EventType;
  const allowed = EVENT_KEYS[type];
  for (const k of Object.keys(e)) {
    if (!allowed.has(k)) return err(`unknown ${type} field: ${k}`);
  }
  if (typeof e.event_id !== "string" || !UUID_RE.test(e.event_id)) {
    return err("invalid event_id");
  }
  if (typeof e.day !== "string" || !DAY_RE.test(e.day) || !validDay(e.day)) {
    return err("invalid day");
  }
  if (type === "available_tick") {
    if (!isIntInRange(e.available_seconds, 1, 86400)) {
      return err("invalid available_seconds");
    }
  } else if (type === "call_answered") {
    if (!isIntInRange(e.time_to_answer_ms, 0, 600000)) {
      return err("invalid time_to_answer_ms");
    }
  } else if (type === "call_ended") {
    if (!isIntInRange(e.handle_ms, 0, 86400000)) {
      return err("invalid handle_ms");
    }
  }
  return null;
}

export interface FoldResult {
  accepted: number;
  duplicates: number;
}

/** Idempotent fold: dedupe each event by event_id, and only on a real insert
 *  apply the additive delta to the daily rollup. Re-sending a batch (lost ACK)
 *  is a safe no-op. Runs in a single transaction. */
export function ingest(db: Database, env: Envelope, now: number): FoldResult {
  const firstName = normalizeFirstName(env.operator);

  const upsertOp = db.query(
    `INSERT INTO operators (install_uuid, first_name, first_seen, last_seen, last_agent)
     VALUES (?1, ?2, ?3, ?3, ?4)
     ON CONFLICT(install_uuid, first_name) DO UPDATE SET last_seen = ?3, last_agent = ?4
     RETURNING id`,
  );
  const insEvent = db.query(
    `INSERT OR IGNORE INTO raw_events
       (event_id, operator_id, day, type, available_seconds, time_to_answer_ms, handle_ms, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upAgg = db.query(
    `INSERT INTO daily_aggregates
       (operator_id, day, available_seconds, calls_received, calls_answered,
        sum_tta_ms, cnt_tta, sum_handle_ms, cnt_handle, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(operator_id, day) DO UPDATE SET
       available_seconds = available_seconds + ?3,
       calls_received    = calls_received + ?4,
       calls_answered    = calls_answered + ?5,
       sum_tta_ms        = sum_tta_ms + ?6,
       cnt_tta           = cnt_tta + ?7,
       sum_handle_ms     = sum_handle_ms + ?8,
       cnt_handle        = cnt_handle + ?9,
       updated_at        = ?10`,
  );

  let accepted = 0;
  let duplicates = 0;

  const tx = db.transaction(() => {
    const row = upsertOp.get(env.install, firstName, now, env.agent ?? null) as { id: number };
    const opId = row.id;
    for (const e of env.events as RawEvent[]) {
      const r = insEvent.run(
        e.event_id,
        opId,
        e.day,
        e.type,
        e.available_seconds ?? null,
        e.time_to_answer_ms ?? null,
        e.handle_ms ?? null,
        now,
      );
      if (r.changes === 0) {
        duplicates++;
        continue;
      }
      accepted++;
      const av = e.type === "available_tick" ? (e.available_seconds ?? 0) : 0;
      const cr = e.type === "call_received" ? 1 : 0;
      const ca = e.type === "call_answered" ? 1 : 0;
      const tta = e.type === "call_answered" ? (e.time_to_answer_ms ?? 0) : 0;
      const ttaC = e.type === "call_answered" ? 1 : 0;
      const h = e.type === "call_ended" ? (e.handle_ms ?? 0) : 0;
      const hC = e.type === "call_ended" ? 1 : 0;
      upAgg.run(opId, e.day, av, cr, ca, tta, ttaC, h, hC, now);
    }
  });
  tx();

  return { accepted, duplicates };
}
