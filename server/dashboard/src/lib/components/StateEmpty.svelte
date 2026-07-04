<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		title = 'No data for this range',
		body = '',
		onReset
	}: { title?: string; body?: string; onReset?: () => void } = $props();
</script>

<div class="empty">
	<div class="ico"><Icon name="inbox" size={28} /></div>
	<div class="t">{title}</div>
	{#if body}<div class="b">{body}</div>{/if}
	{#if onReset}<button class="btn" onclick={onReset}>View last 30 days</button>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		text-align: center;
	}
	.ico {
		color: var(--faint);
	}
	.t {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
	}
	.b {
		font-size: 13px;
		color: var(--muted);
		max-width: 420px;
	}
	.btn {
		margin-top: 6px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 600;
		color: #fff;
		background: var(--brand);
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.btn:hover {
		background: var(--brand-strong);
	}
</style>
