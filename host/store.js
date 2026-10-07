/**
 * Local append-only store. No cloud. Original event.ts is the clock.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      character TEXT,
      zone TEXT,
      source TEXT,
      ingest_mode TEXT,
      host_received_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS events_character ON events(character);
    CREATE INDEX IF NOT EXISTS events_type ON events(type);
  `);
  return {
    upsert(ev) {
      if (!ev?.id || !ev?.type) return;
      const ts = unixSeconds(ev.ts);
      db.prepare(
        `INSERT OR IGNORE INTO events
          (id, ts, type, character, zone, source, ingest_mode, host_received_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ev.id,
        ts ?? 0,
        ev.type,
        ev.character || null,
        ev.zone || null,
        ev.source || null,
        ev.ingest_mode || null,
        ev.host_received_at || null,
        JSON.stringify(ev)
      );
    },
    importAll(events) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO events
          (id, ts, type, character, zone, source, ingest_mode, host_received_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      db.exec("BEGIN");
      try {
        for (const ev of events) {
          if (!ev?.id || !ev?.type) continue;
          insert.run(
            ev.id,
            unixSeconds(ev.ts) ?? 0,
            ev.type,
            ev.character || null,
            ev.zone || null,
            ev.source || null,
            ev.ingest_mode || null,
            ev.host_received_at || null,
            JSON.stringify(ev)
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    count() {
      return db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    },
    allPayloads() {
      return db
        .prepare("SELECT payload FROM events ORDER BY ts ASC, id ASC")
        .all()
        .map((row) => JSON.parse(row.payload));
    },
  };
}

function unixSeconds(ts) {
  if (ts == null) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n > 1e12 ? n / 1000 : n);
}
