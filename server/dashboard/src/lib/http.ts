// Same-origin fetch layer (design brief §3, §4). Requests are same-origin, so no
// base URL and no CORS. The Bun server gates /v1/* data endpoints behind a session
// cookie (set by the /login form); a 401/403 means the session is missing/expired,
// so we route to /login. Flip USE_MOCK on for offline dev.

import { goto } from '$app/navigation';

const env = (import.meta as any).env ?? {};
export const USE_MOCK: boolean =
	env.VITE_USE_MOCK === 'true' || (env.VITE_USE_MOCK == null && !!env.DEV);

export class AuthError extends Error {
	status: number;
	constructor(status: number) {
		super(`Authentication failed (HTTP ${status})`);
		this.name = 'AuthError';
		this.status = status;
	}
}
export class ApiError extends Error {
	status: number;
	constructor(status: number) {
		super(`Request failed (HTTP ${status})`);
		this.name = 'ApiError';
		this.status = status;
	}
}

export async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { headers: { Accept: 'application/json' } });
	if (res.status === 401 || res.status === 403) {
		// Session missing/expired → send them to the login page (unless already there).
		if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
			goto('/login');
		}
		throw new AuthError(res.status);
	}
	if (!res.ok) throw new ApiError(res.status);
	return (await res.json()) as T;
}
