// Centralised formatting helpers (design brief §5 & §8).
// Reuse everywhere; never format durations/percentages inline. `—` for nulls.

/** Integer with thousands separators, e.g. 1420 -> "1,420". */
export function fmtInt(n: number | null | undefined): string {
	return Number(n ?? 0).toLocaleString('en-US');
}

/** available_seconds -> "Hh Mm", e.g. 23520 -> "6h 32m". Drops the hours part when 0. */
export function fmtHoursMinutes(sec: number): string {
	// Round to whole minutes FIRST, then split — rounding the remainder on its own
	// yields "1h 60m" at 3595s+.
	const totalMin = Math.round(sec / 60);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** available_seconds -> decimal hours string, e.g. 23520 -> "6.5h" (charts/labels). */
export function fmtHoursDecimal(sec: number): string {
	return `${(sec / 3600).toFixed(1)}h`;
}

/** answer_rate (0..1|null) -> "89.5%" (1 dp); "—" when null (received === 0). */
export function fmtAnswerRate(rate: number | null | undefined): string {
	return rate == null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

/** avg_time_to_answer_ms -> seconds, 1 dp, e.g. 4300 -> "4.3s"; "—" when null. */
export function fmtTimeToAnswer(ms: number | null | undefined): string {
	return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

/** avg_handle_ms -> "Mm Ss" (SS zero-padded), e.g. 262000 -> "4m 22s"; "—" when null.
 *  Label this "handle time (incl. wrap-up)" — never "talk time". */
export function fmtHandle(ms: number | null | undefined): string {
	if (ms == null) return '—';
	// Round to whole seconds FIRST, then split (see fmtHoursMinutes — avoids "1m 60s").
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Percentage from a 0..1 fraction, 1 dp, e.g. 0.404 -> "40.4%"; "—" when null. */
export function fmtPercent(frac: number | null | undefined): string {
	return frac == null ? '—' : `${(frac * 100).toFixed(1)}%`;
}

/** Display name from a raw lowercase first_name, e.g. "gabriel" -> "Gabriel". */
export function capitalizeName(first: string): string {
	return first ? first.charAt(0).toUpperCase() + first.slice(1) : first;
}

/** "7am", "1:15pm" — minutes only when nonzero, 0/12 map to 12am/12pm. */
function ampm(h: number, m: number): string {
	const suffix = h < 12 ? 'am' : 'pm';
	const hh = h % 12 === 0 ? 12 : h % 12;
	return m ? `${hh}:${String(m).padStart(2, '0')}${suffix}` : `${hh}${suffix}`;
}

/** Slot label "07:00" (+step) -> "7am – 8am"; "13:15" (+15) -> "1:15pm – 1:30pm".
 *  The row covers the whole bucket, so a range reads less ambiguously than a bare
 *  start time. Non-slot labels pass through unchanged. */
export function fmtSlotRange(label: string, stepMin = 60): string {
	const m = label.match(/^(\d{2}):(\d{2})$/);
	if (!m) return label;
	const start = Number(m[1]) * 60 + Number(m[2]);
	const end = (start + stepMin) % 1440;
	return `${ampm(Math.floor(start / 60), start % 60)} – ${ampm(Math.floor(end / 60), end % 60)}`;
}
