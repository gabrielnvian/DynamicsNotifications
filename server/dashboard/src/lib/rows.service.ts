// Derive the table view-models from the API responses (design brief §6). All the
// "computed client-side" fields live here so the Overview, detail, and table
// components share one source of truth: not_answered, unanswered_rate, the day
// label/weekday, and the below-target flag.

import { capitalizeName } from './format.formatter';
import type { DailyRow, DayPoint, OperatorRow, OperatorSummary } from './metrics.model';

// One row per operator. Identity is the first name (stats are already merged by first
// name server-side), so first names are unique in this list — no disambiguation needed.
// `onlineByName` (any-status presence seconds) is optional: history only exists from
// the day the presence log shipped, so older ranges have none → null → "—".
export function toOperatorRows(
	ops: OperatorSummary[],
	answerTarget: number,
	onlineByName?: Map<string, number>
): OperatorRow[] {
	return ops.map((o) => {
		const not_answered = Math.max(0, o.calls_received - o.calls_answered);
		return {
			...o,
			name: capitalizeName(o.first_name),
			not_answered,
			unanswered_rate: o.calls_received ? not_answered / o.calls_received : null,
			online_seconds: onlineByName?.get(o.first_name) ?? null,
			belowTarget: o.answer_rate != null && o.answer_rate < answerTarget
		};
	});
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Label-only date parsing: build the date in UTC and read it back in UTC so the
// weekday/label never shift by timezone (brief §8 — treat `day` as a label).
function dayMeta(day: string): { dayLabel: string; weekday: string; weekend: boolean } {
	const [y, m, d] = day.split('-').map(Number);
	const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return { dayLabel: `${MONTHS[m - 1]} ${d}`, weekday: WEEKDAYS[wd], weekend: wd === 0 || wd === 6 };
}

export function toDailyRows(days: DayPoint[], answerTarget: number): DailyRow[] {
	return days.map((d) => {
		const not_answered = Math.max(0, d.calls_received - d.calls_answered);
		const answer_rate = d.calls_received ? d.calls_answered / d.calls_received : null;
		const active_seconds =
			d.available_seconds + Math.round(((d.avg_handle_ms ?? 0) * d.handle_sample) / 1000);
		return {
			...d,
			...dayMeta(d.day),
			active_seconds,
			not_answered,
			answer_rate,
			belowTarget: answer_rate != null && answer_rate < answerTarget
		};
	});
}
