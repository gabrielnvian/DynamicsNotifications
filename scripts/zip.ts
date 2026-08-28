#!/usr/bin/env bun
// Produces a Web Store-ready zip of dist/.
//
// Pure JS (no system `zip` dependency) so it works on any platform Bun runs on.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createWriteStream } from "node:fs";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";

const deflateRawAsync = promisify(deflateRaw);

const DIST = "dist";
const OUT = "DynamicsNotifications.zip";

// Minimal ZIP writer (store + deflate, no encryption, no zip64). Plenty for a
// Chrome extension bundle whose individual files are a few KB.

type Entry = { path: string; data: Uint8Array };

const entries: Entry[] = [];

async function walk(dir: string, base: string): Promise<void> {
  const items = await readdir(dir);
  for (const item of items) {
    const full = join(dir, item);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full, base);
      continue;
    }
    // Skip sourcemaps — they're useful for local debugging but bloat the
    // Web Store package and aren't consumed by production browsers anyway.
    if (full.endsWith(".map")) continue;
    const data = await readFile(full);
    entries.push({ path: relative(base, full).replace(/\\/g, "/"), data });
  }
}

// MS-DOS date/time encoding for ZIP entries. Seconds are stored in 2-sec
// granularity. We use the file's mtime so diffs between built zips are
// meaningful.
function msDosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const d =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: d };
}

await walk(DIST, DIST);

function crc32(data: Uint8Array): number {
  let c: number;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = (table[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

type Record = {
  path: string;
  crc: number;
  uncompressed: number;
  compressed: number;
  data: Uint8Array;
  offset: number;
  method: 0 | 8;
};

const records: Record[] = [];
const chunks: Uint8Array[] = [];
let offset = 0;

const textEncoder = new TextEncoder();

function pushBytes(bytes: Uint8Array): void {
  chunks.push(bytes);
  offset += bytes.length;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

const buildTime = msDosDateTime(new Date());

for (const entry of entries) {
  const pathBytes = textEncoder.encode(entry.path);
  const crc = crc32(entry.data);
  const deflated = await deflateRawAsync(entry.data);
  const useDeflate = deflated.length < entry.data.length;
  const method = useDeflate ? 8 : 0;
  const data = useDeflate ? new Uint8Array(deflated) : entry.data;

  const rec: Record = {
    path: entry.path,
    crc,
    uncompressed: entry.data.length,
    compressed: data.length,
    data,
    offset,
    method,
  };
  records.push(rec);

  // Local file header
  pushBytes(u32(0x04034b50));
  pushBytes(u16(20)); // version needed
  pushBytes(u16(0)); // flags
  pushBytes(u16(method));
  pushBytes(u16(buildTime.time));
  pushBytes(u16(buildTime.date));
  pushBytes(u32(crc));
  pushBytes(u32(rec.compressed));
  pushBytes(u32(rec.uncompressed));
  pushBytes(u16(pathBytes.length));
  pushBytes(u16(0)); // extra len
  pushBytes(pathBytes);
  pushBytes(data);
}

const centralStart = offset;

for (const rec of records) {
  const pathBytes = textEncoder.encode(rec.path);
  pushBytes(u32(0x02014b50));
  pushBytes(u16(20)); // version made by
  pushBytes(u16(20)); // version needed
  pushBytes(u16(0)); // flags
  pushBytes(u16(rec.method));
  pushBytes(u16(buildTime.time));
  pushBytes(u16(buildTime.date));
  pushBytes(u32(rec.crc));
  pushBytes(u32(rec.compressed));
  pushBytes(u32(rec.uncompressed));
  pushBytes(u16(pathBytes.length));
  pushBytes(u16(0)); // extra len
  pushBytes(u16(0)); // comment len
  pushBytes(u16(0)); // disk number
  pushBytes(u16(0)); // internal attrs
  pushBytes(u32(0)); // external attrs
  pushBytes(u32(rec.offset));
  pushBytes(pathBytes);
}

const centralEnd = offset;

// End of central directory record
pushBytes(u32(0x06054b50));
pushBytes(u16(0));
pushBytes(u16(0));
pushBytes(u16(records.length));
pushBytes(u16(records.length));
pushBytes(u32(centralEnd - centralStart));
pushBytes(u32(centralStart));
pushBytes(u16(0)); // comment len

const total = chunks.reduce((s, c) => s + c.length, 0);
const buf = new Uint8Array(total);
let p = 0;
for (const c of chunks) {
  buf.set(c, p);
  p += c.length;
}

await new Promise<void>((resolve, reject) => {
  const ws = createWriteStream(OUT);
  ws.on("error", reject);
  ws.on("finish", resolve);
  ws.end(buf);
});

console.log(`Wrote ${OUT} (${records.length} files, ${buf.length} bytes)`);
