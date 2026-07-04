// Live operator presence board (GET /v1/presence). Current status only; "offline"
// is derived server-side from heartbeat staleness (see server/src/presence.ts).

export type LiveStatus = 'available' | 'on_call' | 'away' | 'offline';

export interface LiveOperator {
	first_name: string; // the operator identity (merged across shared stations)
	status: LiveStatus;
	last_seen_ms: number;
	last_online_ms: number; // last time available/on-call (i.e. taking calls); 0 if never
}

export interface PresenceResponse {
	now: number;
	stale_after_ms: number;
	operators: LiveOperator[];
}

// GET /v1/presence/timeline?day=… — exact status timeline for one server-local day:
// per-operator spans (status + start/end epoch ms, clipped to the day). Gaps between
// spans are offline/no-signal time.
export type SpanStatus = Exclude<LiveStatus, 'offline'>;

export interface PresenceSpan {
	status: SpanStatus;
	start_ms: number;
	end_ms: number;
}

export interface PresenceTimelineResponse {
	day: string;
	start_ms: number; // local-midnight bounds of the day
	end_ms: number;
	operators: {
		first_name: string;
		online_seconds: number;
		spans: PresenceSpan[];
		missed_ms: number[]; // ring timestamps that never got picked up
	}[];
}

// GET /v1/presence/online?from=…&to=… — online time (any-status heartbeat) rolled up
// per day and per operator; person-seconds, comparable 1:1 with active_seconds.
export interface OnlineSummaryResponse {
	range: { from: string; to: string };
	days: { day: string; online_seconds: number }[];
	operators: { first_name: string; online_seconds: number }[];
}
