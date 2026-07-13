import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    -- Holds PII in first_name. (The presence table also stores first_name; both are
    -- cleared together on erasure — see deleteOperator.)
    CREATE TABLE IF NOT EXISTS operators (
      id           INTEGER PRIMARY KEY,
      install_uuid TEXT NOT NULL,
      first_name   TEXT NOT NULL,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      last_agent   TEXT,          -- extension version from the event envelope (rollout visibility)
      UNIQUE (install_uuid, first_name)
    );

    -- Immutable source of truth. event_id (client UUID) is the idempotency key.
    -- Source IPs are NEVER stored here.
    CREATE TABLE IF NOT EXISTS raw_events (
      event_id          TEXT PRIMARY KEY,
      operator_id       INTEGER NOT NULL REFERENCES operators(id),
      day               TEXT NOT NULL,
      type              TEXT NOT NULL,
      available_seconds INTEGER,
      time_to_answer_ms INTEGER,
      handle_ms         INTEGER,
      received_at       INTEGER NOT NULL,  -- server receipt (flush) time; batch-quantized
      occurred_at       INTEGER            -- client event time; preferred for timing (nullable: absent on old clients/rows)
    );

    -- Incremental per-operator-per-day rollup. Stores SUM + COUNT (not averages)
    -- so folding is an additive delta and averages stay exact. Rebuildable from
    -- raw_events at any time.
    CREATE TABLE IF NOT EXISTS daily_aggregates (
      operator_id       INTEGER NOT NULL REFERENCES operators(id),
      day               TEXT NOT NULL,
      available_seconds INTEGER NOT NULL DEFAULT 0,
      calls_received    INTEGER NOT NULL DEFAULT 0,
      calls_answered    INTEGER NOT NULL DEFAULT 0,
      sum_tta_ms        INTEGER NOT NULL DEFAULT 0,
      cnt_tta           INTEGER NOT NULL DEFAULT 0,
      sum_handle_ms     INTEGER NOT NULL DEFAULT 0,
      cnt_handle        INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (operator_id, day)
    );

    -- Live operator status board (current state only — NOT history). Overwritten on
    -- every heartbeat; "offline" is derived at read time from staleness, never stored.
    CREATE TABLE IF NOT EXISTS presence (
      install_uuid   TEXT NOT NULL,
      first_name     TEXT NOT NULL,
      status         TEXT NOT NULL,
      updated_at     INTEGER NOT NULL,
      last_online_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (install_uuid, first_name)
    );

    -- Presence HISTORY as exact-timestamp SPANS (the status timeline). A span opens
    -- on a status change and its last_beat is extended in place by every same-status
    -- heartbeat — so storage is one row per status change, not per beat. A span's
    -- effective end is its last_beat: silence (crash, lock, close) simply stops
    -- extending it, and the quiet stretch until the next span reads as offline.
    CREATE TABLE IF NOT EXISTS presence_spans (
      id           INTEGER PRIMARY KEY,
      install_uuid TEXT NOT NULL,
      first_name   TEXT NOT NULL,
      status       TEXT NOT NULL,    -- available | on_call | away (offline is a gap)
      started_at   INTEGER NOT NULL,
      last_beat    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spans_name_time ON presence_spans(first_name, started_at);
    CREATE INDEX IF NOT EXISTS idx_spans_install ON presence_spans(install_uuid, first_name, started_at);

    CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_aggregates(day);
    CREATE INDEX IF NOT EXISTS idx_raw_op_day ON raw_events(operator_id, day);
  `);

  // Short-lived dev-only table, replaced by presence_spans before ever deploying —
  // drop it so dev snapshots don't carry an orphan (no-op everywhere else).
  db.exec("DROP TABLE IF EXISTS presence_slots;");

  // Idempotent column adds for DBs created before these columns existed (ADD COLUMN
  // throws "duplicate column name" once present).
  for (const stmt of [
    "ALTER TABLE presence ADD COLUMN last_online_ms INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE operators ADD COLUMN last_agent TEXT",
    "ALTER TABLE raw_events ADD COLUMN occurred_at INTEGER",
  ]) {
    try {
      db.exec(stmt);
    } catch (e) {
      if (!String(e).toLowerCase().includes("duplicate column")) throw e;
    }
  }
}
