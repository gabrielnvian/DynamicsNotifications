<script lang="ts">
	// Single-day picker: ‹ › steppers around a native date input. Toolbar control
	// for day-scoped pages (Day review) — deliberately NOT inside a chart card.
	import Icon from './Icon.svelte';

	let {
		day,
		minDay,
		maxDay,
		onChange
	}: {
		day: string;
		minDay?: string;
		maxDay?: string;
		onChange: (day: string) => void;
	} = $props();

	function shiftDay(d: string, delta: number): string {
		const [y, m, dd] = d.split('-').map(Number);
		const nd = new Date(y, m - 1, dd + delta);
		return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(
			nd.getDate()
		).padStart(2, '0')}`;
	}
</script>

<div class="daynav" aria-label="Pick a day">
	<button
		class="nbtn"
		aria-label="Previous day"
		disabled={minDay != null && day <= minDay}
		onclick={() => onChange(shiftDay(day, -1))}
	>
		<Icon name="back" size={14} />
	</button>
	<input
		class="dinput num"
		type="date"
		value={day}
		min={minDay}
		max={maxDay}
		onchange={(e) => {
			const v = (e.currentTarget as HTMLInputElement).value;
			if (v) onChange(v);
		}}
	/>
	<button
		class="nbtn next"
		aria-label="Next day"
		disabled={maxDay != null && day >= maxDay}
		onclick={() => onChange(shiftDay(day, 1))}
	>
		<Icon name="back" size={14} />
	</button>
</div>

<style>
	.daynav {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.nbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 11px;
		border: 1px solid var(--card-border);
		background: var(--input-bg);
		color: var(--text-soft);
		cursor: pointer;
	}
	.nbtn:hover:not(:disabled) {
		color: var(--text);
		border-color: color-mix(in srgb, var(--brand) 45%, var(--card-border));
	}
	.nbtn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.nbtn.next :global(svg) {
		transform: rotate(180deg);
	}
	.dinput {
		height: 38px;
		padding: 0 11px;
		font-size: 13px;
		border: 1px solid var(--card-border);
		border-radius: 11px;
		background: var(--input-bg);
		color: var(--text);
		outline: none;
	}
</style>
