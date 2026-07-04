<script lang="ts">
	import { buildSparkline } from '$lib/chart-geometry.service';
	import { uid } from '$lib/uid';

	let {
		series,
		yMax,
		color = 'var(--chart-line)'
	}: { series: Array<number | null>; yMax?: number; color?: string } = $props();

	const gid = uid('spark');
	const spark = $derived(buildSparkline(series, yMax != null ? { yMax } : undefined));
</script>

<svg class="spark" viewBox={spark.viewBox} preserveAspectRatio="none" aria-hidden="true">
	<defs>
		<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color={color} stop-opacity="0.22" />
			<stop offset="100%" stop-color={color} stop-opacity="0" />
		</linearGradient>
	</defs>
	{#if spark.areaPath}<path d={spark.areaPath} fill="url(#{gid})" />{/if}
	{#if spark.linePath}
		<path d={spark.linePath} fill="none" stroke={color} stroke-width="1.7" />
	{/if}
	{#each spark.dots as d}<circle cx={d.x} cy={d.y} r="2" fill={color} />{/each}
	{#if spark.last}<circle cx={spark.last.x} cy={spark.last.y} r="2.2" fill={color} />{/if}
</svg>

<style>
	.spark {
		width: 100%;
		height: 34px;
		display: block;
	}
</style>
