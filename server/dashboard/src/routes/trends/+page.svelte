<script lang="ts">
	// TRENDS — "how are we doing over time?" Range-scoped (default: last 7 days):
	// KPIs with period-over-period deltas, calls band, answer-rate trend, active-vs-
	// online band, hour-of-day heatmap, daily table. "Now" lives on /, ranking on
	// /operators.
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import BandChart from '$lib/components/BandChart.svelte';
	import ComparisonTable from '$lib/components/ComparisonTable.svelte';
	import DailyTable from '$lib/components/DailyTable.svelte';
	import DateRangeControl from '$lib/components/DateRangeControl.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import MeterColumns from '$lib/components/MeterColumns.svelte';
	import OperatorHeatmap from '$lib/components/OperatorHeatmap.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateEmpty from '$lib/components/StateEmpty.svelte';
	import StateError from '$lib/components/StateError.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import {
		fmtAnswerRate,
		fmtClock,
		fmtHandle,
		fmtHoursDecimal,
		fmtInt,
		fmtTimeToAnswer
	} from '$lib/format.formatter';
	import { AuthError } from '$lib/http';
	import { getIntraday, getMetrics, getSummary, summaryCsvUrl } from '$lib/metrics.client';
	import type {
		IntradayResponse,
		MetricsResponse,
		Range,
		SummaryResponse
	} from '$lib/metrics.model';
	import { colorFor } from '$lib/palette.service';
	import { getOnlineSummary } from '$lib/presence.client';
	import type { OnlineSummaryResponse } from '$lib/presence.model';
	import {
		previousWindow,
		prettyRangeShort,
		resolveRange,
		shortDay
	} from '$lib/range.service';
	import { ensureRoster } from '$lib/roster.service';
	import { toDailyRows, toOperatorRows } from '$lib/rows.service';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { topbar } from '$lib/stores/topbar.svelte';

	type Delta = { text: string; dir: -1 | 0 | 1 };

	let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
	let authErr = $state(false);
	let summary = $state<SummaryResponse | null>(null);
	let prev = $state<SummaryResponse | null>(null);
	let metrics = $state<MetricsResponse | null>(null);
	let intraday = $state<IntradayResponse | null>(null);
	let online = $state<OnlineSummaryResponse | null>(null);

	const range = $derived(resolveRange($page.url, 'last7'));

	// Guard against a slower, stale range's response overwriting a newer one.
	let loadGen = 0;
	async function load(r: Range): Promise<void> {
		const my = ++loadGen;
		status = 'loading';
		authErr = false;
		const pw = previousWindow(r);
		const singleDay = r.from === r.to; // custom pickers allow one — charts go hourly
		try {
			const [s, p, m, intra, onl] = await Promise.all([
				getSummary(r.from, r.to),
				getSummary(pw.from, pw.to),
				getMetrics(r.from, r.to, undefined, singleDay ? 60 : undefined),
				getIntraday(r.from, r.to, singleDay ? 15 : 60).catch(() => null),
				getOnlineSummary(r.from, r.to).catch(() => null),
				ensureRoster()
			]);
			if (my !== loadGen) return;
			summary = s;
			prev = p;
			metrics = m;
			intraday = intra;
			online = onl;
			status = s.operators.length === 0 ? 'empty' : 'ok';
		} catch (e) {
			if (my !== loadGen) return;
			authErr = e instanceof AuthError;
			status = 'error';
		}
	}

	$effect(() => {
		load(range);
	});
	$effect(() => {
		topbar.onRefresh = () => load(range);
		topbar.lastUpdated = null; // no live element on this page
	});

	const team = $derived(summary?.team ?? null);
	const prevTeam = $derived(prev?.team ?? null);
	const onlineByName = $derived(
		online ? new Map(online.operators.map((o) => [o.first_name, o.online_seconds])) : undefined
	);
	const rows = $derived(
		summary ? toOperatorRows(summary.operators, prefs.answerTarget, onlineByName) : []
	);
	const days = $derived(metrics?.days ?? []);
	const labels = $derived(days.map((d) => (d.label ? fmtClock(d.label) : shortDay(d.day))));
	const dailyRows = $derived(toDailyRows(days, prefs.answerTarget));
	const singleDayView = $derived(range.from === range.to);

	const sReceived = $derived(days.map((d) => d.calls_received));
	const sAnswered = $derived(days.map((d) => d.calls_answered));
	const sMissed = $derived(days.map((d) => Math.max(0, d.calls_received - d.calls_answered)));
	const sAnswerPct = $derived(
		days.map((d) => (d.calls_received ? (d.calls_answered / d.calls_received) * 100 : null))
	);
	const sTtaSec = $derived(
		days.map((d) => (d.avg_time_to_answer_ms == null ? null : d.avg_time_to_answer_ms / 1000))
	);
	const sHandleMin = $derived(days.map((d) => (d.avg_handle_ms == null ? null : d.avg_handle_ms / 60000)));
	const sActiveH = $derived(days.map((d) => d.active_seconds / 3600));
	const sOnlineH = $derived.by(() => {
		if (!online) return [];
		const byDay = new Map(online.days.map((d) => [d.day, d.online_seconds]));
		return days.map((d) => (byDay.get(d.day) ?? 0) / 3600);
	});
	const showOnlineBand = $derived(
		!singleDayView && !!online && online.days.length > 0 && days.length > 1
	);

	// The boss question, pre-assembled (usability review: "one sentence at the top").
	const targetPct = $derived(Math.round(prefs.answerTarget * 100));
	const teamBelow = $derived(
		!!team && team.answer_rate != null && team.answer_rate < prefs.answerTarget
	);

	// Period-over-period deltas vs the immediately-preceding equal-length window.
	// Neutral (up/down only); hidden on a single partial day.
	const showDeltas = $derived(!singleDayView);
	const pw = $derived(previousWindow(range));

	function delta(cur: number | null, pv: number | null): Delta {
		if (cur == null || pv == null || pv === 0) return { text: '—', dir: 0 };
		const d = ((cur - pv) / pv) * 100;
		return { text: `${Math.abs(d).toFixed(1)}%`, dir: d > 0.05 ? 1 : d < -0.05 ? -1 : 0 };
	}
	function deltaPp(cur: number | null, pv: number | null): Delta {
		if (cur == null || pv == null) return { text: '—', dir: 0 };
		const d = (cur - pv) * 100;
		return { text: `${Math.abs(d).toFixed(1)} pts`, dir: d > 0.05 ? 1 : d < -0.05 ? -1 : 0 };
	}

	const showIntraday = $derived.by(() => {
		if (!intraday || intraday.operators.length === 0 || intraday.labels.length <= 1) return false;
		return (intraday.from ?? intraday.day) === range.from && (intraday.to ?? intraday.day) === range.to;
	});
	const heatSubtitle = $derived.by(() => {
		if (!intraday) return '';
		const slots = intraday.slotMinutes === 60 ? 'by hour of day' : `${intraday.slotMinutes}-min slots`;
		const summed = singleDayView ? '' : ' · summed across days';
		return `${slots}${summed} · ${prettyRangeShort(range)} · click a row for detail`;
	});

	function resetRange(): void {
		goto($page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<main class="wrap">
	<div class="toolbar">
		<span class="rlabel">{prettyRangeShort(range)}</span>
		<div class="tools">
			<DateRangeControl presetKeys={['last7', 'last30', 'month']} defaultKey="last7" />
			<a class="csv" href={summaryCsvUrl(range.from, range.to)} download title="Export operator summary CSV">
				<Icon name="download" size={15} /> Export for Excel
			</a>
		</div>
	</div>

	{#if status === 'error'}
		<StateError auth={authErr} />
	{:else if status === 'loading'}
		<div class="kpirow">
			{#each Array(5) as _}<Skeleton height="116px" radius="16px" />{/each}
		</div>
		<div class="charts">
			<Skeleton height="252px" radius="18px" />
			<Skeleton height="252px" radius="18px" />
		</div>
		<Skeleton height="240px" radius="18px" />
	{:else if status === 'empty'}
		<StateEmpty
			body={`There are no call events recorded for ${prettyRangeShort(range)}. Try widening the date range.`}
			onReset={resetRange}
		/>
	{:else if team}
		{#if team.calls_received > 0 && team.answer_rate != null}
			<div class="headline">
				{prettyRangeShort(range)}: <b>{fmtInt(team.calls_answered)} of {fmtInt(team.calls_received)}</b>
				calls answered (<b>{fmtAnswerRate(team.answer_rate)}</b>) —
				<span class="verdict" class:bad={teamBelow}>
					{teamBelow ? `below the ${targetPct}% target` : `meets the ${targetPct}% target`}
				</span>
			</div>
		{/if}

		<div class="kpirow">
			<KpiCard
				label="Not answered"
				value={fmtInt(Math.max(0, team.calls_received - team.calls_answered))}
				delta={showDeltas
					? delta(
							team.calls_received - team.calls_answered,
							prevTeam ? prevTeam.calls_received - prevTeam.calls_answered : null
						)
					: undefined}
				series={sMissed}
			/>
			<KpiCard
				label="Answer rate"
				value={fmtAnswerRate(team.answer_rate)}
				delta={showDeltas ? deltaPp(team.answer_rate, prevTeam?.answer_rate ?? null) : undefined}
				series={sAnswerPct}
				yMax={100}
			/>
			<KpiCard
				label="Avg time to answer"
				value={fmtTimeToAnswer(team.avg_time_to_answer_ms)}
				delta={showDeltas
					? delta(team.avg_time_to_answer_ms, prevTeam?.avg_time_to_answer_ms ?? null)
					: undefined}
				series={sTtaSec}
			/>
			<KpiCard
				label="Avg handle"
				value={fmtHandle(team.avg_handle_ms)}
				delta={showDeltas ? delta(team.avg_handle_ms, prevTeam?.avg_handle_ms ?? null) : undefined}
				series={sHandleMin}
			/>
			<KpiCard
				label="Active hours"
				value={fmtHoursDecimal(team.active_seconds)}
				delta={showDeltas ? delta(team.active_seconds, prevTeam?.active_seconds ?? null) : undefined}
				series={sActiveH}
			/>
		</div>
		{#if showDeltas}
			<div class="kpinote num">change vs {prettyRangeShort(pw)}</div>
		{/if}

		<div class="charts">
			<BandChart answered={sAnswered} received={sReceived} {labels} subtitle={`per ${singleDayView ? 'hour' : 'day'} · ${prettyRangeShort(range)}`} />
			<TrendChart
				title="Answer rate"
				subtitle={`percent per ${singleDayView ? 'hour' : 'day'}`}
				series={sAnswerPct}
				{labels}
				yMax={100}
				fmt={(v) => `${Math.round(v)}%`}
				target={targetPct}
				targetLabel={`${targetPct}% target`}
				detail={(i) => `${sAnswered[i]} of ${sReceived[i]} answered`}
			/>
		</div>

		{#if showOnlineBand}
			<MeterColumns
				subtitle={`total hours across all operators, per day · online = signed in with any status · ${prettyRangeShort(range)}`}
				{labels}
				filled={sActiveH}
				total={sOnlineH}
			/>
		{/if}

		{#if showIntraday && intraday}
			<OperatorHeatmap
				title="Calls answered by operator"
				subtitle={heatSubtitle}
				labels={intraday.labels}
				operators={intraday.operators}
				slotMinutes={intraday.slotMinutes}
			/>
		{/if}

		<ComparisonTable {rows} palette={colorFor} />

		<DailyTable rows={dailyRows} />
	{/if}
</main>

<style>
	.wrap {
		max-width: 1360px;
		margin: 0 auto;
		padding: 26px 26px 60px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.rlabel {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--muted);
	}
	.tools {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.csv {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 38px;
		padding: 0 13px;
		border-radius: 11px;
		border: 1px solid var(--card-border);
		background: var(--input-bg);
		color: var(--text-soft);
		font-size: 12.5px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.csv:hover {
		color: var(--text);
		border-color: color-mix(in srgb, var(--brand) 45%, var(--card-border));
	}
	.headline {
		font-size: 14.5px;
		color: var(--text-soft);
	}
	.headline b {
		color: var(--text);
	}
	.verdict {
		font-weight: 600;
		color: var(--live);
	}
	.verdict.bad {
		color: var(--amber);
	}
	.kpirow {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 14px;
	}
	.kpinote {
		margin-top: -12px;
		text-align: right;
		font-size: 10.5px;
		color: var(--faint);
	}
	.charts {
		display: grid;
		grid-template-columns: 1.55fr 1fr;
		gap: 16px;
	}
	@media (max-width: 1000px) {
		.charts {
			grid-template-columns: 1fr;
		}
		.kpirow {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
