<script lang="ts">
	// The right side of the hero row: an answer-rate ring gauge + two mini-stats
	// (Avg time to answer, On shift N/total). Ring is an SVG circle using pathLength=1
	// with stroke-dashoffset = 1 - rate. The ring carries the judgment: --live when the
	// rate meets the answer target, --amber below it (a 60% rate must not glow green).
	let {
		rate,
		ratePct,
		answered,
		received,
		rangeShort,
		avgAnswer,
		onShift,
		operatorCount,
		belowTarget = false,
		targetPct
	}: {
		rate: number | null;
		ratePct: string;
		answered: string;
		received: string;
		rangeShort: string;
		avgAnswer: string;
		onShift: number | null;
		operatorCount: number;
		belowTarget?: boolean;
		targetPct?: number;
	} = $props();

	const SIZE = 104;
	const SW = 9;
	const R = (SIZE - SW) / 2;
	const C = SIZE / 2;
	const offset = $derived(1 - Math.max(0, Math.min(1, rate ?? 0)));
	const ringColor = $derived(belowTarget ? 'var(--amber)' : 'var(--live)');
</script>

<div class="panel">
	<div class="ringcard">
		<div class="ringwrap">
			<svg class="ring" width={SIZE} height={SIZE} viewBox="0 0 {SIZE} {SIZE}" aria-hidden="true">
				<circle cx={C} cy={C} r={R} fill="none" stroke="var(--chart-grid)" stroke-width={SW} />
				<circle
					class="prog"
					cx={C}
					cy={C}
					r={R}
					fill="none"
					stroke={ringColor}
					stroke-width={SW}
					stroke-linecap="round"
					pathLength="1"
					transform="rotate(-90 {C} {C})"
					style="stroke-dasharray:1;stroke-dashoffset:{offset};--ring:{ringColor}"
				/>
			</svg>
			<div class="center">
				<span class="pct num">{ratePct}</span>
				<span class="cap">answer</span>
			</div>
		</div>
		<div class="blurb">
			<div class="lbl">Answer rate</div>
			<div class="desc">
				{answered} of {received} calls answered over {rangeShort}.
				{#if belowTarget && targetPct != null}<span class="below">Below the {targetPct}% target.</span>{/if}
			</div>
		</div>
	</div>

	<div class="ministats">
		<div class="stat">
			<div class="slbl">Avg time to answer</div>
			<div class="sval num">{avgAnswer}</div>
		</div>
		<div class="stat">
			<div class="slbl">On shift</div>
			<div class="sval num">
				{onShift ?? '—'}<span class="of"> / {operatorCount}</span>
			</div>
		</div>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.ringcard {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 18px;
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 20px;
		box-shadow: var(--card-shadow);
		padding: 20px 22px;
	}
	.ringwrap {
		position: relative;
		flex-shrink: 0;
		width: 104px;
		height: 104px;
	}
	/* Let the emerald glow around the ring paint outside the 104px box instead of being
	   clipped by the SVG's viewport. */
	.ring {
		overflow: visible;
	}
	.prog {
		transition: stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global([data-theme='dark']) .prog {
		filter: drop-shadow(0 0 6px var(--ring, var(--live)));
	}
	.center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}
	.pct {
		font-size: 23px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.cap {
		font-size: 9.5px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.blurb {
		min-width: 0;
	}
	.lbl {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--label);
	}
	.desc {
		font-size: 12.5px;
		color: var(--muted);
		margin-top: 5px;
		line-height: 1.45;
	}
	.below {
		color: var(--amber);
		font-weight: 600;
	}
	.ministats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.stat {
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 18px;
		box-shadow: var(--card-shadow);
		padding: 16px 18px;
	}
	.slbl {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--label);
	}
	.sval {
		font-size: 27px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
		color: var(--text);
	}
	.of {
		font-size: 15px;
		color: var(--faint);
		font-weight: 500;
	}
</style>
