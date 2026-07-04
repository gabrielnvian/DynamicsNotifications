<script lang="ts">
	// Status timeline: one lane per operator, spans drawn at their EXACT heartbeat
	// timestamps (no slot snapping) — green available, blue on-call, amber away.
	// Empty track between spans is offline/no-signal time; red markers are rings
	// that were never picked up. Row total = time online in any status. The window
	// auto-zooms to the day's first..last signal.
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { capitalizeName, fmtHoursMinutes } from '$lib/format.formatter';
	import type { PresenceSpan, SpanStatus } from '$lib/presence.model';

	let {
		title = 'Online status by operator',
		subtitle = '',
		start_ms,
		end_ms,
		operators
	}: {
		title?: string;
		subtitle?: string;
		start_ms: number;
		end_ms: number;
		operators: {
			first_name: string;
			online_seconds: number;
			spans: PresenceSpan[];
			missed_ms?: number[];
		}[];
	} = $props();

	const STATUS_META: Record<SpanStatus, { label: string; bg: string }> = {
		available: { label: 'Available', bg: 'var(--status-available)' },
		on_call: { label: 'On a call', bg: 'var(--status-on-call)' },
		away: { label: 'Away', bg: 'var(--status-away)' }
	};

	// Auto-zoom to the signal, padded, clamped to the day.
	const PAD_MS = 10 * 60_000;
	const view = $derived.by(() => {
		const starts = operators.flatMap((o) => o.spans.map((s) => s.start_ms));
		const ends = operators.flatMap((o) => o.spans.map((s) => s.end_ms));
		if (starts.length === 0) return { start: start_ms, end: end_ms };
		return {
			start: Math.max(start_ms, Math.min(...starts) - PAD_MS),
			end: Math.min(end_ms, Math.max(...ends) + PAD_MS)
		};
	});
	const viewLen = $derived(Math.max(1, view.end - view.start));

	function pct(ms: number): number {
		return ((ms - view.start) / viewLen) * 100;
	}

	// Spans arrive non-overlapping and sorted (the server flattens them). Round only
	// the OUTER ends of a contiguous run — a status change inside a run is a square
	// joint, so back-to-back segments read as one bar that changes colour.
	const TOUCH_MS = 1000;
	const lanes = $derived(
		operators.map((o) => ({
			...o,
			drawSpans: o.spans.map((s, i, arr) => ({
				...s,
				rl: i === 0 || s.start_ms - arr[i - 1].end_ms > TOUCH_MS ? 3 : 0,
				rr: i === arr.length - 1 || arr[i + 1].start_ms - s.end_ms > TOUCH_MS ? 3 : 0
			})),
			missed: (o.missed_ms ?? []).filter((t) => t >= view.start && t <= view.end)
		}))
	);

	function clock(ms: number): string {
		const d = new Date(ms);
		const h = d.getHours();
		const m = d.getMinutes();
		const suffix = h < 12 ? 'am' : 'pm';
		const hh = h % 12 === 0 ? 12 : h % 12;
		return m ? `${hh}:${String(m).padStart(2, '0')}${suffix}` : `${hh}${suffix}`;
	}

	// Hour ticks across the view window (2-hourly when the window is long).
	const ticks = $derived.by(() => {
		const HOUR = 3_600_000;
		const stepMs = viewLen > 11 * HOUR ? 2 * HOUR : HOUR;
		const out: { pct: number; label: string }[] = [];
		const first = new Date(view.start);
		first.setMinutes(0, 0, 0);
		for (let t = first.getTime(); t <= view.end; t += stepMs) {
			if (t < view.start) continue;
			out.push({ pct: pct(t), label: clock(t) });
		}
		return out;
	});

	// Markers can crowd a busy day — the legend key toggles them (default on).
	let showMissed = $state(true);

	let hover = $state<{ row: number; x: number } | null>(null);
	function onMove(e: PointerEvent, row: number): void {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width === 0) return;
		hover = { row, x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) };
	}
	const hovered = $derived.by(() => {
		if (!hover) return null;
		const t = view.start + hover.x * viewLen;
		const lane = operators[hover.row];
		const span = lane.spans.find((s) => t >= s.start_ms && t <= s.end_ms);
		// Surface ALL missed-call markers within grabbing distance — clustered rings
		// overlap visually, so the tooltip is where they become individually readable.
		const tol = Math.max(150_000, viewLen * 0.01);
		const near = !showMissed
			? []
			: (lane.missed_ms ?? []).filter((m) => Math.abs(m - t) <= tol).map(clock);
		const missedNear =
			near.length === 0
				? null
				: near.length <= 4
					? near.join(', ')
					: `${near.slice(0, 4).join(', ')} +${near.length - 4} more`;
		return {
			name: capitalizeName(lane.first_name),
			at: clock(t),
			missedCount: near.length,
			missedNear,
			span: span
				? {
						label: STATUS_META[span.status].label,
						range: `${clock(span.start_ms)} – ${clock(span.end_ms)}`,
						dur: fmtHoursMinutes(Math.round((span.end_ms - span.start_ms) / 1000))
					}
				: null
		};
	});
	const tipPct = $derived(hover ? hover.x * 100 : 0);
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
		<div class="scale" aria-label="Status colour key">
			{#each Object.values(STATUS_META) as m}
				<span class="skey"><span class="swatch" style="background:{m.bg}"></span><span class="slab">{m.label}</span></span>
			{/each}
			<button
				class="skey mkey"
				class:off={!showMissed}
				aria-pressed={showMissed}
				title={showMissed ? 'Hide missed-call markers' : 'Show missed-call markers'}
				onclick={() => (showMissed = !showMissed)}
			>
				<span class="dotk"></span><span class="slab">Missed calls</span>
			</button>
		</div>
	</div>

	{#if operators.length === 0}
		<div class="none">No presence recorded for this day.</div>
	{:else}
	<div class="grid">
		{#each lanes as lane, ri (lane.first_name)}
			<div
				class="row"
				role="button"
				tabindex="0"
				aria-label={`${capitalizeName(lane.first_name)}: online ${fmtHoursMinutes(lane.online_seconds)} — view detail`}
				onclick={() => open(lane.first_name)}
				onkeydown={(e) => rowKey(e, lane.first_name)}
			>
				<span class="name">{capitalizeName(lane.first_name)}</span>
				<span
					class="lane"
					role="img"
					aria-label={`${capitalizeName(lane.first_name)}: status over the day`}
					onpointermove={(e) => onMove(e, ri)}
					onpointerleave={() => (hover = null)}
				>
					{#each lane.drawSpans as s}
						<span
							class="span"
							style="left:{pct(s.start_ms)}%;width:max(2px,{pct(s.end_ms) - pct(s.start_ms)}%);background:{STATUS_META[s.status].bg};border-radius:{s.rl}px {s.rr}px {s.rr}px {s.rl}px"
						></span>
					{/each}
					{#if showMissed}
						{#each lane.missed as t}
							<span class="miss" style="left:{pct(t)}%"></span>
						{/each}
					{/if}
					{#if hovered && hover?.row === ri}
						<span class="cursor" style="left:{tipPct}%"></span>
						<span
							class="tip"
							style="left:{tipPct}%;transform:translateX({tipShift});{ri === 0 ? 'top:32px' : 'bottom:32px'}"
						>
							<span class="tl num">{hovered.at}</span>
							{#if hovered.span}
								<span class="trow"><span class="tn">{hovered.span.label}</span><span class="tv num">{hovered.span.range}</span></span>
								<span class="trow muted"><span class="tn">duration</span><span class="tv num">{hovered.span.dur}</span></span>
							{:else}
								<span class="trow"><span class="tn">No signal</span></span>
							{/if}
							{#if hovered.missedNear}
								<span class="trow missrow"
									><span class="tn">{hovered.missedCount === 1 ? 'Missed call' : `${hovered.missedCount} missed calls`}</span><span class="tv num">{hovered.missedNear}</span></span
								>
							{/if}
						</span>
					{/if}
				</span>
				<span class="total num">{fmtHoursMinutes(lane.online_seconds)}</span>
			</div>
		{/each}

		<div class="xrow" aria-hidden="true">
			<span class="name"></span>
			<span class="xlane">
				{#each ticks as t}
					<span class="xtick num" style="left:{t.pct}%">{t.label}</span>
				{/each}
			</span>
			<span class="total-h">online</span>
		</div>
	</div>
	{/if}
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
	.none {
		padding: 26px 0 10px;
		text-align: center;
		font-size: 12.5px;
		color: var(--muted);
	}
	.dotk {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--danger);
	}
	/* Segment-height bars: a missed ring reads as an event slice through the lane,
	   the surface ring keeping it visible on top of any span colour. */
	.miss {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		border-radius: 3px;
		background: var(--danger);
		border: 1.5px solid var(--card);
		transform: translateX(-50%);
		z-index: 2;
		pointer-events: none;
	}
	.missrow .tn,
	.missrow .tv {
		color: var(--danger);
	}
	.scale {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.skey {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.mkey {
		border: none;
		background: transparent;
		padding: 2px 4px;
		margin: -2px -4px;
		border-radius: 6px;
		font: inherit;
		cursor: pointer;
	}
	.mkey:hover {
		background: var(--hover);
	}
	.mkey.off {
		opacity: 0.4;
	}
	.mkey.off .slab {
		text-decoration: line-through;
	}
	.swatch {
		width: 13px;
		height: 13px;
		border-radius: 3px;
	}
	.slab {
		font-size: 10.5px;
		color: var(--muted);
	}
	.grid {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: grid;
		grid-template-columns: 96px 1fr 64px;
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
	.lane {
		position: relative;
		display: block;
		height: 26px;
		border-radius: 5px;
		background: var(--track);
	}
	.span {
		position: absolute;
		top: 0;
		bottom: 0;
	}
	.cursor {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: var(--chart-axis);
		opacity: 0.7;
		pointer-events: none;
	}
	.total {
		text-align: right;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text);
	}
	.xrow {
		display: grid;
		grid-template-columns: 96px 1fr 64px;
		gap: 10px;
		margin-top: 2px;
	}
	.xlane {
		position: relative;
		height: 14px;
	}
	.xtick {
		position: absolute;
		transform: translateX(-50%);
		font-size: 9.5px;
		color: var(--chart-axis);
		white-space: nowrap;
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
