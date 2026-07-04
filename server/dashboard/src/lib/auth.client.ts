// Dashboard login / logout. The server sets/clears an HttpOnly session cookie
// (see server/src/session.ts); the browser holds it — nothing is stored in JS.
import type { Role } from '$lib/stores/session.svelte';

/** Returns the authenticated role on success, or null on bad credentials. */
export async function login(user: string, password: string): Promise<Role | null> {
	const res = await fetch('/v1/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ user, pass: password })
	});
	if (!res.ok) return null;
	const j = await res.json().catch(() => ({}));
	return j?.role === 'live' ? 'live' : 'full';
}

export async function logout(): Promise<void> {
	// Best-effort: clearing the server cookie is nice-to-have; routing to /login is
	// what signs the user out of the UI, and the cookie also expires on its own.
	try {
		await fetch('/v1/logout', { method: 'POST' });
	} catch {
		/* ignore transport errors — logout still proceeds client-side */
	}
}
