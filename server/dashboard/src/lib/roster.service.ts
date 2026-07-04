// Seeds the operator colour palette from the full roster (GET /v1/operators), once
// per session, so every page assigns the same colour to the same person. The `live`
// role may not read /v1/operators (403 → the http layer would bounce to /login), so
// live-scoped pages pass the presence names as the roster instead.

import { getOperators } from './metrics.client';
import { setRoster } from './palette.service';

let seeded: Promise<void> | null = null;

/** Fetch the full roster and seed the palette. Cached — repeat calls are free.
 *  Never rejects: seeding is best-effort (the hash fallback colours until a later
 *  page load retries a failed fetch). */
export function ensureRoster(): Promise<void> {
	if (!seeded) {
		seeded = getOperators().then(
			(r) => setRoster(r.operators.map((o) => o.first_name)),
			() => {
				seeded = null;
			}
		);
	}
	return seeded;
}
