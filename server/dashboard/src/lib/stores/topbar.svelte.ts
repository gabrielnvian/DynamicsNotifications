// Shared TopBar state. The layout renders a single TopBar as a fixed header OUTSIDE
// the scroll region (so the scrollbar lives only under the navbar); each content page
// supplies its own refresh handler + live "updated" timestamp here via an $effect.
export const topbar = $state<{ onRefresh?: () => void; lastUpdated: number | null }>({
	onRefresh: undefined,
	lastUpdated: null
});
