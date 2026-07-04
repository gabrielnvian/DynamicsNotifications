<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { USE_MOCK } from '$lib/http';
	import type { RangeKey } from '$lib/metrics.model';
	import { rangeFor } from '$lib/mock.service';
	import { prettyRangeShort, rangeKeyFromUrl, resolveRange } from '$lib/range.service';
	import Icon from './Icon.svelte';

	const ALL_PRESETS: { key: RangeKey; label: string }[] = [
		{ key: 'today', label: '1D' },
		{ key: 'last7', label: '7D' },
		{ key: 'last30', label: '30D' },
		{ key: 'month', label: 'MTD' }
	];

	// Pages scope the presets (Trends has no 1D — Today is its own page) and set the
	// default the URL falls back to when it carries no range.
	let {
		presetKeys = ['today', 'last7', 'last30', 'month'] as RangeKey[],
		defaultKey = 'today' as RangeKey
	}: { presetKeys?: RangeKey[]; defaultKey?: RangeKey } = $props();

	const PRESETS = $derived(ALL_PRESETS.filter((p) => presetKeys.includes(p.key)));
	const key = $derived(rangeKeyFromUrl($page.url, defaultKey));
	const active = $derived(resolveRange($page.url, defaultKey));
	const isCustom = $derived(key === 'custom');

	// Selectable window bounds for the native date inputs.
	function today(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	const bounds = $derived(
		USE_MOCK ? rangeFor('month') : { from: '2024-01-01', to: today() }
	);

	let open = $state(false);
	let draftFrom = $state('');
	let draftTo = $state('');

	const draftError = $derived(
		draftFrom && draftTo && draftFrom > draftTo ? "Start is after end — we'll swap them on apply." : ''
	);

	function preset(k: RangeKey): void {
		const u = new URL($page.url);
		u.searchParams.set('range', k);
		u.searchParams.delete('from');
		u.searchParams.delete('to');
		open = false;
		goto(`${u.pathname}${u.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function toggle(): void {
		if (!open) {
			draftFrom = active.from;
			draftTo = active.to;
		}
		open = !open;
	}

	function apply(): void {
		let f = draftFrom;
		let t = draftTo;
		if (!f || !t) return;
		if (f > t) [f, t] = [t, f];
		if (f < bounds.from) f = bounds.from;
		if (t > bounds.to) t = bounds.to;
		const u = new URL($page.url);
		u.searchParams.set('range', 'custom');
		u.searchParams.set('from', f);
		u.searchParams.set('to', t);
		open = false;
		goto(`${u.pathname}${u.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<div class="wrap">
	<div class="seg" role="group" aria-label="Date range">
		{#each PRESETS as p}
			<button class:active={key === p.key} aria-pressed={key === p.key} onclick={() => preset(p.key)}>
				{p.label}
			</button>
		{/each}
	</div>

	<div class="custom">
		<button class="cbtn num" class:active={isCustom} onclick={toggle} title="Custom date range">
			<Icon name="calendar" size={15} />
			<span>{isCustom ? prettyRangeShort(active) : 'Custom'}</span>
			<span class="caret" class:open><Icon name="chevron" size={11} /></span>
		</button>

		{#if open}
			<button class="overlay" aria-label="Close" onclick={() => (open = false)}></button>
			<div class="pop">
				<div class="ptitle">Custom range</div>
				<div class="fields">
					<label>From
						<input type="date" bind:value={draftFrom} min={bounds.from} max={bounds.to} />
					</label>
					<label>To
						<input type="date" bind:value={draftTo} min={bounds.from} max={bounds.to} />
					</label>
				</div>
				{#if draftError}<div class="err">{draftError}</div>{/if}
				<div class="pactions">
					<button class="cancel" onclick={() => (open = false)}>Cancel</button>
					<button class="applyb" onclick={apply}>Apply range</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px;
		border-radius: 11px;
		background: var(--input-bg);
		border: 1px solid var(--card-border);
	}
	.seg button {
		height: 28px;
		padding: 0 12px;
		font-family: var(--font-num);
		font-size: 12px;
		font-weight: 700;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.seg button:hover {
		color: var(--text);
	}
	.seg button.active {
		background: var(--brand);
		color: #fff;
	}
	.custom {
		position: relative;
	}
	.cbtn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 38px;
		padding: 0 12px;
		border-radius: 11px;
		border: 1px solid var(--card-border);
		background: var(--input-bg);
		color: var(--text-soft);
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.cbtn.active {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.caret {
		display: flex;
		transition: transform 0.18s ease;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 39;
		border: none;
		background: transparent;
		cursor: default;
	}
	.pop {
		position: absolute;
		top: 46px;
		right: 0;
		z-index: 40;
		width: 290px;
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 14px;
		box-shadow: var(--card-shadow);
		padding: 16px;
	}
	.ptitle {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--label);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 11px;
		margin-top: 13px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
	}
	.fields input {
		height: 38px;
		padding: 0 11px;
		font-size: 13px;
		font-family: var(--font-num);
		border: 1px solid var(--card-border);
		border-radius: 9px;
		background: var(--input-bg);
		color: var(--text);
		outline: none;
	}
	.err {
		font-size: 11.5px;
		color: var(--amber);
		margin-top: 9px;
	}
	.pactions {
		display: flex;
		gap: 8px;
		margin-top: 15px;
	}
	.pactions button {
		height: 36px;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.cancel {
		flex: 1;
		border: 1px solid var(--card-border);
		background: transparent;
		color: var(--text-soft);
	}
	.applyb {
		flex: 1.4;
		border: none;
		background: var(--brand);
		color: #fff;
	}
</style>
