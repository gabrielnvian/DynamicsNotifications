// Resolve a range from the URL to an inclusive {from,to}. Presets (today/last7/
// last30/month) resolve against the viewer's real local "today" (or the June-2026
// fixture in mock/dev). A "custom" range carries explicit from/to in the URL query.
// Also: the immediately-preceding equal-length window (for KPI deltas) and labels.

import { USE_MOCK } from './http';
import type { Range, RangeKey } from './metrics.model';
import { rangeFor } from './mock.service';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function ymd(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
		d.getUTCDate()
	).padStart(2, '0')}`;
}
function localYmd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
		d.getDate()
	).padStart(2, '0')}`;
}

function realRange(key: RangeKey): Range {
	const now = new Date();
	const to = localYmd(now);
	if (key === 'today') return { from: to, to };
	if (key === 'last7') {
		const f = new Date(now);
		f.setDate(f.getDate() - 6);
		return { from: localYmd(f), to };
	}
	if (key === 'month') return { from: localYmd(new Date(now.getFullYear(), now.getMonth(), 1)), to };
	const f = new Date(now);
	f.setDate(f.getDate() - 29);
	return { from: localYmd(f), to }; // last30
}

/** Today as an inclusive single-day range (the Today page's fixed window). */
export function todayRange(): Range {
	return USE_MOCK ? rangeFor('today') : realRange('today');
}

/** The range key encoded in the URL — 'custom' only when valid from/to are present.
 *  `dflt` is the page's preset when the URL carries none (Trends defaults to 7 days). */
export function rangeKeyFromUrl(url: URL, dflt: RangeKey = 'today'): RangeKey {
	const k = url.searchParams.get('range');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (k === 'custom' && from && to && DAY_RE.test(from) && DAY_RE.test(to)) return 'custom';
	return k === 'today' || k === 'last7' || k === 'last30' || k === 'month' ? k : dflt;
}

/** Resolve the URL to an inclusive {from,to}. Start-after-end is swapped. */
export function resolveRange(url: URL, dflt: RangeKey = 'today'): Range {
	const key = rangeKeyFromUrl(url, dflt);
	if (key === 'custom') {
		let from = url.searchParams.get('from') as string;
		let to = url.searchParams.get('to') as string;
		if (from > to) [from, to] = [to, from];
		return { from, to };
	}
	return USE_MOCK ? rangeFor(key) : realRange(key);
}

/** Immediately-preceding equal-length window (for period-over-period deltas). */
export function previousWindow(r: Range): Range {
	const from = new Date(`${r.from}T00:00:00Z`);
	const to = new Date(`${r.to}T00:00:00Z`);
	const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
	const pTo = new Date(from);
	pTo.setUTCDate(pTo.getUTCDate() - 1);
	const pFrom = new Date(pTo);
	pFrom.setUTCDate(pFrom.getUTCDate() - (days - 1));
	return { from: ymd(pFrom), to: ymd(pTo) };
}

export function shortDay(day: string): string {
	const [, m, d] = day.split('-').map(Number);
	return `${MONTHS[m - 1]} ${d}`;
}

export function prettyRange(r: Range): string {
	const [fy, fm, fd] = r.from.split('-').map(Number);
	const [ty, tm, td] = r.to.split('-').map(Number);
	if (r.from === r.to) return `${MONTHS[fm - 1]} ${fd}, ${fy}`;
	if (fy === ty) return `${MONTHS[fm - 1]} ${fd} – ${MONTHS[tm - 1]} ${td}, ${ty}`;
	return `${MONTHS[fm - 1]} ${fd}, ${fy} – ${MONTHS[tm - 1]} ${td}, ${ty}`;
}

/** Compact label for the hero / custom button, e.g. "Jun 10–Jun 18" (no year). */
export function prettyRangeShort(r: Range): string {
	const [, fm, fd] = r.from.split('-').map(Number);
	const [, tm, td] = r.to.split('-').map(Number);
	if (r.from === r.to) return `${MONTHS[fm - 1]} ${fd}`;
	return `${MONTHS[fm - 1]} ${fd}–${MONTHS[tm - 1]} ${td}`;
}
