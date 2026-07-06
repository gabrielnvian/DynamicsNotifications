<script lang="ts">
	import {
		fmtAnswerRate,
		fmtHandle,
		fmtHoursMinutes,
		fmtInt,
		fmtSlotRange,
		fmtTimeToAnswer
	} from '$lib/format.formatter';
	import type { DailyRow } from '$lib/metrics.model';
	import Icon from './Icon.svelte';

	let { rows, csvHref = '' }: { rows: DailyRow[]; csvHref?: string } = $props();

	type DailyKey =
		| 'day'
		| 'active_seconds'
		| 'calls_received'
		| 'calls_answered'
		| 'not_answered'
		| 'uncovered_seconds'
		| 'answer_rate'
		| 'avg_time_to_answer_ms'
		| 'avg_handle_ms';

	const BASE_COLS: { key: DailyKey; label: string; align: 'l' | 'r' }[] = [
		{ key: 'day', label: 'Day', align: 'l' },
		{ key: 'active_seconds', label: 'Active', align: 'r' },
		{ key: 'calls_received', label: 'Received', align: 'r' },
		{ key: 'calls_answered', label: 'Answered', align: 'r' },
		{ key: 'not_answered', label: 'Not answered', align: 'r' },
		{ key: 'answer_rate', label: 'Answer rate', align: 'r' },
		{ key: 'avg_time_to_answer_ms', label: 'Avg time to answer', align: 'r' },
		{ key: 'avg_handle_ms', label: 'Avg talk time', align: 'r' }
	];

	// Coverage column only where the server sends it (single-day team view) — it's
	// the table twin of the chart's "no one available" shading.
	const UNCOV_COL = { key: 'uncovered_seconds', label: 'No one available', align: 'r' } as const;
	const hasUncovered = $derived(rows.some((r) => r.uncovered_seconds != null));
	const cols = $derived(
		hasUncovered ? [...BASE_COLS.slice(0, 5), UNCOV_COL, ...BASE_COLS.slice(5)] : BASE_COLS
	);

	let sortKey = $state<DailyKey>('day');
	let sortDir = $state<'asc' | 'desc'>('asc');

	// Single-day views deliver INTRADAY rows (a `label` like "13:15"); everything else
	// is per-day. Every intraday row shares the same `day`, so key/sort on label when
	// present. The bucket size is inferred from consecutive labels (15/30/60 min).
	const hourly = $derived(rows.length > 0 && rows[0].label != null);
	const stepMin = $derived.by(() => {
		if (!hourly || rows.length < 2) return 60;
		const toMin = (l: string) => Number(l.slice(0, 2)) * 60 + Number(l.slice(3, 5));
		return Math.max(1, toMin(rows[1].label ?? '') - toMin(rows[0].label ?? ''));
	});
	function sortVal(r: DailyRow, k: DailyKey): number | string | null {
		// `?? null`: uncovered_seconds is optional — absent sorts last like other nulls.
		return k === 'day' ? (r.label ?? r.day) : (r[k] ?? null);
	}
	function compare(a: DailyRow, b: DailyRow): number {
		const av = sortVal(a, sortKey);
		const bv = sortVal(b, sortKey);
		if (av == null && bv == null) return 0;
		if (av == null) return 1; // nulls last
		if (bv == null) return -1;
		const c =
			typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
		return sortDir === 'asc' ? c : -c;
	}
	function sortBy(k: DailyKey): void {
		if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = k;
			sortDir = k === 'day' ? 'asc' : 'desc';
		}
	}
	function ariaSort(k: DailyKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== k) return 'none';
		return sortDir === 'asc' ? 'ascending' : 'descending';
	}

	const sorted = $derived([...rows].sort(compare));
</script>

<div class="card">
	<div class="head">
		<div class="left">
			<span class="title">
				{hourly ? (stepMin === 60 ? 'Hourly breakdown' : `${stepMin}-minute breakdown`) : 'Daily breakdown'}
			</span>
			<span class="count">{rows.length} {hourly ? (stepMin === 60 ? 'hours' : 'slots') : 'days'}</span>
		</div>
		{#if csvHref}
			<a class="csv" href={csvHref} download>
				<Icon name="download" size={14} /> Export CSV
			</a>
		{/if}
	</div>

	<div class="scroll">
		<table>
			<thead>
				<tr>
					{#each cols as c}
						<th class:r={c.align === 'r'} aria-sort={ariaSort(c.key)}>
							<button type="button" class="th-btn" onclick={() => sortBy(c.key)}>
								{c.key === 'day' && hourly ? 'Time' : c.label}{#if sortKey === c.key}<span class="caret">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each sorted as r (r.label ?? r.day)}
					<tr class:weekend={!hourly && r.weekend}>
						<td>
							{#if hourly}
								<span class="day">{fmtSlotRange(r.label ?? '', stepMin)}</span>
							{:else}
								<span class="day">{r.dayLabel}</span>
								<span class="wd">{r.weekday}</span>
							{/if}
						</td>
						<td class="r soft tabular">{fmtHoursMinutes(r.active_seconds)}</td>
						<td class="r soft tabular">{fmtInt(r.calls_received)}</td>
						<td class="r strong tabular">{fmtInt(r.calls_answered)}</td>
						<td class="r faint tabular">{fmtInt(r.not_answered)}</td>
						{#if hasUncovered}
							<td class="r tabular" class:uncov={(r.uncovered_seconds ?? 0) >= 60} class:faint={(r.uncovered_seconds ?? 0) < 60}>
								{fmtHoursMinutes(r.uncovered_seconds ?? 0)}
							</td>
						{/if}
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
</div>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 12px;
		box-shadow: var(--card-shadow);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
	.csv {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--brand);
		text-decoration: none;
		border: 1px solid var(--card-border);
		border-radius: 8px;
		padding: 6px 10px;
	}
	.csv:hover {
		background: var(--hover);
	}
	.scroll {
		max-height: 520px;
		overflow: auto;
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
	td.uncov {
		color: var(--danger);
		font-weight: 600;
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
	.day {
		color: var(--text);
		font-weight: 500;
	}
	.wd {
		color: var(--faint);
		font-size: 11.5px;
		margin-left: 6px;
	}
	tr.weekend td {
		color: var(--faint);
	}
	tr.weekend .day {
		color: var(--faint);
		font-weight: 400;
	}
</style>
