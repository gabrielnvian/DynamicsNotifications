/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// PWA service worker — makes the dashboard installable as a standalone window and lets
// the app shell load offline. SvelteKit auto-registers this file in production builds.
//
// Data is NEVER cached: every /v1/* request goes straight to the network so it stays
// fresh and carries the session cookie. Only the immutable app shell (build assets +
// static files + index) is cached, keyed on the build version so a redeploy evicts old
// caches automatically.

import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `op-metrics-${version}`;
const ROOT = `${base}/`; // app root (honours a configured base path; '/' at root)
const SHELL = [...build, ...files, ROOT];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(SHELL))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	if (url.origin !== location.origin) return;
	// API + auth endpoints must always hit the network (cookies + live data). Never cache.
	if (url.pathname.startsWith('/v1/')) return;

	// SPA navigations: network-first (fresh shell after a redeploy), fall back to the
	// cached index so client-side routing survives offline / flaky networks.
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req).catch(async () => (await caches.match(ROOT)) ?? Response.error())
		);
		return;
	}

	// Immutable build assets + bundled static files: cache-first.
	if (build.includes(url.pathname) || files.includes(url.pathname)) {
		event.respondWith(caches.match(req).then((cached) => cached ?? fetch(req)));
		return;
	}

	// Anything else same-origin: network, fall back to cache if offline.
	event.respondWith(
		fetch(req).catch(async () => (await caches.match(req)) ?? Response.error())
	);
});
