// Seed the database with realistic sample data so the dashboard has something
// to render during development. Safe to re-run (events are idempotent).
//
//   bun run scripts/seed.ts
//
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { ingest } from "../src/ingest.ts";
import type { RawEvent } from "../src/types.ts";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

const ops = [
  { install: crypto.randomUUID(), name: "gabriel", quality: 0.95 },
  { install: crypto.randomUUID(), name: "maria", quality: 0.82 },
  { install: crypto.randomUUID(), name: "sam", quality: 0.6 },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const today = new Date();
let total = 0;

for (const op of ops) {
  for (let back = 29; back >= 0; back--) {
    const day = ymd(new Date(today.getTime() - back * 86400000));
    const events: RawEvent[] = [];

    const availableSeconds = Math.min(
      86400,
      Math.round((5 + op.quality * 4) * 3600 * (0.8 + Math.random() * 0.4)),
    );
    events.push({
      event_id: crypto.randomUUID(),
      type: "available_tick",
      day,
      available_seconds: availableSeconds,
    });

    const received = Math.round((15 + Math.random() * 20) * op.quality) + 3;
    for (let i = 0; i < received; i++) {
      events.push({ event_id: crypto.randomUUID(), type: "call_received", day });
      if (Math.random() < op.quality) {
        events.push({
          event_id: crypto.randomUUID(),
          type: "call_answered",
          day,
          time_to_answer_ms: Math.round(2000 + Math.random() * 9000 * (1.3 - op.quality)),
        });
        if (Math.random() < 0.9) {
          events.push({
            event_id: crypto.randomUUID(),
            type: "call_ended",
            day,
            handle_ms: Math.round(120000 + Math.random() * 300000),
          });
        }
      }
    }

    const r = ingest(db, { install: op.install, operator: op.name, events }, Date.now());
    total += r.accepted;
  }
}

console.log(`Seeded ${ops.length} operators, ${total} events → ${cfg.dbPath}`);
db.close();
