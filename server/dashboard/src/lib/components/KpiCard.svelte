<script lang="ts">
	import Sparkline from './Sparkline.svelte';

	let {
		label,
		value,
		delta,
		sub = '',
		series = [],
		yMax,
		sparkColor = 'var(--chart-line)'
	}: {
		label: string;
		value: string;
		delta?: { text: string; dir: -1 | 0 | 1 };
		sub?: string;
		series?: Array<number | null>;
		yMax?: number;
		sparkColor?: string;
	} = $props();
</script>

<div class="kpi">
	<div class="top">
		<span class="label">{label}</span>
		{#if delta}
			<span class="delta num">
				{#if delta.dir > 0}
					<svg class="d" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 15 12 9 18 15" /></svg>
				{:else if delta.dir < 0}
					<svg class="d" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
				{/if}
				{delta.text}
			</span>
		{/if}
	</div>
	<div class="value num">{value}</div>
	{#if sub}<div class="sub num">{sub}</div>{/if}
	<div class="spark"><Sparkline {series} {yMax} color={sparkColor} /></div>
</div>

<style>
	.kpi {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 16px;
		padding: 15px 16px 12px;
		box-shadow: var(--card-shadow);
		transition:
			transform 0.16s ease,
			border-color 0.16s ease;
	}
	.kpi:hover {
		transform: translateY(-3px);
		border-color: color-mix(in srgb, var(--brand) 45%, var(--card-border));
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.label {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.delta {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 10.5px;
		font-weight: 700;
		color: var(--muted);
		flex-shrink: 0;
	}
	.delta .d {
		width: 11px;
		height: 11px;
		fill: none;
		stroke: currentColor;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.value {
		font-size: var(--kpi-size);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
		margin-top: -2px;
	}
	.spark {
		height: 30px;
		margin-top: 1px;
	}
</style>
