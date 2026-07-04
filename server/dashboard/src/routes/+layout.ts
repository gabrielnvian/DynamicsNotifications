// SPA: no SSR, no prerender. The Bun server serves the built SPA with an
// index.html fallback, so all routing happens client-side (design brief §3).
export const ssr = false;
export const prerender = false;
