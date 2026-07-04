<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import TopBar from '$lib/components/TopBar.svelte';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { session, loadRole } from '$lib/stores/session.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { topbar } from '$lib/stores/topbar.svelte';

	let { children } = $props();

	const path = $derived($page.url.pathname);
	const isLogin = $derived(path.startsWith('/login'));
	// Routes an operator-status-only (`live`) account is allowed to render.
	const liveAllowed = $derived(path.startsWith('/live') || isLogin);

	// Apply the persisted theme to <html> once mounted (SPA — client only).
	onMount(() => theme.init());

	// Resolve the role once, then reveal the app. Login page needs no role.
	let ready = $state(false);
	onMount(() => {
		if (isLogin) {
			ready = true;
			return;
		}
		loadRole().finally(() => (ready = true));
	});

	// A `live` account can only see the operator-status board — send it there.
	$effect(() => {
		if (ready && session.role === 'live' && !liveAllowed) goto('/live');
	});
	const blocked = $derived(session.role === 'live' && !liveAllowed);

	// The navbar shows on the data pages, not the login screen.
	const showBar = $derived(!isLogin);
</script>

<div class="app" data-density={prefs.density}>
	{#if showBar}
		<TopBar onRefresh={topbar.onRefresh} lastUpdated={topbar.lastUpdated} role={session.role} />
	{/if}
	<div class="scroll">
		{#if isLogin || (ready && !blocked)}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	/* The ONLY scroll region — so the scrollbar lives below the navbar, not through it. */
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: var(--card-border) transparent;
	}
	.scroll::-webkit-scrollbar {
		width: 11px;
	}
	.scroll::-webkit-scrollbar-track {
		background: transparent;
	}
	.scroll::-webkit-scrollbar-thumb {
		background: var(--card-border);
		border-radius: 8px;
		border: 3px solid transparent;
		background-clip: padding-box;
	}
	.scroll::-webkit-scrollbar-thumb:hover {
		background: var(--faint);
		background-clip: padding-box;
	}
</style>
