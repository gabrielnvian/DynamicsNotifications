import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Dev-real mode (`bun run dev:real` → VITE_USE_MOCK=false): proxy /v1 to the deployed
// server so `vite dev` renders live production data. Same-origin from the browser's
// point of view, so the app code is identical to prod. `bun run dev:local` overrides
// the target to a locally-run server (e.g. the NEW server code on :3001 against a DB
// snapshot) — same .env credentials, so the injected auth works for both.
const REAL_TARGET = process.env.VITE_PROXY_TARGET || 'https://dynops.tail068f9.ts.net';

// Inject the dashboard's Basic auth from ../.env (gitignored) so dev-real needs no
// login flow — Secure session cookies won't set on a plain-http tailnet origin.
// ⚠️ While dev:real runs, anyone who can reach :5173 on this machine (LAN/tailnet)
// reads prod metrics through this header. Dev-only; `vite build` ignores all of this.
function basicAuthFromServerEnv(): string | undefined {
	let text: string;
	try {
		text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		return undefined; // no server .env on this machine — the login form still works
	}
	const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
	const user = get('DASHBOARD_USER');
	const pass = get('DASHBOARD_PASSWORD');
	if (!user || !pass) return undefined;
	return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export default defineConfig(() => {
	const real = process.env.VITE_USE_MOCK === 'false';
	const auth = real ? basicAuthFromServerEnv() : undefined;
	return {
		plugins: [sveltekit()],
		// Dev-only: let `vite dev` be reached over the tailnet for live previews. Has no
		// effect on `vite build` / the deployed static SPA.
		server: {
			host: true,
			allowedHosts: ['.ts.net'],
			proxy: real
				? {
						'/v1': {
							target: REAL_TARGET,
							changeOrigin: true,
							...(auth ? { headers: { authorization: auth } } : {})
						}
					}
				: undefined
		}
	};
});
