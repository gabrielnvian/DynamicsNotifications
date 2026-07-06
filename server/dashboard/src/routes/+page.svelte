<script lang="ts">
	// OVERVIEW — one day-scoped board. Defaults to TODAY (live: presence poll, LIVE
	// pill, auto-refresh); pick another day in the toolbar and the same board becomes
	// a static review of that day (?day=…, linkable). Multi-day trends live on
	// /trends, per-operator ranking on /operators.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AnswerPanel from '$lib/components/AnswerPanel.svelte';
	import BandChart from '$lib/components/BandChart.svelte';
	import DailyTable from '$lib/components/DailyTable.svelte';
	import DayPicker from '$lib/components/DayPicker.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import LiveHero from '$lib/components/LiveHero.svelte';
	import OperatorHeatmap from '$lib/components/OperatorHeatmap.svelte';
	import PresenceTimeline from '$lib/components/PresenceTimeline.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateEmpty from '$lib/components/StateEmpty.svelte';
	import StateError from '$lib/components/StateError.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import {
		fmtAnswerRate,
		fmtClock,
		fmtHandle,
		fmtHoursDecimal,
		fmtHoursMinutes,
		fmtInt,
		fmtTimeToAnswer
	} from '$lib/format.formatter';
	import { AuthError } from '$lib/http';
	import { getIntraday, getMetrics, getSummary } from '$lib/metrics.client';
	import type { IntradayResponse, MetricsResponse, SummaryResponse } from '$lib/metrics.model';
	import { getPresence, getPresenceTimeline } from '$lib/presence.client';
	import type { PresenceResponse, PresenceTimelineResponse } from '$lib/presence.model';
	import { shortDay, todayRange } from '$lib/range.service';
	import { ensureRoster } from '$lib/roster.service';
	import { toDailyRows } from '$lib/rows.service';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { topbar } from '$lib/stores/topbar.svelte';

	// Presence changes second-to-second; the aggregates only move when a batch lands.
	// Both polls only run while the board shows today — a past day is static.
	const PRESENCE_POLL_MS = 5_000;
	const DATA_POLL_MS = 30_000;

	const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
	const day = $derived.by(() => {
		const q = $page.url.searchParams.get('day');
		return q && DAY_RE.test(q) ? q : todayRange().from;
	});
	const isToday = $derived(day === todayRange().from);

	let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
	let authErr = $state(false);
	let summary = $state<SummaryResponse | null>(null);
	let metrics = $state<MetricsResponse | null>(null);
	let presence = $state<PresenceResponse | null>(null);
	let intraday = $state<IntradayResponse | null>(null);
	let timeline = $state<PresenceTimelineResponse | null>(null);
	let lastUpdated = $state<number | null>(null);

	// Guard against a slower, stale day's response overwriting a newer one.
	let loadGen = 0;
	async function load(d: string, silent = false): Promise<void> {
		const my = ++loadGen;
		if (!silent) status = 'loading';
		authErr = false;
		const live = d === todayRange().from;
		try {
			const [s, m, pres, intra, tl] = await Promise.all([
				getSummary(d, d),
				getMetrics(d, d, undefined, 60), // hourly lines/table; 15-min lives in the heatmap
				live ? getPresence().catch(() => null) : Promise.resolve(null), // on-shift is a "now" fact
				getIntraday(d, d, 15).catch(() => null),
				getPresenceTimeline(d).catch(() => null),
				ensureRoster() // shared operator colours must be assigned before first paint
			]);
			if (my !== loadGen) return;
			summary = s;
			metrics = m;
			presence = pres;
			intraday = intra;
			timeline = tl;
			lastUpdated = Date.now();
			status = s.operators.length === 0 ? 'empty' : 'ok';
		} catch (e) {
			if (my !== loadGen) return;
			authErr = e instanceof AuthError;
			status = 'error';
		}
	}

	async function pollPresence(): Promise<void> {
		if (!isToday) return;
		const pres = await getPresence().catch(() => null);
		if (!pres) return;
		presence = pres;
		lastUpdated = Date.now();
	}

	$effect(() => {
		load(day);
	});
	$effect(() => {
		topbar.onRefresh = () => load(day);
		topbar.lastUpdated = isToday ? lastUpdated : null; // LIVE pill is a today-only fact
	});

	onMount(() => {
		const tp = setInterval(pollPresence, PRESENCE_POLL_MS);
		const td = setInterval(() => {
			if (isToday) load(day, true);
		}, DATA_POLL_MS);
		return () => {
			clearInterval(tp);
			clearInterval(td);
		};
	});

	function setDay(d: string): void {
		const u = new URL($page.url);
		if (d === todayRange().from) u.searchParams.delete('day'); // clean URL for the default
		else u.searchParams.set('day', d);
		goto(`${u.pathname}${u.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const team = $derived(summary?.team ?? null);
	const days = $derived(metrics?.days ?? []);
	const labels = $derived(days.map((d) => (d.label ? fmtClock(d.label) : shortDay(d.day))));
	const dailyRows = $derived(toDailyRows(days, prefs.answerTarget));
	const targetPct = $derived(Math.round(prefs.answerTarget * 100));
	const dayLabel = $derived(isToday ? 'today' : shortDay(day));

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

	// Coverage: time with ZERO operators available while anyone was on shift — those
	// callers went to voicemail without ringing, so the call counts above can't see
	// them. Slot series from /v1/metrics; the day total from the timeline's coverage
	// (same gap set, so the two always agree). null total = no presence history
	// (before 2026-07-04) → "—", not a false zero.
	const sUncovered = $derived(
		days.some((d) => d.uncovered_seconds != null) ? days.map((d) => d.uncovered_seconds ?? 0) : null
	);
	const sUncoveredMin = $derived(sUncovered ? sUncovered.map((s) => s / 60) : []);
	const coverage = $derived(timeline?.coverage ?? null);
	const uncoveredTotal = $derived(
		coverage && coverage.staffed_start_ms != null ? coverage.uncovered_seconds : null
	);

	// On shift = operators currently taking calls (available / on a call), of those reporting.
	const onShift = $derived(
		isToday && presence
			? presence.operators.filter((o) => o.status === 'available' || o.status === 'on_call').length
			: null
	);
	const rosterCount = $derived(presence?.operators.length ?? team?.operator_count ?? 0);

	const showIntraday = $derived(
		!!intraday && intraday.operators.length > 0 && intraday.labels.length > 1
	);
	const showTimeline = $derived(
		!!timeline && timeline.operators.length > 0 && timeline.day === day
	);

	// Hourly buckets exclude late-synced batches (they can't be placed at an honest
	// hour); the KPI totals include them. When the two actually differ, say so —
	// otherwise the same screen shows two "totals" that disagree with no explanation.
	const lateSync = $derived.by(() => {
		if (!team || days.length === 0) return false;
		const recv = days.reduce((a, d) => a + d.calls_received, 0);
		const ans = days.reduce((a, d) => a + d.calls_answered, 0);
		return recv !== team.calls_received || ans !== team.calls_answered;
	});
</script>

<main class="wrap">
	<div class="toolbar">
		<span class="rlabel">{isToday ? 'Today' : shortDay(day)}</span>
		<DayPicker {day} minDay="2024-01-01" maxDay={todayRange().from} onChange={setDay} />
	</div>

	{#if status === 'error'}
		<StateError auth={authErr} />
	{:else if status === 'loading'}
		<div class="hero-row">
			<Skeleton height="212px" radius="20px" />
			<Skeleton height="212px" radius="20px" />
		</div>
		<div class="kpirow">
			{#each Array(6) as _}<Skeleton height="116px" radius="16px" />{/each}
		</div>
		<div class="charts">
			<Skeleton height="252px" radius="18px" />
			<Skeleton height="252px" radius="18px" />
		</div>
	{:else if status === 'empty'}
		<StateEmpty
			body={isToday
				? 'No call events recorded today yet. The board fills in as operators come online — pick an earlier day above, or see Trends for history.'
				: `Nothing recorded on ${shortDay(day)}. Step through days above, or see Trends for history.`}
		/>
	{:else if team}
		<div class="hero-row">
			<LiveHero
				title={`Calls received · ${isToday ? 'today so far' : dayLabel}`}
				dateLabel={shortDay(day)}
				count={fmtInt(team.calls_received)}
				answered={fmtInt(team.calls_answered)}
				rate={fmtAnswerRate(team.answer_rate)}
				series={sReceived}
				{labels}
			/>
			<AnswerPanel
				rate={team.answer_rate}
				ratePct={fmtAnswerRate(team.answer_rate)}
				answered={fmtInt(team.calls_answered)}
				received={fmtInt(team.calls_received)}
				rangeShort={dayLabel}
				avgAnswer={fmtTimeToAnswer(team.avg_time_to_answer_ms)}
				{onShift}
				operatorCount={rosterCount}
				belowTarget={team.answer_rate != null && team.answer_rate < prefs.answerTarget}
				{targetPct}
				uncovered={uncoveredTotal != null && uncoveredTotal >= 300
					? fmtHoursMinutes(uncoveredTotal)
					: null}
			/>
		</div>

		<div class="kpirow">
			<KpiCard
				label="Not answered"
				value={fmtInt(Math.max(0, team.calls_received - team.calls_answered))}
				series={sMissed}
			/>
			<KpiCard
				label="No one available"
				value={uncoveredTotal == null ? '—' : fmtHoursMinutes(uncoveredTotal)}
				sub={uncoveredTotal == null ? 'no presence history' : 'callers reach voicemail'}
				series={sUncoveredMin}
				sparkColor="var(--danger)"
			/>
			<KpiCard label="Answer rate" value={fmtAnswerRate(team.answer_rate)} series={sAnswerPct} yMax={100} />
			<KpiCard label="Avg time to answer" value={fmtTimeToAnswer(team.avg_time_to_answer_ms)} series={sTtaSec} />
			<KpiCard label="Avg talk time" value={fmtHandle(team.avg_handle_ms)} series={sHandleMin} />
			<KpiCard label="Active hours" value={fmtHoursDecimal(team.active_seconds)} series={sActiveH} />
		</div>

		<div class="charts">
			<BandChart
				answered={sAnswered}
				received={sReceived}
				{labels}
				uncovered={sUncovered}
				subtitle={`per hour · ${dayLabel}`}
			/>
			<TrendChart
				title="Answer rate"
				subtitle="percent per hour"
				series={sAnswerPct}
				{labels}
				yMax={100}
				fmt={(v) => `${Math.round(v)}%`}
				target={targetPct}
				targetLabel={`${targetPct}% target`}
				detail={(i) =>
					`${sAnswered[i]} of ${sReceived[i]} answered` +
					(sUncovered && sUncovered[i] >= 60
						? ` · no one available ${fmtHoursMinutes(sUncovered[i])}`
						: '')}
			/>
		</div>
		{#if lateSync}
			<div class="latenote">
				Some events synced late and can't be placed at an exact hour — the totals above
				include them; the hourly charts don't.
			</div>
		{/if}

		{#if showIntraday && intraday}
			<OperatorHeatmap
				title="Calls answered by operator"
				subtitle={`${intraday.slotMinutes}-min slots · ${dayLabel} · click a row for detail`}
				labels={intraday.labels}
				operators={intraday.operators}
				slotMinutes={intraday.slotMinutes}
			/>
		{/if}

		{#if showTimeline && timeline}
			<PresenceTimeline
				subtitle={`exact status timeline · ${dayLabel} · click a row for detail`}
				start_ms={timeline.start_ms}
				end_ms={timeline.end_ms}
				coverage={timeline.coverage ?? null}
				operators={timeline.operators}
			/>
		{/if}

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
	.hero-row {
		display: grid;
		grid-template-columns: 1.55fr 1fr;
		gap: 16px;
	}
	.kpirow {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 14px;
	}
	.charts {
		display: grid;
		grid-template-columns: 1.55fr 1fr;
		gap: 16px;
	}
	.latenote {
		margin-top: -12px;
		font-size: 11px;
		color: var(--faint);
	}
	@media (max-width: 1000px) {
		.hero-row,
		.charts {
			grid-template-columns: 1fr;
		}
		.kpirow {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
