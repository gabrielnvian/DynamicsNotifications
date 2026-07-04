<script lang="ts">
	// Shimmer placeholder block. Compose these to mirror a view's layout while it
	// loads (design brief §8 loading state).
	let { height = '1rem', width = '100%', radius = '8px' }: {
		height?: string;
		width?: string;
		radius?: string;
	} = $props();
</script>

<div class="sk" style="height:{height};width:{width};border-radius:{radius}"></div>

<style>
	.sk {
		background: linear-gradient(90deg, var(--sk1), var(--sk2), var(--sk1));
		background-size: 200% 100%;
		animation: cc-shimmer 1.3s ease-in-out infinite;
	}
</style>
