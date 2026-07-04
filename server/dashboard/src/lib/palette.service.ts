// Operator qualitative palette (app.css --op-1..8): stable series identity,
// non-judgmental. Slots are assigned by ROSTER ORDER — the full known-operator list,
// sorted alphabetically — so a given operator keeps the same colour in every view and
// every range, and distinct operators never collide while the roster fits the 8 slots.
// (The previous hash-by-name scheme collided almost surely with a 7-person roster, and
// per-chart index assignment gave the same person different colours across components.)
//
// Pages seed the roster once via roster.service (or setRoster directly). Names not in
// the seeded roster — or any name before seeding — fall back to a deterministic FNV
// hash so nothing renders unstyled; the fallback may collide, the roster path cannot.

const PALETTE = ['--op-1', '--op-2', '--op-3', '--op-4', '--op-5', '--op-6', '--op-7', '--op-8'];

let slots = new Map<string, string>();

/** Assign slots alphabetically over the full roster. Rosters past 8 wrap (collisions
 *  return only when the team outgrows the palette). */
export function setRoster(names: string[]): void {
	const sorted = [...new Set(names)].sort();
	slots = new Map(sorted.map((n, i) => [n, `var(${PALETTE[i % PALETTE.length]})`]));
}

function hashKey(s: string): number {
	let h = 2166136261; // FNV-1a
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function colorFor(key: string): string {
	return slots.get(key) ?? `var(${PALETTE[hashKey(key) % PALETTE.length]})`;
}
