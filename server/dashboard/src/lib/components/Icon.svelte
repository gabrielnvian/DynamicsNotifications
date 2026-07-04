<script lang="ts">
	// Feather-style stroke icons, inline so nothing loads from a CDN (offline
	// constraint). stroke-width 2, round caps. currentColor inherits text colour.
	type IconName =
		| 'refresh'
		| 'download'
		| 'calendar'
		| 'moon'
		| 'sun'
		| 'back'
		| 'chevron'
		| 'search'
		| 'table'
		| 'bars'
		| 'alert'
		| 'inbox'
		| 'logout';

	let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'refresh'}
		<path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
	{:else if name === 'download'}
		<path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
	{:else if name === 'calendar'}
		<rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" />
	{:else if name === 'moon'}
		<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" /><path
			d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"
		/>
	{:else if name === 'back'}
		<path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
	{:else if name === 'chevron'}
		<path d="M9 18l6-6-6-6" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
	{:else if name === 'table'}
		<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
	{:else if name === 'bars'}
		<path d="M4 20V10M10 20V4M16 20v-8M2 20h20" />
	{:else if name === 'alert'}
		<path d="M12 3l9 16H3L12 3z" /><path d="M12 10v4M12 17h.01" />
	{:else if name === 'inbox'}
		<path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 6h14l3 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
	{:else if name === 'logout'}
		<path d="M16 17l5-5-5-5" /><path d="M21 12H9" /><path
			d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
		/>
	{/if}
</svg>
