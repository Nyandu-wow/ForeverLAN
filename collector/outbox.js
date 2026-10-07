import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Durable outbox: JSONL lines with sent/acked flags.
 * Idempotent by event_id.
 *
 * Guarantees:
 * - Append never rewrites the whole file.
 * - Successful POST (201/409) marks sent; failed POST leaves the row queued.
 * - Compaction uses a unique temp file + verified replace; original kept until replace succeeds.
 * - Startup recovers a truncated final line without discarding complete earlier rows.
 * - markSent / markFailure debounce disk rewrite (no rewrite-per-event on catch-up).
 */
export class Outbox {
  constructor(filePath, opts = {}) {
    this.filePath = filePath;
    this.byId = new Map();
    this.#dirty = false;
    this.#rewriteTimer = null;
    this.#rewriting = false;
    this.#rewriteFailStreak = 0;
    this.#log = opts.log || ((..._args) => {});
    this.recoveredPartialLine = false;
    this.loadFailed = false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.#load();
  }

  #dirty;
  #rewriteTimer;
  #rewriting;
  #rewriteFailStreak;
  #log;

  #load() {
    if (!fs.existsSync(this.filePath)) return;
    let text;
    try {
      text = fs.readFileSync(this.filePath, "utf8");
    } catch (err) {
      this.loadFailed = true;
      this.#log(`[outbox] load failed — append-only until restart (will not rewrite): ${err.message}`);
      return;
    }
    if (!text) return;

    const endsWithNewline = text.endsWith("\n") || text.endsWith("\r\n");
    const rawLines = text.split(/\r?\n/);
    if (rawLines.length && rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }

    const kept = [];
    let droppedPartial = false;
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?.event?.id) {
          row.durable = true;
          this.byId.set(row.event.id, row);
          kept.push(line);
        }
      } catch {
        const isLast = i === rawLines.length - 1;
        if (isLast && !endsWithNewline) {
          droppedPartial = true;
        }
      }
    }

    if (droppedPartial) {
      this.recoveredPartialLine = true;
      try {
        const buf = fs.readFileSync(this.filePath);
        const cut = buf.lastIndexOf(0x0a) + 1;
        fs.writeFileSync(`${this.filePath}.torn-${Date.now()}.txt`, buf.subarray(cut));
        fs.truncateSync(this.filePath, cut);
        this.#log(
          `[outbox] recovered: truncated incomplete final line (${kept.length} complete rows kept)`
        );
      } catch (err) {
        this.#log(`[outbox] recovery write failed (memory still has complete rows): ${err.message}`);
      }
    }
  }

  #scheduleRewrite(delayMs = 400) {
    this.#dirty = true;
    if (this.#rewriteTimer || this.#rewriting) return;
    this.#rewriteTimer = setTimeout(() => {
      this.#rewriteTimer = null;
      if (this.#dirty) this.#rewrite();
    }, delayMs);
  }

  /** Flush pending disk rewrite now (call on process exit if needed). */
  flush() {
    if (this.#rewriteTimer) {
      clearTimeout(this.#rewriteTimer);
      this.#rewriteTimer = null;
    }
    if (this.#dirty && !this.#rewriting) this.#rewrite();
  }

  #verifyFile(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    if (!text) return 0;
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      JSON.parse(line);
      n += 1;
    }
    return n;
  }

  #computeKeep() {
    const unsent = [];
    const sent = [];
    for (const row of this.byId.values()) {
      if (!row.sent_at && !row.rejected_at) unsent.push(row);
      else sent.push(row);
    }
    sent.sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
    const keepSent = sent.slice(-800);
    return [...unsent, ...keepSent];
  }

  /**
   * Replace dest with tmp. On Windows, rename cannot overwrite an existing file
   * (often surfaces as EPERM / EEXIST / ENOENT) — copy then remove tmp.
   */
  #replaceFile(tmp, dest) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (err) {
      const code = err && err.code;
      if (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES" && code !== "ENOENT") {
        throw err;
      }
    }
    fs.copyFileSync(tmp, dest);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore leftover tmp */
    }
  }

  #rewrite() {
    if (this.loadFailed) {
      this.#dirty = false;
      this.#log("[outbox] rewrite skipped — original file preserved after load failure");
      return;
    }
    if (this.#rewriting) {
      this.#dirty = true;
      return;
    }
    this.#rewriting = true;
    this.#dirty = false;
    // Unique temp name so concurrent collectors / failed retries never clobber each other.
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const keep = this.#computeKeep();
      const lines = keep.map((row) => JSON.stringify(row));
      const body = lines.join("\n") + (lines.length ? "\n" : "");
      fs.writeFileSync(tmp, body, "utf8");
      const verified = this.#verifyFile(tmp);
      if (verified !== lines.length) {
        throw new Error(`verify count mismatch wrote=${lines.length} read=${verified}`);
      }
      this.#replaceFile(tmp, this.filePath);

      const keepIds = new Set(keep.map((r) => r.event.id));
      for (const id of [...this.byId.keys()]) {
        const row = this.byId.get(id);
        if (row?.sent_at && !keepIds.has(id)) this.byId.delete(id);
        else if (row) row.durable = true;
      }

      for (const row of this.byId.values()) {
        if (!keepIds.has(row.event.id) && !row.sent_at) {
          fs.appendFileSync(this.filePath, JSON.stringify(row) + "\n", "utf8");
          row.durable = true;
        }
      }

      this.#rewriteFailStreak = 0;
    } catch (err) {
      this.#dirty = true;
      this.#rewriteFailStreak += 1;
      // Log first failure and then every 5th — do not spam friends' consoles.
      if (this.#rewriteFailStreak === 1 || this.#rewriteFailStreak % 5 === 0) {
        this.#log(
          `[outbox] rewrite failed — original file kept (retry ${this.#rewriteFailStreak}): ${err.message}`
        );
      }
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    } finally {
      this.#rewriting = false;
      if (this.#dirty) {
        const delay = Math.min(15_000, 400 * Math.pow(2, Math.min(this.#rewriteFailStreak, 5)));
        this.#scheduleRewrite(delay);
      }
    }
  }

  upsert(event, meta = {}) {
    if (!event?.id) {
      event = {
        ...event,
        id: crypto.randomUUID(),
      };
    }
    const existing = this.byId.get(event.id);
    if (existing) {
      return {
        row: existing,
        inserted: false,
        durable: existing.durable !== false,
      };
    }
    const row = {
      event,
      received_at: new Date().toISOString(),
      sent_at: null,
      attempts: 0,
      last_error: null,
      durable: false,
      ...meta,
    };
    this.byId.set(event.id, row);
    // Always append — even mid-rewrite — so a crash never loses an in-memory-only row.
    // Duplicate lines from overlapping rewrite+append are fine; next rewrite dedupes by id.
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(row) + "\n", "utf8");
      row.durable = true;
    } catch (err) {
      this.#log(`[outbox] append failed — will rewrite: ${err.message}`);
      this.#scheduleRewrite();
    }
    if (this.#rewriting) this.#dirty = true;
    return { row, inserted: true, durable: row.durable === true };
  }

  /** True when this id is in memory and has been written to outbox.jsonl (or compacted). */
  isDurable(id) {
    const row = this.byId.get(id);
    return !!(row && row.durable !== false);
  }

  pending(limit = 50) {
    const out = [];
    for (const row of this.byId.values()) {
      if (!row.sent_at && !row.rejected_at) out.push(row);
    }
    out.sort((a, b) => {
      const ta = Number(a.event?.ts) || 0;
      const tb = Number(b.event?.ts) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.event?.id || "").localeCompare(String(b.event?.id || ""));
    });
    return out.slice(0, limit);
  }

  pendingCount() {
    let n = 0;
    for (const row of this.byId.values()) {
      if (!row.sent_at && !row.rejected_at) n += 1;
    }
    return n;
  }

  stats() {
    let sent = 0;
    let unsent = 0;
    for (const row of this.byId.values()) {
      if (row.sent_at || row.rejected_at) sent += 1;
      else unsent += 1;
    }
    let bytes = 0;
    try {
      if (fs.existsSync(this.filePath)) bytes = fs.statSync(this.filePath).size;
    } catch {
      /* ignore */
    }
    return {
      path: this.filePath,
      awaiting_delivery: unsent,
      retained_sent: sent,
      rows_in_memory: this.byId.size,
      file_bytes: bytes,
    };
  }

  markSent(eventId) {
    const row = this.byId.get(eventId);
    if (!row) return;
    row.sent_at = new Date().toISOString();
    row.last_error = null;
    this.#scheduleRewrite();
  }

  markRejected(eventId, err) {
    const row = this.byId.get(eventId);
    if (!row) return;
    row.rejected_at = new Date().toISOString();
    row.last_error = String(err);
    this.#scheduleRewrite();
  }

  markFailure(eventId, err) {
    const row = this.byId.get(eventId);
    if (!row) return;
    row.attempts = (row.attempts || 0) + 1;
    row.last_error = String(err);
    // Do not rewrite the whole outbox on a failed POST — the row is still unsent.
  }
}
