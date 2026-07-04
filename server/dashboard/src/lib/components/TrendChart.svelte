<script lang="ts">
	import { buildLineChart } from '$lib/chart-geometry.service';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { uid } from '$lib/uid';

	let {
		title,
		subtitle = '',
		footnote = '',
		series,
		labels,
		fmt,
		yMax,
		target,
		targetLabel = '',
		detail
	}: {
		title: string;
		subtitle?: string;
		footnote?: string;
		series: Array<number | null>;
		labels: string[];
		fmt?: (v: number) => string;
		yMax?: number;
		target?: number; // reference line in series units (e.g. the 85% answer target)
		targetLabel?: string;
		detail?: (i: number) => string; // secondary tooltip line, e.g. "9 of 17 answered"
	} = $props();

	const W = 384;
	const H = 176;
	const TOP = 10;
	const BOTTOM = H - 22; // default axis margins (see makeAxis)
	const gid = uid('trend');
	const chart = $derived(buildLineChart(series, { W, H, labels, fmt, yMax, area: prefs.chartFill }));

	// ── Hover: map the pointer to the nearest data index → crosshair + tooltip ──
	let hoverIdx = $state<number | null>(null);
	function onMove(e: PointerEvent): void {
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const n = series.length;
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
		<div class="title">{title}</div>
		{#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
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
					<stop offset="0%" stop-color="var(--chart-line)" stop-opacity="0.16" />
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
			{#if target != null}
				<line
					class="target"
					x1={chart.plot.left}
					x2={chart.plot.right}
					y1={chart.yOf(target)}
					y2={chart.yOf(target)}
				/>
				{#if targetLabel}
					<text class="tgt" x={chart.plot.right} y={chart.yOf(target) - 4} text-anchor="end">{targetLabel}</text>
				{/if}
			{/if}
			{#if chart.areaPath}<path d={chart.areaPath} fill="url(#{gid})" />{/if}
			{#if chart.bridgePath}
				<path class="bridge" d={chart.bridgePath} fill="none" stroke="var(--chart-line)" stroke-width="1.5" />
			{/if}
			{#if chart.linePath}
				<path
					d={chart.linePath}
					fill="none"
					stroke="var(--chart-line)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/if}
			{#each chart.dots as d}<circle cx={d.x} cy={d.y} r="2.5" fill="var(--chart-line)" />{/each}
			{#if chart.last}<circle cx={chart.last.x} cy={chart.last.y} r="3" fill="var(--chart-line)" />{/if}
			{#if hover}
				<line class="crosshair" x1={hover.x} x2={hover.x} y1={TOP} y2={BOTTOM} />
				{#if hover.y != null}<circle class="hoverdot" cx={hover.x} cy={hover.y} r="4" />{/if}
			{/if}
		</svg>
		{#if hover}
			<div class="tip" style="left:{tipPct}%;transform:translateX({tipShift})">
				<span class="tl num">{hover.label}</span>
				<span class="tv num">{hover.value == null ? '—' : fmt ? fmt(hover.value) : hover.value}</span>
				{#if detail && hoverIdx != null && hover.value != null}
					<span class="td num">{detail(hoverIdx)}</span>
				{/if}
			</div>
		{/if}
	</div>
	{#if footnote}<div class="footnote">{footnote}</div>{/if}
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
	/* Dash = "no data in this stretch" — the honest bridge across null gaps. */
	.bridge {
		stroke-dasharray: 3 4;
		opacity: 0.4;
	}
	/* The goal line wears the judgment colour (amber = the below-target flag). */
	.target {
		stroke: var(--amber);
		stroke-width: 1.5;
		opacity: 0.75;
	}
	.tgt {
		font-size: 9px;
		fill: var(--amber);
	}
	.td {
		font-size: 10.5px;
		color: var(--muted);
	}
	.hoverdot {
		fill: var(--chart-line);
		stroke: var(--card);
		stroke-width: 2;
		pointer-events: none;
	}
	.tip {
		position: absolute;
		top: 2px;
		display: inline-flex;
		flex-direction: column;
		gap: 1px;
		padding: 5px 9px;
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
	}
	.tv {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.footnote {
		margin-top: 6px;
		font-size: 10.5px;
		color: var(--faint);
	}
</style>
