<script lang="ts">
	import Icon from './Icon.svelte';

	// Covers 401/403 (auth) and generic failures. The browser owns Basic auth
	// (design brief §4) — we never build a login, just recover gracefully.
	let { auth = false }: { auth?: boolean } = $props();

	function reload(): void {
		location.reload();
	}
</script>

<div class="err">
	<div class="ico"><Icon name="alert" size={28} /></div>
	<div class="t">{auth ? 'Session expired or access denied' : 'Something went wrong'}</div>
	<div class="b">
		{auth
			? 'Your credentials are no longer valid (HTTP 401 / 403). Reload the page to sign in again.'
			: 'The dashboard could not load its data. Reload to try again.'}
	</div>
	<button class="btn" onclick={reload}>Reload</button>
</div>

<style>
	.err {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		text-align: center;
	}
	.ico {
		color: var(--amber);
	}
	.t {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
	}
	.b {
		font-size: 13px;
		color: var(--muted);
		max-width: 440px;
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
