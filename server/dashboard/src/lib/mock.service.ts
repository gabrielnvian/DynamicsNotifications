// Deterministic mock data for offline dev (behind USE_MOCK in http.ts).
// 8 station-installs × June 2026 (30 days). Includes two installs named "gabriel"
// (distinct uuid) to exercise the merge-by-first-name rule — they collapse into ONE
// "gabriel" in every public response, exactly like production.
//
// Rollups use answered-/sample-weighted means (mirroring the server's exact
// pre-computed averages) so range aggregation behaves like production —
// i.e. request the range you need; do NOT average the averages.

import type {
	DayPoint,
	IntradayResponse,
	MetricsResponse,
	OperatorsResponse,
	SummaryResponse,
	TeamSummary
} from './metrics.model';
import type {
	LiveStatus,
	OnlineSummaryResponse,
	PresenceResponse,
	PresenceSpan,
	PresenceTimelineResponse,
	SpanStatus
} from './presence.model';

interface Profile {
	uuid: string;
	first: string;
	b: number;
	ar: number;
	t: number;
	h: number;
	av: number;
	weekendWork: number;
	partTime?: boolean;
}

interface OpDay extends DayPoint {}
// One raw station-install (pre-merge).
interface Operator {
	uuid: string;
	first: string;
	days: OpDay[];
}
// Merged-by-first-name view — the shape the public mock API returns.
interface MergedOp {
	first: string;
	name: string;
	days: DayPoint[];
}

const PROFILES: Profile[] = [
	{ uuid: '3f2a9c1b', first: 'gabriel', b: 30, ar: 0.93, t: 3800, h: 250000, av: 6.4, weekendWork: 0.15 },
	{ uuid: '7d4e2266', first: 'maria', b: 26, ar: 0.83, t: 6100, h: 300000, av: 6.0, weekendWork: 0.2 },
	{ uuid: 'b19c07af', first: 'sam', b: 18, ar: 0.6, t: 9200, h: 340000, av: 4.6, weekendWork: 0.1 },
	{ uuid: 'a8f34d10', first: 'gabriel', b: 22, ar: 0.88, t: 4800, h: 272000, av: 5.8, weekendWork: 0.12 },
	{ uuid: 'c5e91b73', first: 'aisha', b: 34, ar: 0.95, t: 3400, h: 240000, av: 6.8, weekendWork: 0.25 },
	{ uuid: '02af6d94', first: 'tom', b: 24, ar: 0.8, t: 6800, h: 310000, av: 5.7, weekendWork: 0.18 },
	{ uuid: 'e77b3c58', first: 'priya', b: 40, ar: 0.91, t: 3000, h: 232000, av: 7.0, weekendWork: 0.3 },
	{ uuid: '4a0d9f21', first: 'lena', b: 14, ar: 0.86, t: 5200, h: 280000, av: 3.2, weekendWork: 0.05, partTime: true }
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface DateMeta {
	key: string;
	label: string;
	weekday: number;
	weekend: boolean;
}

let CACHE: { dates: DateMeta[]; operators: Operator[]; teamDays: DayPoint[] } | null = null;

function build() {
	if (CACHE) return CACHE;
	const dates: DateMeta[] = [];
	for (let d = 1; d <= 30; d++) {
		const wd = new Date(Date.UTC(2026, 5, d)).getUTCDay();
		dates.push({
			key: `2026-06-${pad2(d)}`,
			label: `${MONTHS[5]} ${d}`,
			weekday: wd,
			weekend: wd === 0 || wd === 6
		});
	}

	const operators: Operator[] = PROFILES.map((p) => {
		const days: OpDay[] = dates.map((dt, idx) => {
			const r = rng((hash(p.uuid) ^ (idx * 2654435761)) >>> 0);
			let working = true;
			if (dt.weekend) working = r() < p.weekendWork;
			else if (p.partTime) working = [2, 3, 4].includes(dt.weekday) ? r() < 0.9 : r() < 0.35;
			if (!working) {
				return {
					day: dt.key,
					available_seconds: 0,
					active_seconds: 0,
					calls_received: 0,
					calls_answered: 0,
					avg_time_to_answer_ms: null,
					avg_handle_ms: null,
					handle_sample: 0
				};
			}
			const factor = dt.weekend ? 0.42 : 0.88 + r() * 0.24;
			const available = Math.round(p.av * 3600 * factor);
			const received = Math.max(0, Math.round(p.b * factor * (0.85 + r() * 0.3)));
			const ar = Math.min(0.99, Math.max(0.3, p.ar + (r() - 0.5) * 0.12));
			const answered = Math.min(received, Math.round(received * ar));
			const tta = received ? Math.round(p.t * (0.8 + r() * 0.5)) : null;
			const handle = answered ? Math.round(p.h * (0.85 + r() * 0.35)) : null;
			const sample = answered ? Math.min(answered, Math.round(answered * (0.8 + r() * 0.16))) : 0;
			return {
				day: dt.key,
				available_seconds: available,
				active_seconds: available + Math.round(((handle ?? 0) * sample) / 1000),
				calls_received: received,
				calls_answered: answered,
				avg_time_to_answer_ms: tta,
				avg_handle_ms: handle,
				handle_sample: sample
			};
		});
		return { uuid: p.uuid, first: p.first, days };
	});

	const teamDays: DayPoint[] = dates
		.map((_, idx) => aggregate(operators.map((o) => o.days[idx])))
		.map((agg, idx) => ({ day: dates[idx].key, ...stripDay(agg) }));

	CACHE = { dates, operators, teamDays };
	return CACHE;
}

// Merge the raw station-installs into one operator per first name (element-wise per
// day), mirroring the server's GROUP BY first_name.
let MERGED: MergedOp[] | null = null;
function mergedOperators(): MergedOp[] {
	if (MERGED) return MERGED;
	const { operators, dates } = build();
	const groups = new Map<string, Operator[]>();
	for (const o of operators) {
		const g = groups.get(o.first);
		if (g) g.push(o);
		else groups.set(o.first, [o]);
	}
	MERGED = [...groups.entries()]
		.map(([first, members]) => ({
			first,
			name: first.charAt(0).toUpperCase() + first.slice(1),
			days: dates.map((dt, idx) => ({
				day: dt.key,
				...stripDay(aggregate(members.map((m) => m.days[idx])))
			}))
		}))
		.sort((a, b) => a.first.localeCompare(b.first));
	return MERGED;
}

interface Agg {
	available_seconds: number;
	active_seconds: number;
	calls_received: number;
	calls_answered: number;
	answer_rate: number | null;
	avg_time_to_answer_ms: number | null;
	avg_handle_ms: number | null;
	handle_sample: number;
}

function aggregate(days: DayPoint[]): Agg {
	let avail = 0,
		act = 0,
		recv = 0,
		ans = 0,
		tN = 0,
		tD = 0,
		hN = 0,
		hD = 0,
		samp = 0;
	for (const d of days) {
		avail += d.available_seconds;
		act += d.active_seconds;
		recv += d.calls_received;
		ans += d.calls_answered;
		samp += d.handle_sample;
		if (d.avg_time_to_answer_ms != null && d.calls_answered > 0) {
			tN += d.avg_time_to_answer_ms * d.calls_answered;
			tD += d.calls_answered;
		}
		if (d.avg_handle_ms != null && d.handle_sample > 0) {
			hN += d.avg_handle_ms * d.handle_sample;
			hD += d.handle_sample;
		}
	}
	return {
		available_seconds: avail,
		active_seconds: act,
		calls_received: recv,
		calls_answered: ans,
		answer_rate: recv ? ans / recv : null,
		avg_time_to_answer_ms: tD ? Math.round(tN / tD) : null,
		avg_handle_ms: hD ? Math.round(hN / hD) : null,
		handle_sample: samp
	};
}
function stripDay(a: Agg): Omit<DayPoint, 'day'> {
	return {
		available_seconds: a.available_seconds,
		active_seconds: a.active_seconds,
		calls_received: a.calls_received,
		calls_answered: a.calls_answered,
		avg_time_to_answer_ms: a.avg_time_to_answer_ms,
		avg_handle_ms: a.avg_handle_ms,
		handle_sample: a.handle_sample
	};
}

function inRange(dayKey: string, from: string, to: string): boolean {
	return dayKey >= from && dayKey <= to; // YYYY-MM-DD sorts lexicographically
}

// ---- Public mock API (shapes match metrics.model.ts) ----

export function mockOperators(): OperatorsResponse {
	const { dates } = build();
	const last = dates[dates.length - 1].key;
	return {
		operators: mergedOperators().map((o) => ({ first_name: o.first, last_seen: last }))
	};
}

export function mockSummary(from: string, to: string): SummaryResponse {
	const ops = mergedOperators().map((o) => {
		const a = aggregate(o.days.filter((d) => inRange(d.day, from, to)));
		return { first_name: o.first, ...a };
	});
	const { teamDays } = build();
	const teamAgg = aggregate(teamDays.filter((d) => inRange(d.day, from, to)));
	const team: TeamSummary = { operator_count: ops.length, ...teamAgg };
	return { range: { from, to }, operators: ops, team };
}

export function mockMetrics(from: string, to: string, operator?: string): MetricsResponse {
	const merged = mergedOperators();
	if (operator) {
		const op = merged.find((o) => o.first === operator);
		const days = (op ? op.days : []).filter((d) => inRange(d.day, from, to));
		return { range: { from, to }, days };
	}
	const { teamDays } = build();
	return {
		range: { from, to },
		days: teamDays.filter((d) => inRange(d.day, from, to)),
		byOperator: merged.map((o) => ({
			first_name: o.first,
			days: o.days.filter((d) => inRange(d.day, from, to))
		}))
	};
}

// Fixed reference "now" so the mock board is deterministic across reloads.
const MOCK_NOW = 1_780_000_000_000;
const MOCK_CYCLE: LiveStatus[] = ['available', 'on_call', 'available', 'away', 'available', 'on_call', 'available', 'offline'];

export function mockPresence(): PresenceResponse {
	const merged = mergedOperators();
	return {
		now: MOCK_NOW,
		stale_after_ms: 90_000,
		operators: merged.map((o, i) => {
			const status = MOCK_CYCLE[i % MOCK_CYCLE.length];
			// offline rows read as long-stale; live rows as a few seconds old.
			const last_seen_ms = status === 'offline' ? MOCK_NOW - 8 * 60_000 : MOCK_NOW - (3_000 + i * 900);
			const online = status === 'available' || status === 'on_call';
			const last_online_ms = online ? last_seen_ms : MOCK_NOW - (12 + i * 3) * 60_000;
			return { first_name: o.first, status, last_seen_ms, last_online_ms };
		})
	};
}

// Status timeline: continuous spans per operator — a shift of alternating
// available/on-call/away stretches with a few silent holes, drawn to the minute.
export function mockPresenceTimeline(day: string): PresenceTimelineResponse {
	const merged = mergedOperators();
	const [y, m, d] = day.split('-').map(Number);
	const dayStart = new Date(y, m - 1, d).getTime();
	const dayEnd = new Date(y, m - 1, d + 1).getTime();
	const MIN = 60_000;

	const operators = merged.map((o) => {
		const r = rng(hash('tl' + o.first + day));
		let t = dayStart + (7 * 60 + 30 + Math.floor(r() * 120)) * MIN; // starts 07:30–09:30
		const shiftEnd = t + (6 * 60 + Math.floor(r() * 150)) * MIN; // 6–8.5h later
		const spans: PresenceSpan[] = [];
		const missed_ms: number[] = [];
		let online = 0;
		while (t < shiftEnd) {
			const len = (7 + Math.floor(r() * 35)) * MIN; // 7–42 min stretches
			const end = Math.min(t + len, shiftEnd, dayEnd);
			const roll = r();
			if (roll < 0.14) {
				// silent hole — locked / closed; no span. Rings still land here sometimes.
				if (r() < 0.35) missed_ms.push(t + Math.floor(((end - t) / MIN) * r()) * MIN);
			} else {
				const status: SpanStatus = roll < 0.42 ? 'on_call' : roll < 0.54 ? 'away' : 'available';
				spans.push({ status, start_ms: t, end_ms: end });
				online += end - t;
				if (status === 'away' && r() < 0.5) {
					missed_ms.push(t + Math.floor(((end - t) / MIN) * r()) * MIN);
				}
			}
			t = end + Math.floor(r() * 3) * MIN;
		}
		return { first_name: o.first, online_seconds: Math.round(online / 1000), spans, missed_ms };
	});
	operators.sort(
		(a, b) => b.online_seconds - a.online_seconds || a.first_name.localeCompare(b.first_name)
	);
	return { day, start_ms: dayStart, end_ms: dayEnd, operators };
}

// Online-time rollup, derived from mockPresenceTimeline per day so the timeline,
// the band chart, and the table column all agree.
export function mockOnlineSummary(from: string, to: string, operator?: string): OnlineSummaryResponse {
	const { dates } = build();
	const inWindow = dates.filter((d) => inRange(d.key, from, to));

	const perOp = new Map<string, number>();
	const days: { day: string; online_seconds: number }[] = [];
	for (const d of inWindow) {
		const tl = mockPresenceTimeline(d.key);
		let daySecs = 0;
		for (const o of tl.operators) {
			if (operator && o.first_name !== operator) continue;
			daySecs += o.online_seconds;
			perOp.set(o.first_name, (perOp.get(o.first_name) ?? 0) + o.online_seconds);
		}
		days.push({ day: d.key, online_seconds: daySecs });
	}

	const operators = [...perOp.entries()]
		.map(([first_name, online_seconds]) => ({ first_name, online_seconds }))
		.sort((a, b) => a.first_name.localeCompare(b.first_name));
	return { range: { from, to }, days, operators };
}

// Per-operator "calls answered" slot-of-day series — each operator works a slightly
// different window (so some sit at 0 at the edges, like the real data). Multi-day
// ranges scale the counts up as if summed across the days.
export function mockIntraday(from: string, to: string, slotMin: number): IntradayResponse {
	const merged = mergedOperators();
	const perHour = 60 / slotMin;
	const startSlot = 9 * perHour; // 09:00
	const endSlot = 17 * perHour - 1; // …16:xx
	const labels: string[] = [];
	for (let s = startSlot; s <= endSlot; s++) {
		const min = s * slotMin;
		labels.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
	}
	const dayCount = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1);
	const operators = merged.map((o) => {
		const r = rng(hash(o.first + from + to + slotMin));
		const wStart = startSlot + Math.floor(r() * 2 * perHour); // starts up to ~2h later
		const wEnd = endSlot - Math.floor(r() * 2 * perHour);
		const answered = labels.map((_, i) => {
			const s = startSlot + i;
			if (s < wStart || s > wEnd) return 0;
			// ~0–2 calls per 15 min, scaled by slot size and (for ranges) day count.
			return Math.round(r() * 2 * (slotMin / 15) * (dayCount * 0.6));
		});
		const received = answered.map((a) => a + (r() < 0.35 ? 1 : 0));
		return { first_name: o.first, answered, received };
	});
	return { day: from, from, to, slotMinutes: slotMin, labels, operators };
}

// Helper for the date-range presets (all resolve within June 2026 in mock).
export function rangeFor(key: 'today' | 'last7' | 'last30' | 'month'): { from: string; to: string } {
	const { dates } = build();
	const last = dates[dates.length - 1].key;
	if (key === 'today') return { from: last, to: last };
	if (key === 'last7') return { from: dates[dates.length - 7].key, to: last };
	if (key === 'month') return { from: dates[0].key, to: last };
	return { from: dates[0].key, to: last }; // last30
}
