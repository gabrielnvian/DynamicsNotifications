// Historical metrics endpoints (design brief §6). Same-origin GET, JSON.
// CSV exports return links the browser downloads directly (server sets
// Content-Disposition: attachment) — do NOT build the CSV client-side.

import { getJson, USE_MOCK } from './http';
import type {
	IntradayResponse,
	MetricsResponse,
	OperatorsResponse,
	SummaryResponse
} from './metrics.model';
import { mockIntraday, mockMetrics, mockOperators, mockSummary } from './mock.service';

export function getOperators(): Promise<OperatorsResponse> {
	if (USE_MOCK) return Promise.resolve(mockOperators());
	return getJson<OperatorsResponse>('/v1/operators');
}

/** Per-operator totals + team roll-up over [from, to]. */
export function getSummary(from: string, to: string): Promise<SummaryResponse> {
	if (USE_MOCK) return Promise.resolve(mockSummary(from, to));
	return getJson<SummaryResponse>(`/v1/metrics/summary?from=${from}&to=${to}`);
}

/** Daily series. Omit operator for team days + byOperator breakdown;
 *  pass an operator's first name for that one operator's merged days.
 *  `slotMin` (15/30/60) sets the bucket size of single-day intraday rows. */
export function getMetrics(
	from: string,
	to: string,
	operator?: string,
	slotMin?: number
): Promise<MetricsResponse> {
	if (USE_MOCK) return Promise.resolve(mockMetrics(from, to, operator));
	const q = new URLSearchParams({ from, to });
	if (operator) q.set('operator', operator);
	if (slotMin) q.set('slot', String(slotMin));
	return getJson<MetricsResponse>(`/v1/metrics?${q.toString()}`);
}

/** Per-operator slot-of-day series (the operator heatmap). Single day, or summed
 *  across a multi-day range. */
export function getIntraday(from: string, to: string, slotMin: number): Promise<IntradayResponse> {
	if (USE_MOCK) return Promise.resolve(mockIntraday(from, to, slotMin));
	return getJson<IntradayResponse>(`/v1/metrics/intraday?from=${from}&to=${to}&slot=${slotMin}`);
}

export function summaryCsvUrl(from: string, to: string): string {
	return `/v1/export/summary.csv?from=${from}&to=${to}`;
}
export function dailyCsvUrl(from: string, to: string, operator?: string): string {
	const q = new URLSearchParams({ from, to });
	if (operator) q.set('operator', operator);
	return `/v1/export/daily.csv?${q.toString()}`;
}
