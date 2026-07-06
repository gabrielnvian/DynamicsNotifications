// Wire types for the ingest API. These define the ONLY fields the server will
// accept. Anything outside this shape is rejected (see ingest.ts) so the data
// footprint stays minimal: the sole identity fields are `install` (an anonymous
// random UUID) and `operator` (the operator's FIRST NAME — the only PII).

export type EventType =
  | "available_tick"
  | "call_received"
  | "call_answered"
  | "call_ended";

export interface RawEvent {
  event_id: string; // client-generated UUID; idempotent dedupe key
  type: EventType;
  day: string; // YYYY-MM-DD in the operator's LOCAL timezone
  available_seconds?: number; // available_tick only (1..86400)
  time_to_answer_ms?: number; // call_answered only (0..600000)
  handle_ms?: number; // call_ended only (0..86400000)
}

export interface Envelope {
  v?: number; // schema version
  install: string; // anonymous install UUID
  operator: string; // operator FIRST NAME (only PII)
  agent?: string; // extension version
  batchId?: string;
  sentAt?: number; // epoch ms
  events: RawEvent[];
}

// ── Read models returned by the dashboard endpoints ────────────────────────

export interface OperatorSummary {
  first_name: string; // the dashboard identity — stats are merged by first name
  available_seconds: number; // time in the Available state only (NOT on a call)
  active_seconds: number; // available + talk time — the operator's productive shift

  calls_received: number;
  calls_answered: number;
  answer_rate: number | null; // answered / received (0..1); null when received === 0
  avg_time_to_answer_ms: number | null;
  avg_handle_ms: number | null;
  handle_sample: number; // # of calls avg_handle_ms was computed over
}

export interface DailyPoint {
  day: string;
  label?: string; // intraday hour label ("09:00") for single-day views; absent → use `day`
  available_seconds: number;
  // available + talk, computed server-side from the exact handle sums — clients must
  // NOT reconstruct it from avg_handle_ms × handle_sample (rounding drifts ±1s).
  active_seconds: number;
  calls_received: number;
  calls_answered: number;
  avg_time_to_answer_ms: number | null;
  avg_handle_ms: number | null;
  handle_sample: number;
  // Single-day TEAM slots only: seconds of this slot with ZERO operators in the
  // "available" status while anyone was on shift — callers then go straight to
  // voicemail without ringing, invisible to the call counters. Absent on multi-day
  // and per-operator series, and 0 on days before presence history exists.
  uncovered_seconds?: number;
}
