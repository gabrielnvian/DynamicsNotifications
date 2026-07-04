<script lang="ts">
	// Themed replacement for a native <select> — a native option list is OS-rendered and
	// ignores our dark tokens, so we render our own. The menu is position:fixed (anchored
	// to the trigger) so it escapes any ancestor overflow:hidden / stacking context, and
	// it scrolls when there are more options than fit.
	import Icon from './Icon.svelte';

	let {
		value,
		options,
		onChange,
		ariaLabel = 'Select'
	}: {
		value: string;
		options: { value: string; label: string }[];
		onChange: (v: string) => void;
		ariaLabel?: string;
	} = $props();

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let pos = $state({ left: 0, top: 0, width: 0, maxH: 280 });
	const current = $derived(options.find((o) => o.value === value)?.label ?? '');

	function place(): void {
		if (!triggerEl) return;
		const r = triggerEl.getBoundingClientRect();
		pos = {
			left: r.left,
			top: r.bottom + 4,
			width: r.width,
			maxH: Math.max(120, Math.min(320, window.innerHeight - r.bottom - 16))
		};
	}
	function toggle(): void {
		if (!open) place();
		open = !open;
	}
	function pick(v: string): void {
		onChange(v);
		open = false;
	}
</script>

<div class="dd">
	<button
		type="button"
		class="trigger"
		bind:this={triggerEl}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={ariaLabel}
		onclick={toggle}
	>
		<span class="cur">{current}</span>
		<span class="caret" class:open><Icon name="chevron" size={11} /></span>
	</button>
	{#if open}
		<button class="overlay" aria-label="Close" onclick={() => (open = false)}></button>
		<ul
			class="menu"
			role="listbox"
			style="left:{pos.left}px;top:{pos.top}px;min-width:{pos.width}px;max-height:{pos.maxH}px"
		>
			{#each options as o}
				<li>
					<button
						type="button"
						class="opt"
						class:sel={o.value === value}
						role="option"
						aria-selected={o.value === value}
						onclick={() => pick(o.value)}
					>
						{o.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.dd {
		display: inline-block;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		font: inherit;
		font-size: 13px;
		border: 1px solid var(--card-border);
		border-radius: 8px;
		background: var(--input-bg);
		color: var(--text);
		cursor: pointer;
	}
	.trigger:hover {
		border-color: color-mix(in srgb, var(--brand) 45%, var(--card-border));
	}
	.caret {
		display: flex;
		color: var(--muted);
		transition: transform 0.18s ease;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: none;
		background: transparent;
		cursor: default;
	}
	.menu {
		position: fixed;
		z-index: 61;
		margin: 0;
		padding: 5px;
		list-style: none;
		overflow-y: auto;
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 10px;
		box-shadow: var(--card-shadow);
		scrollbar-width: thin;
		scrollbar-color: var(--card-border) transparent;
	}
	.menu::-webkit-scrollbar {
		width: 9px;
	}
	.menu::-webkit-scrollbar-thumb {
		background: var(--card-border);
		border-radius: 6px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	.opt {
		display: block;
		width: 100%;
		text-align: left;
		white-space: nowrap;
		padding: 7px 10px;
		font: inherit;
		font-size: 13px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-soft);
		cursor: pointer;
	}
	.opt:hover {
		background: var(--hover);
		color: var(--text);
	}
	.opt.sel {
		color: var(--brand);
		font-weight: 600;
	}
</style>
