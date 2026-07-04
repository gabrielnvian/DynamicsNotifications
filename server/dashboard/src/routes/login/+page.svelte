<script lang="ts">
	import { goto } from '$app/navigation';
	import { login } from '$lib/auth.client';
	import { session } from '$lib/stores/session.svelte';

	let user = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		error = '';
		busy = true;
		const role = await login(user, password);
		busy = false;
		if (role) {
			session.role = role;
			// Operator-status-only accounts land on the live board; they can't reach the rest.
			goto(role === 'live' ? '/live' : '/');
		} else error = 'Incorrect username or password.';
	}
</script>

<div class="wrap">
	<form class="card" onsubmit={submit}>
		<div class="brand">
			<span class="logo"><span></span><span></span><span></span></span>
			<span class="bt">
				<span class="name">Call Metrics</span>
				<span class="sub">Operator performance</span>
			</span>
		</div>
		<h1>Sign in</h1>

		<label class="field">
			<span>Username</span>
			<input type="text" bind:value={user} autocomplete="username" required />
		</label>
		<label class="field">
			<span>Password</span>
			<input type="password" bind:value={password} autocomplete="current-password" required />
		</label>

		{#if error}<div class="err">{error}</div>{/if}

		<button class="submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
	</form>
</div>

<style>
	.wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.card {
		width: 100%;
		max-width: 360px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background: var(--card);
		border: 1px solid var(--card-border);
		border-radius: 14px;
		box-shadow: var(--card-shadow);
		padding: 26px 24px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--brand);
	}
	.logo {
		display: inline-flex;
		align-items: flex-end;
		gap: 2px;
		height: 18px;
	}
	.logo span {
		width: 3px;
		background: var(--brand);
		border-radius: 1px;
	}
	.logo span:nth-child(1) {
		height: 10px;
	}
	.logo span:nth-child(2) {
		height: 18px;
	}
	.logo span:nth-child(3) {
		height: 13px;
	}
	.bt {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.name {
		font-size: 15px;
		font-weight: 700;
		color: var(--text);
	}
	.sub {
		font-size: 12px;
		color: var(--faint);
	}
	h1 {
		margin: 2px 0 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--text);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: var(--label);
	}
	.field input {
		font: inherit;
		font-size: 14px;
		font-weight: 400;
		color: var(--text);
		background: var(--input-bg);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		padding: 9px 11px;
	}
	.field input:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.err {
		font-size: 13px;
		color: var(--amber);
	}
	.submit {
		margin-top: 4px;
		padding: 10px;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		color: #fff;
		background: var(--brand);
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.submit:hover {
		background: var(--brand-strong);
	}
	.submit:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
