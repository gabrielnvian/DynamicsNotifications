import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SPA served by the Bun server at /. No SSR; a fallback page lets client-side
		// routing survive the server's index.html fallback (server/src/index.ts).
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
