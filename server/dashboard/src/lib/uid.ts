// Per-instance unique ids for SVG gradient <defs> (two charts on a page must not
// share a gradient id). Client-only SPA, so a simple incrementing counter is safe.
let n = 0;
export function uid(prefix: string): string {
	return `${prefix}-${++n}`;
}
