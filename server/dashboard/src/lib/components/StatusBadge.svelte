<script lang="ts">
	import type { LiveStatus } from '$lib/presence.model';

	let { status }: { status: LiveStatus } = $props();

	const LABEL: Record<LiveStatus, string> = {
		available: 'Available',
		on_call: 'On a call',
		away: 'Away',
		offline: 'Offline'
	};
</script>

<span class="badge s-{status}">
	<span class="dot"></span>{LABEL[status]}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		padding: 3px 9px;
		border-radius: 20px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.s-available {
		color: var(--status-available);
		background: color-mix(in srgb, var(--status-available) 13%, transparent);
	}
	.s-available .dot {
		background: var(--status-available);
	}
	.s-on_call {
		color: var(--status-on-call);
		background: color-mix(in srgb, var(--status-on-call) 13%, transparent);
	}
	.s-on_call .dot {
		background: var(--status-on-call);
	}
	.s-away {
		color: var(--status-away);
		background: color-mix(in srgb, var(--status-away) 13%, transparent);
	}
	.s-away .dot {
		background: var(--status-away);
	}
	.s-offline {
		color: var(--status-offline);
		background: color-mix(in srgb, var(--status-offline) 13%, transparent);
	}
	.s-offline .dot {
		background: var(--status-offline);
	}
</style>
