#!/usr/bin/env bash
# Build a self-contained deploy artifact for the metrics server.
#
#   Output: dist/metrics-server.tgz
#     server.js               — the whole server bundled to one file
#                               (bun:sqlite / node:* stay external as Bun built-ins)
#     dashboard/build/…        — the built SvelteKit SPA (served at /)
#     metrics-server.service   — the systemd unit
#
# Deliberately does NOT include: src/, tests, node_modules, .env, or data/. The
# container keeps its own .env (config + creds) and data/ (SQLite) — they persist
# across updates, so pushing a new build never disturbs config or history.
#
# Push a new build to the container:
#   ./deploy/build.sh
#   cohub push pdm dist/metrics-server.tgz
#   # pdm: untar into /opt/metrics-server (overwrites server.js + dashboard/build,
#   #      leaves .env + data/), then: sudo systemctl restart metrics-server
set -euo pipefail
cd "$(dirname "$0")/.." # -> server/

echo "==> building dashboard SPA"
(cd dashboard && bun install --silent && bun run build)

echo "==> bundling server (single file; bun:sqlite / node:* external)"
rm -rf dist
mkdir -p dist/stage/dashboard
bun build src/index.ts --target=bun --outfile dist/stage/server.js

echo "==> assembling artifact"
cp -R dashboard/build dist/stage/dashboard/build
cp deploy/metrics-server.service dist/stage/metrics-server.service

tar -C dist/stage -czf dist/metrics-server.tgz .
rm -rf dist/stage

SHA=$(sha256sum dist/metrics-server.tgz | cut -d' ' -f1)
SIZE=$(du -h dist/metrics-server.tgz | cut -f1)
echo "==> dist/metrics-server.tgz  ($SIZE)  sha256=$SHA"
tar -tzf dist/metrics-server.tgz | sed 's/^/      /'
