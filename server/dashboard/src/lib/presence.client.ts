// Live presence board endpoint (GET /v1/presence). Polled by the /live view.

import { getJson, USE_MOCK } from './http';
import { mockOnlineSummary, mockPresence, mockPresenceTimeline } from './mock.service';
import type {
	OnlineSummaryResponse,
	PresenceResponse,
	PresenceTimelineResponse
} from './presence.model';

export function getPresence(): Promise<PresenceResponse> {
	if (USE_MOCK) return Promise.resolve(mockPresence());
	return getJson<PresenceResponse>('/v1/presence');
}

/** Exact per-operator status spans for one day (the status timeline). */
export function getPresenceTimeline(day: string): Promise<PresenceTimelineResponse> {
	if (USE_MOCK) return Promise.resolve(mockPresenceTimeline(day));
	return getJson<PresenceTimelineResponse>(`/v1/presence/timeline?day=${day}`);
}

/** Online time (any status) per day + per operator over [from, to]. */
export function getOnlineSummary(
	from: string,
	to: string,
	operator?: string
): Promise<OnlineSummaryResponse> {
	if (USE_MOCK) return Promise.resolve(mockOnlineSummary(from, to, operator));
	const q = new URLSearchParams({ from, to });
	if (operator) q.set('operator', operator);
	return getJson<OnlineSummaryResponse>(`/v1/presence/online?${q.toString()}`);
}
