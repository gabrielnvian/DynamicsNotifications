<script lang="ts">
	// Operators × half-hours as a heatmap: one row per operator (sorted by total
	// answered), cells shaded by calls answered in that slot, total at the row end.
	// Replaces the multi-line chart — 7+ lines of 0–4-count integers was unreadable
	// spaghetti, and this form never overlaps, ranks at a glance, and shows each
	// person's working window. Identity rides the row label, so the only colour is
	// ONE sequential ramp (counts are tiny integers → discrete bins 0/1/2/3/4+).
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { capitalizeName, fmtClock, fmtInt, fmtSlotRange } from '$lib/format.formatter';

	let {
		title = 'Calls answered by operator',
		subtitle = '',
		labels,
		operators,
		slotMinutes = 30
	}: {
		title?: string;
		subtitle?: string;
		labels: string[];
		operators: { first_name: string; answered: number[]; received: number[] }[];
		slotMinutes?: number;
	} = $props();

	const rows = $derived(
		operators
			.map((o) => ({
				...o,
				total: o.answered.reduce((s, v) => s + v, 0),
				totalReceived: o.received.reduce((s, v) => s + v, 0),
				missedTotal: Math.max(
					0,
					o.received.reduce((s, v) => s + v, 0) - o.answered.reduce((s, v) => s + v, 0)
				)
			}))
			.sort((a, b) => b.total - a.total || a.first_name.localeCompare(b.first_name))
	);

	// Discrete bins: mix the chart hue into the card surface so the ramp adapts to
	// both themes (more calls = more hue). 0 stays the neutral track — hue means data.
	// Single-day slots hold tiny integers → exact bins 0/1/2/3/4+. Multi-day sums can
	// reach dozens, so past 4 the four hue steps scale linearly to the observed max.
	// Bin 1 starts at 45% hue — most real cells hold exactly one call, and a softer
	// first step read as "idle" next to the empty track.
	const BIN_PCT = [0, 45, 65, 82, 100];
	const maxV = $derived(Math.max(1, ...operators.flatMap((o) => o.answered)));
	const exactBins = $derived(maxV <= 4);
	function binOf(v: number): number {
		if (v <= 0) return 0;
		if (exactBins) return Math.min(4, v);
		return Math.min(4, Math.max(1, Math.ceil((v / maxV) * 4)));
	}
	function binBg(bin: number): string {
		if (bin <= 0) return 'var(--track)';
		return `color-mix(in srgb, var(--chart-line) ${BIN_PCT[bin]}%, var(--card))`;
	}
	function cellBg(v: number): string {
		return binBg(binOf(v));
	}
	// Legend bounds derive from the SAME boundary math as binOf — bin k covers the
	// integers in (maxV(k−1)/4, maxV·k/4] — so the key never mislabels a colour.
	const legend = $derived.by(() => {
		if (exactBins) return ['0', '1', '2', '3', '4+'];
		const bounds = (k: number) => {
			const lo = Math.floor(((k - 1) * maxV) / 4) + 1;
			const hi = Math.floor((k * maxV) / 4);
			return lo >= hi ? `${hi}` : `${lo}–${hi}`;
		};
		return ['0', bounds(1), bounds(2), bounds(3), bounds(4)];
	});

	// A slot where the phone rang and NOTHING was answered is the actionable failure —
	// it must not render identically to "off shift". Amber ring marks it.
	function dropped(r: (typeof rows)[number], ci: number): boolean {
		return (r.received[ci] ?? 0) > 0 && (r.answered[ci] ?? 0) === 0;
	}

	// Column time ticks: every k-th slot plus the last (same rule as the line charts).
	const tickStep = $derived(Math.max(1, Math.ceil(labels.length / 8)));
	const ticks = $derived(
		labels
			.map((label, i) => ({ label, i }))
			.filter(({ i }) => i % tickStep === 0 || i === labels.length - 1)
	);

	let hover = $state<{ row: number; col: number } | null>(null);
	// One pointer handler per row strip (role="img"), column derived from position —
	// mirrors the SVG charts' crosshair mapping and keeps the DOM listener-light.
	function onMove(e: PointerEvent, row: number): void {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width === 0 || labels.length === 0) return;
		const frac = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width));
		hover = { row, col: Math.floor(frac * labels.length) };
	}
	const hovered = $derived(
		hover
			? {
					name: capitalizeName(rows[hover.row].first_name),
					slot: fmtSlotRange(labels[hover.col], slotMinutes),
					answered: rows[hover.row].answered[hover.col] ?? 0,
					received: rows[hover.row].received[hover.col] ?? 0
				}
			: null
	);
	const tipPct = $derived(hover ? ((hover.col + 0.5) / labels.length) * 100 : 0);
	const tipShift = $derived(tipPct < 15 ? '0' : tipPct > 85 ? '-100%' : '-50%');

	function open(first: string): void {
		goto(`/operators/${encodeURIComponent(first)}${$page.url.search}`);
	}
	function rowKey(e: KeyboardEvent, first: string): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open(first);
		}
	}
</script>

<div class="card">
	<div class="head">
		<div>
			<div class="title">{title}</div>
			{#if subtitle}<div class="subtitle">{subtitle}</div>{/if}
		</div>
		<div class="scale" aria-label="Calls per slot, fewest to most">
			<span class="slbl">calls / {slotMinutes} min</span>
			{#each legend as lab, bin}
				<span class="skey">
					<span class="swatch" style="background:{binBg(bin)}"></span>
					<span class="snum num">{lab}</span>
				</span>
			{/each}
			<span class="skey"><span class="swatch drop"></span><span class="snum">rang, none answered</span></span>
		</div>
	</div>

	<div class="grid">
		{#each rows as r, ri (r.first_name)}
			<div
				class="row"
				role="button"
				tabindex="0"
				aria-label={`${capitalizeName(r.first_name)}: ${r.total} answered of ${r.totalReceived} received — view detail`}
				onclick={() => open(r.first_name)}
				onkeydown={(e) => rowKey(e, r.first_name)}
			>
				<span class="name">{capitalizeName(r.first_name)}</span>
				<span
					class="cells"
					style="grid-template-columns: repeat({labels.length}, 1fr)"
					role="img"
					aria-label={`${capitalizeName(r.first_name)}: calls answered per half hour`}
					onpointermove={(e) => onMove(e, ri)}
					onpointerleave={() => (hover = null)}
				>
					{#each r.answered as v, ci}
						<span
							class="cell"
							class:hot={hover?.row === ri && hover?.col === ci}
							class:drop={dropped(r, ci)}
							style="background:{cellBg(v)}"
						></span>
					{/each}
					{#if hovered && hover?.row === ri}
						<span
							class="tip"
							style="left:{tipPct}%;transform:translateX({tipShift});{ri === 0
								? 'top:26px'
								: 'bottom:26px'}"
						>
							<span class="tl num">{hovered.slot}</span>
							<span class="trow"
								><span class="tn">{hovered.name}</span><span class="tv num">{hovered.answered} answered</span></span
							>
							<span class="trow muted"
								><span class="tn">received</span><span class="tv num">{hovered.received}</span></span
							>
						</span>
					{/if}
				</span>
				<span class="total num">{fmtInt(r.total)}</span>
				<span class="missed num" class:none={r.missedTotal === 0}>{fmtInt(r.missedTotal)}</span>
			</div>
		{/each}

		<div class="xrow" aria-hidden="true">
			<span class="name"></span>
			<span class="xcells" style="grid-template-columns: repeat({labels.length}, 1fr)">
				{#each ticks as t}
					<span
						class="xtick num"
						style="grid-column:{t.i + 1}"
						class:first={t.i === 0}
						class:last={t.i === labels.length - 1}>{fmtClock(t.label)}</span
					>
				{/each}
			</span>
			<span class="total-h">answered</span>
			<span class="total-h">missed</span>
		</div>
	</div>
</div>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 18px;
		box-shadow: var(--card-shadow);
		padding: 18px 20px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text);
	}
	.subtitle {
		font-size: 11.5px;
		color: var(--label);
		margin-top: 1px;
	}
	.scale {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.slbl {
		font-size: 10.5px;
		color: var(--faint);
		margin-right: 2px;
	}
	.skey {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.swatch {
		width: 13px;
		height: 13px;
		border-radius: 3px;
	}
	.snum {
		font-size: 10px;
		color: var(--muted);
	}
	.grid {
		display: flex;
		flex-direction: column;
		gap: 2px; /* the surface gap does the separating — no borders on marks */
	}
	.row {
		display: grid;
		grid-template-columns: 96px 1fr 64px 52px;
		align-items: center;
		gap: 10px;
		padding: 1px 0;
		border-radius: 6px;
		cursor: pointer;
	}
	.row:hover .name,
	.row:focus-visible .name {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.row:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.name {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cells {
		position: relative;
		display: grid;
		gap: 2px;
	}
	.cell {
		height: 22px;
		border-radius: 3px;
	}
	.cell.hot {
		outline: 2px solid var(--text);
		outline-offset: -1px;
	}
	.cell.drop,
	.swatch.drop {
		box-shadow: inset 0 0 0 2px var(--amber);
	}
	.swatch.drop {
		background: var(--track);
	}
	.total {
		text-align: right;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.missed {
		text-align: right;
		font-size: 13px;
		font-weight: 600;
		color: var(--danger);
	}
	.missed.none {
		color: var(--faint);
		font-weight: 500;
	}
	.xrow {
		display: grid;
		grid-template-columns: 96px 1fr 64px 52px;
		gap: 10px;
		margin-top: 3px;
	}
	.xcells {
		display: grid;
		gap: 2px;
	}
	.xtick {
		justify-self: center;
		font-size: 9.5px;
		color: var(--chart-axis);
		white-space: nowrap;
	}
	.xtick.first {
		justify-self: start;
	}
	.xtick.last {
		justify-self: end;
	}
	.total-h {
		text-align: right;
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--faint);
		align-self: center;
	}
	.tip {
		position: absolute;
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
	.trow {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		font-size: 12px;
	}
	.tn {
		color: var(--text-soft);
	}
	.tv {
		font-weight: 600;
		color: var(--text);
	}
	.trow.muted .tn,
	.trow.muted .tv {
		color: var(--faint);
	}
</style>
