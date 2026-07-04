// Client-side view of the authenticated role. The server signs the role into the
// session cookie and exposes it at GET /v1/whoami; the layout loads it once to decide
// nav + routing. Enforcement is server-side (live → 403 on every non-presence route) —
// this only shapes the UI so a `live` user isn't bounced through 403 → /login.
import { USE_MOCK } from '$lib/http';

export type Role = 'full' | 'live';

export const session = $state<{ role: Role | null }>({ role: null });

/** Fetch the current role (mock dev = full). Sets the store and returns it. */
export async function loadRole(): Promise<Role | null> {
	if (USE_MOCK) {
		session.role = 'full';
		return 'full';
	}
	try {
		const res = await fetch('/v1/whoami', { headers: { Accept: 'application/json' } });
		if (!res.ok) {
			session.role = null;
			return null;
		}
		const j = await res.json();
		const role: Role = j?.role === 'live' ? 'live' : 'full';
		session.role = role;
		return role;
	} catch {
		session.role = null;
		return null;
	}
}
