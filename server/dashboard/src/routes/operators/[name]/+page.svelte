<script lang="ts">
	import { page } from '$app/stores';
	import BandChart from '$lib/components/BandChart.svelte';
	import DailyTable from '$lib/components/DailyTable.svelte';
	import MeterColumns from '$lib/components/MeterColumns.svelte';
	import DateRangeControl from '$lib/components/DateRangeControl.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateEmpty from '$lib/components/StateEmpty.svelte';
	import StateError from '$lib/components/StateError.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import {
		capitalizeName,
		fmtAnswerRate,
		fmtHandle,
		fmtHoursDecimal,
		fmtHoursMinutes,
		fmtInt,
		fmtTimeToAnswer
	} from '$lib/format.formatter';
	import { AuthError } from '$lib/http';
	import { dailyCsvUrl, getMetrics, getOperators, getSummary } from '$lib/metrics.client';
	import type { MetricsResponse, OperatorSummary, Range } from '$lib/metrics.model';
	import { setRoster } from '$lib/palette.service';
	import { getOnlineSummary } from '$lib/presence.client';
	import type { OnlineSummaryResponse } from '$lib/presence.model';
	import { prettyRange, resolveRange, shortDay } from '$lib/range.service';
	import { toDailyRows } from '$lib/rows.service';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { topbar } from '$lib/stores/topbar.svelte';

	let status = $state<'loading' | 'ok' | 'empty' | 'notfound' | 'error'>('loading');
	let authErr = $state(false);
	let firstName = $state<string | null>(null);
	let op = $state<OperatorSummary | null>(null);
	let metrics = $state<MetricsResponse | null>(null);
	let online = $state<OnlineSummaryResponse | null>(null);

	// Operator identity is the first name (stats are merged by first name server-side).
	const opName = $derived($page.params.name ?? '');
	const range = $derived(resolveRange($page.url));

	// Guards against a slower, stale operator/range response overwriting a newer one.
	let loadGen = 0;
	async function load(id: string, r: Range): Promise<void> {
		const my = ++loadGen;
		status = 'loading';
		authErr = false;
		try {
			const [ops, summary, m, onl] = await Promise.all([
				getOperators(),
				getSummary(r.from, r.to),
				// Single-day views go HOURLY: one operator's 15-min slots are 0–2 calls,
				// which turns the average charts into gaps and confetti (see overview note).
				getMetrics(r.from, r.to, id, r.from === r.to ? 60 : undefined),
				// Best-effort: absent on older servers / for days before the history shipped.
				getOnlineSummary(r.from, r.to, id).catch(() => null)
			]);
			if (my !== loadGen) return; // a newer operator/range started loading — drop this
			setRoster(ops.operators.map((o) => o.first_name)); // shared colour identity (palette.service)
			const ref = ops.operators.find((o) => o.first_name === id);
			metrics = m;
			online = onl;
			op = summary.operators.find((o) => o.first_name === id) ?? null;
			firstName = ref?.first_name ?? op?.first_name ?? null;
			if (!ref && !op) status = 'notfound';
			else status = m.days.length === 0 ? 'empty' : 'ok';
		} catch (e) {
			if (my !== loadGen) return; // a newer load superseded this one — don't clobber it with an error
			authErr = e instanceof AuthError;
			status = 'error';
		}
	}

	$effect(() => {
		load(opName, range);
	});

	// Feed the shared TopBar (rendered by the layout); this page has no live poll.
	$effect(() => {
		topbar.onRefresh = () => load(opName, range);
		topbar.lastUpdated = null;
	});

	const name = $derived(firstName ? capitalizeName(firstName) : '');
	const days = $derived(metrics?.days ?? []);
	const labels = $derived(days.map((d) => d.label ?? shortDay(d.day)));
	// Single-day ranges return HOURLY rows (label set) — day-based subs don't apply.
	const hourly = $derived(days.length > 0 && days[0].label != null);
	// Days actually worked. The day series is densified (zero-filled) over the whole
	// range, so days.length is calendar length — a per-day average over it would
	// dilute anyone who doesn't work seven days a week.
	const activeDays = $derived(
		days.filter((d) => d.calls_received > 0 || d.available_seconds > 0).length
	);
	const belowTarget = $derived(op != null && op.answer_rate != null && op.answer_rate < prefs.answerTarget);
	const targetPct = $derived(Math.round(prefs.answerTarget * 100));
	const dailyRows = $derived(toDailyRows(days, prefs.answerTarget));

	// Active hours per day = Available + talk (sum_handle ≈ avg_handle × sample), matching
	// the server's active_seconds so the sparkline/trend agree with the summary KPI.
	const sActiveH = $derived(
		days.map(
			(d) =>
				(d.available_seconds + Math.round(((d.avg_handle_ms ?? 0) * d.handle_sample) / 1000)) / 3600
		)
	);
	const sReceived = $derived(days.map((d) => d.calls_received));
	const sAnswered = $derived(days.map((d) => d.calls_answered));
	const sAnswerPct = $derived(
		days.map((d) => (d.calls_received ? (d.calls_answered / d.calls_received) * 100 : null))
	);
	const sTtaSec = $derived(
		days.map((d) => (d.avg_time_to_answer_ms == null ? null : d.avg_time_to_answer_ms / 1000))
	);
	const sHandleMin = $derived(days.map((d) => (d.avg_handle_ms == null ? null : d.avg_handle_ms / 60000)));

	// Online hours/day (any-status presence) vs active — the schedule-adherence view.
	const sOnlineH = $derived.by(() => {
		if (!online) return [];
		const byDay = new Map(online.days.map((d) => [d.day, d.online_seconds]));
		return days.map((d) => (byDay.get(d.day) ?? 0) / 3600);
	});
	const showOnlineBand = $derived(!hourly && !!online && online.days.length > 0 && days.length > 1);
</script>


<main class="wrap">
	<div class="toolbar">
		<div class="left">
			<a class="back" href={'/trends' + $page.url.search}><Icon name="back" size={14} /> Trends</a>
			<span class="sep"></span>
			<span class="tname">{name || 'Operator'}</span>
		</div>
		<DateRangeControl />
	</div>

	{#if status === 'error'}
		<StateError auth={authErr} />
	{:else if status === 'loading'}
		<div class="kpirow">
			{#each Array(6) as _}<Skeleton height="118px" radius="12px" />{/each}
		</div>
		<Skeleton height="272px" radius="12px" />
		<Skeleton height="340px" radius="12px" />
	{:else if status === 'notfound'}
		<StateEmpty title="Operator not found" body="No operator matches this id." />
	{:else}
		<div class="header">
			<div class="htitle">{name || 'Operator'}</div>
			<div class="hsub">
				Individual call-handling performance · {prettyRange(range)}
				{#if belowTarget}<span class="hbelow">· below {targetPct}% answer-rate target</span>{/if}
			</div>
		</div>

		{#if status === 'empty' || !op}
			<StateEmpty
				body={`No call events recorded for ${name || 'this operator'} in ${prettyRange(range)}. Try widening the date range.`}
			/>
		{:else}
			<div class="kpirow">
				<KpiCard label="Active time" value={fmtHoursMinutes(op.active_seconds)} sub={hourly ? `${fmtHoursDecimal(op.active_seconds)} total` : `${fmtHoursDecimal(op.active_seconds)} total · ${activeDays} active days`} series={sActiveH} />
				<KpiCard label="Calls received" value={fmtInt(op.calls_received)} sub={hourly ? '' : `${activeDays ? Math.round(op.calls_received / activeDays) : 0}/day avg`} series={sReceived} />
				<KpiCard label="Calls answered" value={fmtInt(op.calls_answered)} sub={`${fmtInt(Math.max(0, op.calls_received - op.calls_answered))} not answered`} series={sAnswered} />
				<KpiCard label="Answer rate" value={fmtAnswerRate(op.answer_rate)} sub={`${fmtInt(op.calls_answered)} / ${fmtInt(op.calls_received)}`} series={sAnswerPct} yMax={100} />
				<KpiCard label="Avg time-to-answer" value={fmtTimeToAnswer(op.avg_time_to_answer_ms)} sub="ring → pickup" series={sTtaSec} />
				<KpiCard label="Avg handle time" value={fmtHandle(op.avg_handle_ms)} sub={`incl. wrap-up · n=${fmtInt(op.handle_sample)}`} series={sHandleMin} />
			</div>

			<!-- Full-width card → wider viewBox, or the SVG upscale makes the axis text huge. -->
			<BandChart answered={sAnswered} received={sReceived} {labels} subtitle={prettyRange(range)} W={1080} H={240} />

			{#if showOnlineBand}
				<MeterColumns
					subtitle={`hours per day · online = signed in with any status · ${prettyRange(range)}`}
					{labels}
					filled={sActiveH}
					total={sOnlineH}
				/>
			{/if}

			<div class="smallrow">
				<TrendChart title="Answer rate" subtitle="% of received answered" series={sAnswerPct} {labels} yMax={100} fmt={(v) => `${Math.round(v)}%`} />
				<TrendChart title="Avg time-to-answer" subtitle="seconds, ring → pickup" series={sTtaSec} {labels} fmt={(v) => `${Math.round(v)}s`} />
				<TrendChart title="Avg handle time" subtitle="minutes" series={sHandleMin} {labels} fmt={(v) => `${Math.round(v)}m`} footnote="Incl. wrap-up. Averaged over measured calls; sample varies by day." />
				<TrendChart title="Active hours" subtitle="hours/day (Available + talk)" series={sActiveH} {labels} fmt={(v) => `${Math.round(v)}h`} />
			</div>

			<DailyTable rows={dailyRows} csvHref={dailyCsvUrl(range.from, range.to, opName)} />
		{/if}
	{/if}
</main>

<style>
	.wrap {
		max-width: 1440px;
		margin: 0 auto;
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.toolbar {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin: -22px -22px 0;
		padding: 12px 22px;
		background: var(--card);
		border-bottom: 1px solid var(--card-border);
	}
	.left {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		font-weight: 600;
		color: var(--brand);
		text-decoration: none;
	}
	.sep {
		width: 1px;
		height: 18px;
		background: var(--card-border);
	}
	.tname {
		font-size: 14px;
		font-weight: 700;
		color: var(--text);
	}
	.header {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.htitle {
		font-size: 23px;
		font-weight: 700;
		color: var(--text);
	}
	.hsub {
		font-size: 13px;
		color: var(--label);
	}
	.hbelow {
		color: var(--amber);
	}
	.kpirow {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 13px;
	}
	.smallrow {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 13px;
	}
	@media (max-width: 1100px) {
		.kpirow {
			grid-template-columns: repeat(3, 1fr);
		}
		.smallrow {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 620px) {
		.kpirow {
			grid-template-columns: repeat(2, 1fr);
		}
		.smallrow {
			grid-template-columns: 1fr;
		}
	}
</style>
