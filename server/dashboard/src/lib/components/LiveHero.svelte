<script lang="ts">
	import { uid } from '$lib/uid';

	// The console "pulse" card: big monospace count of calls received for the current
	// scope, answered/rate, and a live area chart of the received series. The chart
	// wears the neutral series blue — received calls are DEMAND, and --live green
	// means good/available everywhere else; only the "answered" line keeps it.
	let {
		title,
		dateLabel,
		count,
		answered,
		rate,
		series = [],
		labels = []
	}: {
		title: string;
		dateLabel: string;
		count: string;
		answered: string;
		rate: string;
		series?: number[];
		labels?: string[];
	} = $props();

	const gid = uid('hero');
	const W = 680;
	const H = 104;
	const M = { t: 8, r: 6, b: 6, l: 6 };
	const TOP = M.t;
	const BOTTOM = H - M.b;

	const geo = $derived.by(() => {
		const clean = series.map((v) => (v == null ? 0 : v));
		const n = clean.length;
		if (n < 2) return null;
		const max = Math.max(1, ...clean) * 1.15;
		const iw = W - M.l - M.r;
		const ih = H - M.t - M.b;
		const X = (i: number) => M.l + (i / (n - 1)) * iw;
		const Y = (v: number) => M.t + ih - (v / max) * ih;
		const pts = clean.map((v, i) => [X(i), Y(v)] as [number, number]);
		const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
		const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${BOTTOM} L ${pts[0][0].toFixed(1)} ${BOTTOM} Z`;
		const points = pts.map((p, i) => ({ x: p[0], y: p[1], value: clean[i], label: labels[i] ?? '' }));
		return { line, area, last: pts[n - 1], points, left: M.l, right: W - M.r };
	});

	let hoverIdx = $state<number | null>(null);
	function onMove(e: PointerEvent): void {
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const n = series.length;
		if (rect.width === 0 || n === 0 || !geo) return;
		const vbX = ((e.clientX - rect.left) / rect.width) * W;
		const frac = n <= 1 ? 0 : Math.max(0, Math.min(1, (vbX - geo.left) / (geo.right - geo.left)));
		hoverIdx = Math.round(frac * (n - 1));
	}
	const hover = $derived(geo && hoverIdx != null ? geo.points[hoverIdx] : null);
	const tipPct = $derived(hover ? (hover.x / W) * 100 : 0);
	const tipShift = $derived(tipPct < 18 ? '0' : tipPct > 82 ? '-100%' : '-50%');
</script>

<div class="hero">
	<div class="head">
		<div class="title">{title}</div>
		<div class="date num">{dateLabel}</div>
	</div>
	<div class="body">
		<div class="count num">{count}</div>
		<div class="meta">
			<div class="answered num">{answered} answered</div>
			<div class="rate num">{rate} answer rate</div>
		</div>
	</div>
	<div class="chart">
		<svg
			viewBox="0 0 680 104"
			width="100%"
			height="104"
			preserveAspectRatio="none"
			role="img"
			aria-label="Calls received over time"
			onpointermove={onMove}
			onpointerleave={() => (hoverIdx = null)}
		>
			<defs>
				<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="var(--chart-line)" stop-opacity="0.32" />
					<stop offset="100%" stop-color="var(--chart-line)" stop-opacity="0" />
				</linearGradient>
			</defs>
			{#if geo}
				<path d={geo.area} fill="url(#{gid})" />
				<path class="ln" d={geo.line} fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
				{#if hover}
					<line class="crosshair" x1={hover.x} x2={hover.x} y1={TOP} y2={BOTTOM} />
					<circle class="hoverdot" cx={hover.x} cy={hover.y} r="4" />
				{:else}
					<circle class="pulse" cx={geo.last[0]} cy={geo.last[1]} r="5.5" fill="var(--chart-line)" />
					<circle cx={geo.last[0]} cy={geo.last[1]} r="2.8" fill="var(--chart-line)" />
				{/if}
			{/if}
		</svg>
		{#if hover}
			<div class="tip" style="left:{tipPct}%;transform:translateX({tipShift})">
				<span class="tl num">{hover.label}</span>
				<span class="tv num">{hover.value} calls</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.hero {
		position: relative;
		overflow: hidden;
		background: linear-gradient(160deg, var(--card-2), var(--card));
		border: 1px solid var(--card-border);
		border-radius: 20px;
		box-shadow: var(--card-shadow);
		padding: 22px 24px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.title {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--label);
	}
	.date {
		font-size: 12px;
		color: var(--faint);
	}
	.body {
		display: flex;
		align-items: flex-end;
		gap: 16px;
		margin-top: 12px;
	}
	.count {
		font-size: 58px;
		font-weight: 600;
		line-height: 0.92;
		letter-spacing: -0.03em;
		color: var(--text);
	}
	:global([data-theme='dark']) .count {
		text-shadow: 0 0 26px rgba(55, 160, 244, 0.35);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding-bottom: 6px;
	}
	.answered {
		font-size: 13px;
		font-weight: 700;
		color: var(--live);
	}
	.rate {
		font-size: 12px;
		color: var(--muted);
	}
	.chart {
		position: relative;
		margin-top: 14px;
	}
	.ln {
		filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--chart-line) 45%, transparent));
	}
	.pulse {
		opacity: 0.22;
		transform-box: fill-box;
		transform-origin: center;
		animation: v2pulse 1.7s ease-in-out infinite;
	}
	.crosshair {
		stroke: var(--chart-line);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		opacity: 0.6;
		pointer-events: none;
	}
	.hoverdot {
		fill: var(--chart-line);
		stroke: var(--card);
		stroke-width: 2;
		pointer-events: none;
	}
	.tip {
		position: absolute;
		top: -6px;
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
</style>
