#!/usr/bin/env bun
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIST = "dist";

type Entry = { entry: string; out: string };

// Entry points only. metrics.js is NOT an entry — it is imported by
// background.js and gets bundled into dist/background.js.
const ENTRIES: Entry[] = [
  { entry: "background.js", out: "background.js" },
  { entry: "content.js", out: "content.js" },
  { entry: "popup.js", out: "popup.js" },
  { entry: "offscreen.js", out: "offscreen.js" },
];

// Static assets copied verbatim into dist/. The mp3s are fetched at runtime
// by bare filename via chrome.runtime.getURL(), so they must land at the
// dist root with unchanged names.
const STATICS = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "offscreen.html",
  "icons",
  "agent.mp3",
  "discord.mp3",
  "skype.mp3",
  "teams.mp3",
];

async function clean(): Promise<void> {
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

async function bundle(entry: Entry): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry.entry],
    outdir: DIST,
    naming: entry.out,
    target: "browser",
    format: "iife",
    minify: true,
    sourcemap: "external",
  });
  if (!result.success) {
    console.error(`Build failed for ${entry.entry}:`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

async function copyStatics(): Promise<void> {
  for (const s of STATICS) {
    await cp(s, `${DIST}/${s}`, { recursive: true });
  }
}

const start = Date.now();
await clean();
await Promise.all(ENTRIES.map(bundle));
await copyStatics();
console.log(`Built to ${DIST}/ in ${Date.now() - start}ms`);
