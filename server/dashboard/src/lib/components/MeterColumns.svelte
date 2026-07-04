<script lang="ts">
	// Active-vs-online as per-day METERS: each day is a track column (online hours,
	// a light step of the chart hue) with a filled column inside it (active hours).
	// How full each column is IS the story — no glued lines, no fake continuity
	// between days. Tooltip carries the exact numbers and the share.
	let {
		title = 'Active vs online hours',
		subtitle = '',
		labels,
		filled,
		total,
		fmt = (v: number) => `${v.toFixed(1)}h`
	}: {
		title?: string;
		subtitle?: string;
		labels: string[];
		filled: number[]; // active person-hours per label
		total: number[]; // online person-hours per label
		fmt?: (v: number) => string;
	} = $props();

	const maxV = $derived(Math.max(1, ...total, ...filled));
	const cols = $derived(
		labels.map((label, i) => ({
			label,
			filled: filled[i] ?? 0,
			total: total[i] ?? 0,
			fillPct: ((filled[i] ?? 0) / maxV) * 100,
			totalPct: ((total[i] ?? 0) / maxV) * 100
		}))
	);

	const tickStep = $derived(Math.max(1, Math.ceil(labels.length / 8)));

	let hoverIdx = $state<number | null>(null);
	function onMove(e: PointerEvent): void {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width === 0 || labels.length === 0) return;
		const frac = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width));
		hoverIdx = Math.floor(frac * labels.length);
	}
	const hover = $derived(hoverIdx == null ? null : cols[hoverIdx]);
	const tipPct = $derived(hoverIdx == null ? 0 : ((hoverIdx + 0.5) / labels.length) * 100);
	const tipShift = $derived(tipPct < 15 ? '0' : tipPct > 85 ? '-100%' : '-50%');
</script>

<div class="card">
	<div class="head">
		<div>
			<div class="title">{title}</div>
			{#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
		</div>
		<div class="legend">
			<span class="lg"><span class="sw sw-fill"></span>Active</span>
			<span class="lg"><span class="sw sw-track"></span>Online (total)</span>
		</div>
	</div>

	<div
		class="plot"
		role="img"
		aria-label={title}
		onpointermove={onMove}
		onpointerleave={() => (hoverIdx = null)}
	>
		{#each cols as c, i}
			<span class="col" class:hot={hoverIdx === i}>
				<span class="track" style="height:{c.totalPct}%"></span>
				<span class="fill" style="height:{c.fillPct}%"></span>
			</span>
		{/each}
		{#if hover}
			<div class="tip" style="left:{tipPct}%;transform:translateX({tipShift})">
				<span class="tl num">{hover.label}</span>
				<span class="row"><span class="k">Active</span><span class="v num">{fmt(hover.filled)}</span></span>
				<span class="row"><span class="k">Online</span><span class="v num">{fmt(hover.total)}</span></span>
				<span class="row muted"
					><span class="k">Away / no signal</span><span class="v num">{fmt(Math.max(0, hover.total - hover.filled))}</span></span
				>
				{#if hover.total > 0}
					<span class="row"
						><span class="k">of online, active</span><span class="v num">{Math.round((hover.filled / hover.total) * 100)}%</span></span
					>
				{/if}
			</div>
		{/if}
	</div>

	<div class="xrow" aria-hidden="true">
		{#each cols as c, i}
			<span class="xslot">
				{#if i % tickStep === 0 || i === cols.length - 1}<span class="xtick num">{c.label}</span>{/if}
			</span>
		{/each}
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
		margin-bottom: 10px;
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
	.sw-fill {
		background: var(--chart-line);
	}
	/* The meter track is a LIGHTER STEP OF THE SAME HUE (blue-in-blue), so track and
	   fill read as one measure at two levels — not two unrelated series. */
	.sw-track,
	.track {
		background: color-mix(in srgb, var(--chart-line) 18%, var(--card));
	}
	.plot {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 150px;
	}
	.col {
		position: relative;
		flex: 1;
		height: 100%;
		min-width: 0;
	}
	.track,
	.fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		border-radius: 3px 3px 0 0;
	}
	.fill {
		background: var(--chart-line);
	}
	.col.hot .fill {
		filter: brightness(1.15);
	}
	.xrow {
		display: flex;
		gap: 3px;
		margin-top: 5px;
	}
	.xslot {
		flex: 1;
		min-width: 0;
		text-align: center;
	}
	.xtick {
		font-size: 9.5px;
		color: var(--chart-axis);
		white-space: nowrap;
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
	.row.muted .k,
	.row.muted .v {
		color: var(--faint);
	}
</style>
