<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { logout } from '$lib/auth.client';
	import { theme } from '$lib/stores/theme.svelte';
	import Icon from './Icon.svelte';

	// lastUpdated (epoch ms) drives the LIVE indicator; omit it on pages without live data.
	// role scopes the nav: `live` accounts see only the operator-status board.
	let {
		onRefresh,
		lastUpdated = null,
		role = 'full'
	}: { onRefresh?: () => void; lastUpdated?: number | null; role?: 'full' | 'live' | null } =
		$props();

	const path = $derived($page.url.pathname);
	const liveOnly = $derived(role === 'live');

	// 1s clock so "updated Ns ago" ticks without re-fetching.
	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	const ago = $derived(lastUpdated ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null);

	let spinning = $state(false);
	function refresh(): void {
		if (!onRefresh) return;
		spinning = true;
		onRefresh();
		setTimeout(() => (spinning = false), 650);
	}
	async function signOut(): Promise<void> {
		await logout();
		goto('/login');
	}
</script>

<header class="bar">
	<div class="left">
		<a class="brand" href={liveOnly ? '/live' : '/'}>
			<span class="logo" aria-hidden="true">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
					<rect x="3" y="12" width="4.4" height="9" rx="1" />
					<rect x="9.8" y="6" width="4.4" height="15" rx="1" />
					<rect x="16.6" y="9" width="4.4" height="12" rx="1" />
				</svg>
			</span>
			<span class="name">Dynops</span>
		</a>
		<nav class="nav">
			{#if !liveOnly}
				<a class="lnk" class:active={path === '/'} href="/">Overview</a>
				<!-- Operator detail pages (/operators/…) are reached from the Trends table. -->
				<a class="lnk" class:active={path.startsWith('/trends') || path.startsWith('/operators')} href="/trends">Trends</a>
			{/if}
			<a class="lnk" class:active={path.startsWith('/live')} href="/live">Operator status</a>
		</nav>
	</div>

	<div class="right">
		{#if ago != null}
			<span class="live" aria-label="Live — auto-refreshing">
				<span class="dot"><span></span></span>
				<span class="lbl">LIVE</span>
				<span class="ago num">updated {ago}s ago</span>
			</span>
		{/if}
		{#if onRefresh}
			<button class="ico" onclick={refresh} title="Refresh" aria-label="Refresh">
				<span class="spin" class:on={spinning}><Icon name="refresh" size={16} /></span>
			</button>
		{/if}
		<button class="ico" onclick={() => theme.toggle()} title="Toggle theme" aria-label="Toggle theme">
			<Icon name={theme.value === 'dark' ? 'sun' : 'moon'} size={16} />
		</button>
		<button class="ico" onclick={signOut} title="Sign out" aria-label="Sign out">
			<Icon name="logout" size={16} />
		</button>
	</div>
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding: 12px 26px;
		background: color-mix(in srgb, var(--bg) 72%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-bottom: 1px solid var(--card-border);
	}
	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
	}
	.right {
		gap: 10px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: var(--text);
	}
	.logo {
		display: inline-flex;
		color: var(--brand);
	}
	.name {
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	/* Nav items read as links, not buttons. */
	.nav {
		display: inline-flex;
		align-items: center;
		gap: 18px;
	}
	.lnk {
		position: relative;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		padding: 2px 0;
	}
	.lnk:hover {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.lnk.active {
		color: var(--brand);
	}
	.lnk.active::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -3px;
		height: 2px;
		border-radius: 2px;
		background: var(--brand);
	}
	/* LIVE = a passive status indicator (no border/fill so it doesn't read as a button). */
	.live {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0 2px;
		user-select: none;
	}
	.live .dot {
		position: relative;
		display: flex;
		width: 8px;
		height: 8px;
	}
	.live .dot span {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--live);
		animation: v2pulse 1.7s ease-in-out infinite;
	}
	.live .lbl {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.09em;
		color: var(--live);
	}
	.live .ago {
		font-size: 11.5px;
		color: var(--faint);
	}
	.ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 11px;
		border: 1px solid var(--card-border);
		background: var(--input-bg);
		color: var(--text-soft);
		cursor: pointer;
	}
	.ico:hover {
		color: var(--text);
		border-color: color-mix(in srgb, var(--brand) 45%, var(--card-border));
	}
	.spin {
		display: flex;
	}
	.spin.on {
		animation: v2spin 0.7s linear infinite;
	}
</style>
