<script lang="ts">
	import { onMount } from 'svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateEmpty from '$lib/components/StateEmpty.svelte';
	import StateError from '$lib/components/StateError.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { AuthError } from '$lib/http';
	import { colorFor, setRoster } from '$lib/palette.service';
	import { getPresence } from '$lib/presence.client';
	import type { LiveStatus, PresenceResponse } from '$lib/presence.model';
	import { ensureRoster } from '$lib/roster.service';
	import { session } from '$lib/stores/session.svelte';
	import { topbar } from '$lib/stores/topbar.svelte';

	const POLL_MS = 2_000; // near-live refresh; the extension pushes status changes immediately

	let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
	let authErr = $state(false);
	let data = $state<PresenceResponse | null>(null);
	let lastUpdated = $state<number | null>(null);

	async function load(silent = false): Promise<void> {
		if (!silent) status = 'loading';
		try {
			// Colour identity comes from the shared roster assignment (palette.service).
			// A `live`-scoped account may not read /v1/operators, so it seeds from the
			// presence names instead — same sort, same slots for the same people.
			const [r] = await Promise.all([
				getPresence(),
				session.role === 'live' ? Promise.resolve() : ensureRoster()
			]);
			if (session.role === 'live') setRoster(r.operators.map((o) => o.first_name));
			data = r;
			lastUpdated = Date.now();
			authErr = false;
			status = r.operators.length === 0 ? 'empty' : 'ok';
		} catch (e) {
			authErr = e instanceof AuthError;
			status = 'error';
		}
	}

	onMount(() => {
		load();
		const timer = setInterval(() => load(true), POLL_MS);
		return () => clearInterval(timer);
	});

	// Feed the shared TopBar (rendered by the layout).
	$effect(() => {
		topbar.onRefresh = () => load();
		topbar.lastUpdated = lastUpdated;
	});

	const PRIORITY: Record<LiveStatus, number> = { available: 0, on_call: 1, away: 2, offline: 3 };
	const ops = $derived(
		[...(data?.operators ?? [])].sort(
			(a, b) => PRIORITY[a.status] - PRIORITY[b.status] || a.first_name.localeCompare(b.first_name)
		)
	);
	const counts = $derived.by(() => {
		const c: Record<LiveStatus, number> = { available: 0, on_call: 0, away: 0, offline: 0 };
		for (const o of data?.operators ?? []) c[o.status]++;
		return c;
	});

	function cap(first: string): string {
		return first ? first.charAt(0).toUpperCase() + first.slice(1) : first;
	}
	function isOnline(s: LiveStatus): boolean {
		return s === 'available' || s === 'on_call';
	}
	// Relative "how long ago", anchored to the server's `now` so it doesn't drift with
	// the client clock between polls.
	function ago(fromMs: number): string {
		const s = Math.max(0, Math.round(((data?.now ?? fromMs) - fromMs) / 1000));
		if (s < 60) return `${s}s ago`;
		const m = Math.round(s / 60);
		if (m < 60) return `${m}m ago`;
		return `${Math.round(m / 60)}h ago`;
	}
</script>

<main class="wrap">
	<div class="toolbar">
		<div class="left">
			<span class="title">Operator status</span>
			{#if status === 'ok'}
				<span class="counts">
					<span class="c s-available">{counts.available} available</span>
					<span class="c s-on_call">{counts.on_call} on a call</span>
					<span class="c s-away">{counts.away} away</span>
					<span class="c s-offline">{counts.offline} offline</span>
				</span>
			{/if}
		</div>
		<span class="auto"><span class="pulse"></span>Auto-refreshing</span>
	</div>

	{#if status === 'error'}
		<StateError auth={authErr} />
	{:else if status === 'loading'}
		<Skeleton height="320px" radius="12px" />
	{:else if status === 'empty'}
		<StateEmpty
			title="No operators reporting"
			body="No extension has sent a status heartbeat yet. Operators appear here while a Dynamics tab is open."
		/>
	{:else}
		<div class="card">
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th class="l">Operator</th>
							<th class="l">Status</th>
							<th class="r">Last available</th>
						</tr>
					</thead>
					<tbody>
						{#each ops as o (o.first_name)}
							<tr class:dim={o.status === 'offline'}>
								<td>
									<span class="op">
										<span class="dot" style="background:{colorFor(o.first_name)}"></span>
										<span class="name">{cap(o.first_name)}</span>
									</span>
								</td>
								<td><StatusBadge status={o.status} /></td>
								<td class="r seen">
									{#if isOnline(o.status)}
										<span class="nowlbl">now</span>
									{:else}
										{o.last_online_ms ? ago(o.last_online_ms) : 'not available yet'}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</main>

<style>
	.wrap {
		max-width: 1180px;
		margin: 0 auto;
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.left {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	.title {
		font-size: 16px;
		font-weight: 700;
		color: var(--text);
	}
	.counts {
		display: inline-flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.c {
		font-size: 12.5px;
		font-weight: 600;
	}
	.c.s-available {
		color: var(--status-available);
	}
	.c.s-on_call {
		color: var(--status-on-call);
	}
	.c.s-away {
		color: var(--status-away);
	}
	.c.s-offline {
		color: var(--status-offline);
	}
	.auto {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
	}
	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--status-available);
		animation: cc-pulse 1.6s ease-in-out infinite;
	}
	@keyframes cc-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	.card {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 12px;
		box-shadow: var(--card-shadow);
		overflow: hidden;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	thead th {
		position: sticky;
		top: 0;
		background: var(--head-bg);
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--label);
		padding: var(--row-pad);
		white-space: nowrap;
	}
	th.l {
		text-align: left;
	}
	th.r {
		text-align: right;
	}
	tbody td {
		padding: var(--row-pad);
		border-bottom: 1px solid var(--divider);
		font-size: 13px;
		color: var(--text-soft);
		white-space: nowrap;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	tr.dim {
		opacity: 0.6;
	}
	td.r {
		text-align: right;
	}
	.op {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}
	.seen {
		font-size: 12px;
		color: var(--faint);
	}
	.nowlbl {
		color: var(--status-available);
		font-weight: 600;
	}
</style>
