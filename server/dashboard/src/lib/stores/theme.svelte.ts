// Theme store: 'light' | 'dark', applied as data-theme on <html>, persisted to
// localStorage 'cc_theme'. Svelte 5 runes module — read `theme.value` in markup.

export type Theme = 'light' | 'dark';

const KEY = 'cc_theme';

// v2: dark is the default — only an explicit stored 'light' opts out.
function initial(): Theme {
	if (typeof localStorage === 'undefined') return 'dark';
	return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
}

let current = $state<Theme>(initial());

function persist(): void {
	if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', current);
	if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, current);
}

export const theme = {
	get value(): Theme {
		return current;
	},
	toggle(): void {
		current = current === 'dark' ? 'light' : 'dark';
		persist();
	},
	/** Re-apply the persisted theme to <html> on first mount. */
	init(): void {
		persist();
	}
};
