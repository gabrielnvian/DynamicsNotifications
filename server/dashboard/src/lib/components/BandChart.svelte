<script lang="ts">
	// Calls band: answered area, the not-answered band up to the received total, and
	// the received line.
	import { buildStackedCallsChart } from '$lib/chart-geometry.service';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { uid } from '$lib/uid';

	let {
		title = 'Calls received vs answered',
		subtitle = '',
		answered,
		received,
		labels,
		// viewBox units — a full-width card should pass a larger W, or the SVG scale-up
		// blows the axis text past the UI type sizes.
		W = 720,
		H = 210
	}: {
		title?: string;
		subtitle?: string;
		answered: number[];
		received: number[];
		labels: string[];
		W?: number;
		H?: number;
	} = $props();

	const TOP = 10;
	const BOTTOM = $derived(H - 22);
	const gid = uid('band');
	const chart = $derived(buildStackedCallsChart(answered, received, labels, { W, H }));

	let hoverIdx = $state<number | null>(null);
	function onMove(e: PointerEvent): void {
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const n = answered.length;
		if (rect.width === 0 || n === 0) return;
		const vbX = ((e.clientX - rect.left) / rect.width) * W;
		const { left, right } = chart.plot;
		const frac = n <= 1 ? 0 : Math.max(0, Math.min(1, (vbX - left) / (right - left)));
		hoverIdx = Math.round(frac * (n - 1));
	}
	const hover = $derived(hoverIdx != null ? chart.points[hoverIdx] : null);
	const tipPct = $derived(hover ? (hover.x / W) * 100 : 0);
	const tipShift = $derived(tipPct < 18 ? '0' : tipPct > 82 ? '-100%' : '-50%');
</script>

<div class="card">
	<div class="head">
		<div>
			<div class="title">{title}</div>
			{#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
		</div>
		<div class="legend">
			<span class="lg"><span class="sw sw-ans"></span>Answered</span>
			<span class="lg"><span class="sw sw-band"></span>Not answered</span>
			<span class="lg"><span class="sw sw-rec"></span>Received (total)</span>
		</div>
	</div>
	<div class="chartwrap">
		<svg
			class="chart"
			viewBox={chart.viewBox}
			role="img"
			aria-label={title}
			onpointermove={onMove}
			onpointerleave={() => (hoverIdx = null)}
		>
			<defs>
				<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--chart-line)" stop-opacity="0.22" />
					<stop offset="100%" stop-color="var(--chart-line)" stop-opacity="0" />
				</linearGradient>
			</defs>
			{#each chart.gridlines as g}
				<line x1="42" x2={W - 16} y1={g.y} y2={g.y} stroke="var(--chart-grid)" stroke-width="1" />
				<text x="36" y={g.y + 3} text-anchor="end" class="axis">{g.label}</text>
			{/each}
			{#each chart.xLabels as xl}
				<text x={xl.x} y={H - 6} text-anchor={xl.anchor} class="axis">{xl.label}</text>
			{/each}
			{#if prefs.chartFill && chart.answeredArea}
				<path d={chart.answeredArea} fill="url(#{gid})" />
			{/if}
			{#if chart.notAnsweredBand}
				<path d={chart.notAnsweredBand} fill="var(--chart-band)" fill-opacity="0.5" />
			{/if}
			{#if chart.answeredLine}
				<path
					d={chart.answeredLine}
					fill="none"
					stroke="var(--chart-line)"
					stroke-width="2"
					stroke-linejoin="round"
				/>
			{/if}
			<!-- Solid, not dashed: this is a measured series (the received total); dashing
			     reads as a projection/threshold. The crosshair keeps the dashed style. -->
			{#if chart.receivedLine}
				<path
					d={chart.receivedLine}
					fill="none"
					stroke="var(--chart-received)"
					stroke-width="1.4"
					stroke-linejoin="round"
				/>
			{/if}
			<circle cx={chart.answeredDot.x} cy={chart.answeredDot.y} r="3" fill="var(--chart-line)" />
			{#if hover}
				<line class="crosshair" x1={hover.x} x2={hover.x} y1={TOP} y2={BOTTOM} />
				<circle class="hoverdot rec" cx={hover.x} cy={hover.recY} r="3.5" />
				<circle class="hoverdot ans" cx={hover.x} cy={hover.ansY} r="4" />
			{/if}
		</svg>
		{#if hover}
			<div class="tip" style="left:{tipPct}%;transform:translateX({tipShift})">
				<span class="tl num">{hover.label}</span>
				<span class="row"><span class="k">Answered</span><span class="v num">{hover.answered}</span></span>
				<span class="row"><span class="k">Received</span><span class="v num">{hover.received}</span></span>
				<span class="row"><span class="k muted">Not answ.</span><span class="v num muted">{hover.notAnswered}</span></span>
			</div>
		{/if}
	</div>
</div>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 12px;
		padding: 14px 16px 12px;
		box-shadow: var(--card-shadow);
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.title {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}
	.subtitle {
		font-size: 11.5px;
		color: var(--label);
	}
	.legend {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.lg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--muted);
	}
	.sw {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		display: inline-block;
	}
	.sw-ans {
		background: var(--chart-line);
	}
	.sw-band {
		background: var(--chart-band);
	}
	.sw-rec {
		background: var(--chart-received);
	}
	.chartwrap {
		position: relative;
	}
	.chart {
		width: 100%;
		height: auto;
		overflow: visible;
		display: block;
	}
	.axis {
		font-size: 9.5px;
		fill: var(--chart-axis);
	}
	.crosshair {
		stroke: var(--chart-axis);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		opacity: 0.6;
		pointer-events: none;
	}
	.hoverdot {
		stroke: var(--card);
		stroke-width: 2;
		pointer-events: none;
	}
	.hoverdot.ans {
		fill: var(--chart-line);
	}
	.hoverdot.rec {
		fill: var(--chart-received);
	}
	.tip {
		position: absolute;
		top: 2px;
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 10px;
		border-radius: 8px;
		background: var(--card-2);
		border: 1px solid var(--card-border);
		box-shadow: var(--card-shadow);
		pointer-events: none;
		white-space: nowrap;
		z-index: 5;
	}
	.tl {
		font-size: 10.5px;
		color: var(--muted);
		margin-bottom: 1px;
	}
	.row {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		font-size: 12px;
	}
	.k {
		color: var(--text-soft);
	}
	.v {
		font-weight: 600;
		color: var(--text);
	}
	.muted {
		color: var(--faint) !important;
	}
</style>
