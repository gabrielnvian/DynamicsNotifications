<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		fmtAnswerRate,
		fmtHandle,
		fmtHoursDecimal,
		fmtHoursMinutes,
		fmtInt,
		fmtPercent,
		fmtTimeToAnswer
	} from '$lib/format.formatter';
	import type { OperatorRow } from '$lib/metrics.model';
	import { prefs } from '$lib/stores/prefs.svelte';
	import Dropdown from './Dropdown.svelte';
	import Icon from './Icon.svelte';

	let { rows, palette }: { rows: OperatorRow[]; palette: (key: string) => string } = $props();

	type SortKey =
		| 'name'
		| 'online_seconds'
		| 'active_seconds'
		| 'calls_received'
		| 'calls_answered'
		| 'not_answered'
		| 'answer_rate'
		| 'avg_time_to_answer_ms'
		| 'avg_handle_ms';

	const BASE_COLS: { key: SortKey; label: string; align: 'l' | 'r' }[] = [
		{ key: 'name', label: 'Operator', align: 'l' },
		{ key: 'active_seconds', label: 'Active', align: 'r' },
		{ key: 'calls_received', label: 'Received', align: 'r' },
		{ key: 'calls_answered', label: 'Answered', align: 'r' },
		{ key: 'not_answered', label: 'Not answered', align: 'r' },
		{ key: 'answer_rate', label: 'Answer rate', align: 'r' },
		{ key: 'avg_time_to_answer_ms', label: 'Avg time to answer', align: 'r' },
		{ key: 'avg_handle_ms', label: 'Avg handle time', align: 'r' }
	];

	type BarMetric =
		| 'answer_rate'
		| 'unanswered_rate'
		| 'calls_answered'
		| 'calls_received'
		| 'active_hours'
		| 'avg_handle_ms'
		| 'avg_time_to_answer_ms';

	const BAR_LABELS: Record<BarMetric, string> = {
		answer_rate: 'Answer rate',
		unanswered_rate: 'Unanswered rate',
		calls_answered: 'Calls answered',
		calls_received: 'Calls received',
		active_hours: 'Active hours',
		avg_handle_ms: 'Avg handle time',
		avg_time_to_answer_ms: 'Avg time-to-answer'
	};
	const BAR_OPTIONS = Object.entries(BAR_LABELS).map(([value, label]) => ({ value, label }));

	let search = $state('');
	let sortKey = $state<SortKey>('calls_answered');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let view = $state<'table' | 'bars'>('table');
	let barMetric = $state<BarMetric>('answer_rate');

	function sortVal(r: OperatorRow, k: SortKey): number | string | null {
		return k === 'name' ? r.name.toLowerCase() : r[k];
	}
	function compare(a: OperatorRow, b: OperatorRow): number {
		const av = sortVal(a, sortKey);
		const bv = sortVal(b, sortKey);
		if (av == null && bv == null) return 0;
		if (av == null) return 1; // nulls always last
		if (bv == null) return -1;
		const c =
			typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
		return sortDir === 'asc' ? c : -c;
	}
	function sortBy(k: SortKey): void {
		if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = k;
			sortDir = k === 'name' ? 'asc' : 'desc';
		}
	}
	function ariaSort(k: SortKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== k) return 'none';
		return sortDir === 'asc' ? 'ascending' : 'descending';
	}

	function barValue(r: OperatorRow, m: BarMetric): number | null {
		if (m === 'active_hours') return r.active_seconds / 3600;
		if (m === 'unanswered_rate') return r.unanswered_rate;
		return r[m];
	}
	function barText(r: OperatorRow, m: BarMetric): string {
		const v = barValue(r, m);
		if (m === 'answer_rate' || m === 'unanswered_rate') return fmtPercent(v);
		if (m === 'active_hours') return fmtHoursDecimal(r.active_seconds);
		if (m === 'avg_handle_ms') return fmtHandle(r.avg_handle_ms);
		if (m === 'avg_time_to_answer_ms') return fmtTimeToAnswer(r.avg_time_to_answer_ms);
		return fmtInt(v);
	}

	function open(r: OperatorRow): void {
		// Carry the current range query into the detail view.
		goto(`/operators/${encodeURIComponent(r.first_name)}${$page.url.search}`);
	}
	function rowKey(e: KeyboardEvent, r: OperatorRow): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open(r);
		}
	}

	const target = $derived(prefs.answerTarget);
	const targetPct = $derived(Math.round(target * 100));
	const belowCount = $derived(rows.filter((r) => r.belowTarget).length);

	// "Online" (any-status presence) only exists from the day the history log shipped —
	// show the column only when the range actually has data, next to Active so the
	// online-vs-active gap reads side by side.
	const hasOnline = $derived(rows.some((r) => r.online_seconds != null));
	const COLS = $derived(
		hasOnline
			? [BASE_COLS[0], { key: 'online_seconds' as SortKey, label: 'Online', align: 'r' as const }, ...BASE_COLS.slice(1)]
			: BASE_COLS
	);

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter(
			(r) => r.name.toLowerCase().includes(q)
		);
	});
	const sorted = $derived([...filtered].sort(compare));
	const bars = $derived(
		[...filtered]
			.map((r) => ({ r, v: barValue(r, barMetric) }))
			.sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
	);
	const barMax = $derived(Math.max(1, ...bars.map((b) => b.v ?? 0)));

	// Rates draw on an absolute 0–100% track (normalising to the best operator
	// exaggerates small gaps and hides where the target sits); counts and durations
	// keep the max-normalised track. The answer-rate view also gets a target tick.
	const isRate = $derived(barMetric === 'answer_rate' || barMetric === 'unanswered_rate');
	const barDenom = $derived(isRate ? 1 : barMax);
	const showTargetTick = $derived(barMetric === 'answer_rate');
</script>

<div class="card">
	<div class="toolbar">
		<div class="left">
			<span class="title">Operators</span>
			<span class="count">
				{filtered.length === rows.length
					? `${rows.length} operators`
					: `${filtered.length} of ${rows.length}`}
			</span>
			{#if belowCount > 0}
				<span class="chip"><span class="dot"></span>{belowCount} below {targetPct}%</span>
			{/if}
		</div>
		<div class="right">
			<label class="search">
				<Icon name="search" size={14} />
				<input type="search" placeholder="Search name" bind:value={search} />
			</label>
			<div class="seg" role="group" aria-label="View">
				<button class:active={view === 'table'} onclick={() => (view = 'table')}>
					<Icon name="table" size={14} /> Table
				</button>
				<button class:active={view === 'bars'} onclick={() => (view = 'bars')}>
					<Icon name="bars" size={14} /> Bars
				</button>
			</div>
		</div>
	</div>

	{#if filtered.length === 0}
		<div class="none">No operators match “{search}”.</div>
	{:else if view === 'table'}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						{#each COLS as c}
							<th class:r={c.align === 'r'} aria-sort={ariaSort(c.key)}>
								<button type="button" class="th-btn" onclick={() => sortBy(c.key)}>
									{c.label}{#if sortKey === c.key}<span class="caret">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sorted as r (r.first_name)}
						<tr
							class="row"
							role="button"
							tabindex="0"
							aria-label={`View ${r.name}`}
							onclick={() => open(r)}
							onkeydown={(e) => rowKey(e, r)}
						>
							<td>
								<span class="op">
									<span class="odot" style="background:{palette(r.first_name)}"></span>
									<span class="oname">{r.name}</span>
								</span>
							</td>
							{#if hasOnline}
								<td class="r soft tabular">{r.online_seconds == null ? '—' : fmtHoursMinutes(r.online_seconds)}</td>
							{/if}
							<td class="r soft tabular">{fmtHoursMinutes(r.active_seconds)}</td>
							<td class="r soft tabular">{fmtInt(r.calls_received)}</td>
							<td class="r strong tabular">{fmtInt(r.calls_answered)}</td>
							<td class="r faint tabular">{fmtInt(r.not_answered)}</td>
							<td class="r strong tabular" class:below={r.belowTarget}>
								{#if r.belowTarget}<span class="bdot"></span>{/if}{fmtAnswerRate(r.answer_rate)}
							</td>
							<td class="r soft tabular">{fmtTimeToAnswer(r.avg_time_to_answer_ms)}</td>
							<td class="r soft tabular">
								{fmtHandle(r.avg_handle_ms)}
								{#if r.avg_handle_ms != null}<span class="n">avg of {fmtInt(r.handle_sample)} calls</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="bars">
			<span class="cmp">
				Compare by
				<Dropdown
					value={barMetric}
					options={BAR_OPTIONS}
					onChange={(v) => (barMetric = v as BarMetric)}
					ariaLabel="Compare by"
				/>
			</span>
			<div class="barlist">
				{#each bars as { r, v } (r.first_name)}
					<button class="bar" onclick={() => open(r)} aria-label={`View ${r.name}`}>
						<span class="blabel">
							<span class="odot" style="background:{palette(r.first_name)}"></span>
							<span class="oname">{r.name}</span>
						</span>
						<span class="track">
							<span
								class="fill"
								style="width:{v == null ? 0 : Math.min(100, Math.round((v / barDenom) * 100))}%;background:{palette(r.first_name)}"
							></span>
							{#if showTargetTick}<span class="tick" style="left:{targetPct}%" title="{targetPct}% target"></span>{/if}
						</span>
						<span class="bval tabular">{barText(r, barMetric)}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 12px;
		box-shadow: var(--card-shadow);
		overflow: hidden;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 12px 14px;
		border-bottom: 1px solid var(--divider);
	}
	.left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}
	.count {
		font-size: 13px;
		color: var(--faint);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--amber);
		background: color-mix(in srgb, var(--amber) 10%, transparent);
		border-radius: 20px;
		padding: 2px 9px;
	}
	.chip .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--amber);
	}
	.right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--card-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--faint);
	}
	.search input {
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--text);
		width: 140px;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--card-border);
		border-radius: 8px;
		overflow: hidden;
	}
	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: none;
		background: var(--card);
		color: var(--text-soft);
		font: inherit;
		font-size: 13px;
		padding: 6px 10px;
		cursor: pointer;
	}
	.seg button.active {
		background: var(--brand);
		color: #fff;
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
		text-align: left;
		padding: var(--row-pad);
		white-space: nowrap;
	}
	th.r {
		text-align: right;
	}
	.th-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
	}
	.th-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-radius: 3px;
	}
	.caret {
		color: var(--brand);
		margin-left: 4px;
		font-size: 9px;
	}
	tbody td {
		padding: var(--row-pad);
		border-bottom: 1px solid var(--divider);
		font-size: 13px;
		color: var(--text-soft);
		white-space: nowrap;
	}
	td.r {
		text-align: right;
	}
	td.soft {
		color: var(--text-soft);
	}
	td.strong {
		color: var(--text);
		font-weight: 600;
	}
	td.faint {
		color: var(--faint);
	}
	td.below {
		color: var(--amber);
	}
	.bdot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--amber);
		margin-right: 5px;
	}
	.n {
		color: var(--faint);
		font-size: 11px;
		margin-left: 4px;
	}
	.row {
		cursor: pointer;
	}
	.row:hover {
		background: var(--hover);
	}
	.op {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.odot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.oname {
		font-weight: 600;
		color: var(--text);
	}
	.none {
		padding: 40px;
		text-align: center;
		color: var(--muted);
		font-size: 14px;
	}
	.bars {
		padding: 14px;
	}
	.cmp {
		font-size: 12px;
		color: var(--muted);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.bar {
		display: grid;
		grid-template-columns: 150px 1fr 72px;
		align-items: center;
		gap: 10px;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 2px 0;
		font: inherit;
		text-align: left;
	}
	.bar:hover .oname {
		text-decoration: underline;
	}
	.blabel {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}
	.track {
		position: relative;
		height: 12px;
		background: var(--track);
		border-radius: 4px;
		overflow: hidden;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--amber);
		opacity: 0.9;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 4px;
	}
	.bval {
		text-align: right;
		font-size: 12.5px;
		color: var(--text-soft);
	}
</style>
