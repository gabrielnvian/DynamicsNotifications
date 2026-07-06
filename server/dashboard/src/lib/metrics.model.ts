// Call Metrics dashboard — API + view-model types (design brief §6).
// All same-origin GET, JSON. `from`/`to` are inclusive YYYY-MM-DD.

export type RangeKey = 'today' | 'last7' | 'last30' | 'month' | 'custom';

export interface Range {
	from: string; // YYYY-MM-DD
	to: string; // YYYY-MM-DD
}

// GET /v1/operators
export interface OperatorRef {
	first_name: string; // the operator identity — stats are merged by first name
	last_seen: string; // YYYY-MM-DD
}
export interface OperatorsResponse {
	operators: OperatorRef[];
}

// Per-operator totals over a range (GET /v1/metrics/summary)
export interface OperatorSummary {
	first_name: string; // the operator identity (merged across shared stations)
	available_seconds: number; // Available state only (excludes on-call time)
	active_seconds: number; // available + talk time — productive shift

	calls_received: number;
	calls_answered: number;
	answer_rate: number | null; // answered / received; null when received === 0
	avg_time_to_answer_ms: number | null;
	avg_handle_ms: number | null; // talk time: answer → hang-up (wrap-up counts as available)
	handle_sample: number; // n the handle avg was measured on (may be < answered)
}

export interface TeamSummary {
	operator_count: number;
	available_seconds: number;
	active_seconds: number;
	calls_received: number;
	calls_answered: number;
	answer_rate: number | null;
	avg_time_to_answer_ms: number | null;
	avg_handle_ms: number | null;
	handle_sample: number;
}

export interface SummaryResponse {
	range: Range;
	operators: OperatorSummary[];
	team: TeamSummary;
}

// One calendar day of metrics (operator-local; treat `day` as a label, no TZ math)
export interface DayPoint {
	day: string; // YYYY-MM-DD
	label?: string; // intraday hour label ("09:00") for single-day views; absent → use `day`
	available_seconds: number;
	// available + talk, computed server-side from exact handle sums — never reconstruct
	// it client-side from avg_handle_ms × handle_sample (rounding drifts ±1s).
	active_seconds: number;
	calls_received: number;
	calls_answered: number;
	avg_time_to_answer_ms: number | null;
	avg_handle_ms: number | null;
	handle_sample: number;
	// Single-day TEAM slots only: seconds of this slot when NO operator was available
	// while anyone was on shift (callers → voicemail, unseen by the call counters).
	// Absent on multi-day / per-operator series and on older server builds.
	uncovered_seconds?: number;
}

// GET /v1/metrics — without operator: team `days` + per-operator `byOperator`.
// With operator (first name): `days` is that operator's merged series, `byOperator` omitted.
export interface MetricsResponse {
	range: Range;
	days: DayPoint[];
	byOperator?: Array<{
		first_name: string;
		days: DayPoint[];
	}>;
}

// GET /v1/metrics/intraday?from=…&to=…&slot=… — per-operator slot-of-day series (the
// operator heatmap). Single day, or summed across a multi-day range. Shared x-axis
// (`labels`); each operator's arrays align. `from`/`to` echo the served range so the
// client can detect an older server that ignored them (it omits both).
export interface IntradayResponse {
	day: string; // = from (older server builds send only this)
	from?: string;
	to?: string;
	slotMinutes: number;
	labels: string[];
	operators: { first_name: string; answered: number[]; received: number[] }[];
}

// ---- Derived view-model used by the tables (computed in the client) ----
export interface OperatorRow extends OperatorSummary {
	name: string; // capitalizeName(first_name)
	not_answered: number; // calls_received - calls_answered
	unanswered_rate: number | null; // not_answered / calls_received
	online_seconds: number | null; // any-status presence time; null before history exists
	belowTarget: boolean; // answer_rate != null && answer_rate < answerTarget
}

export interface DailyRow extends DayPoint {
	dayLabel: string; // e.g. "Jun 1"
	weekday: string; // e.g. "Mon"
	weekend: boolean;
	not_answered: number;
	answer_rate: number | null;
	belowTarget: boolean;
}
