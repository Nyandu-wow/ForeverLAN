/**
 * Persistence boundary tests — SavedVariables poll + outbox durability + single-instance lock.
 * Run: node scripts/test-persistence.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { Outbox } from "../collector/outbox.js";
import {
  readSavedVariablesSnapshot,
  readEventsFromSavedVariables,
  pollSavedVariables,
} from "../collector/savedvars.js";
import { Egress } from "../collector/egress.js";
import { acquireCollectorLock } from "../collector/instance-lock.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foreverlan-persist-"));
let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ok  ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  FAIL ${name}: ${err?.message || err}`);
}

function test(name, fn) {
  try {
    fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function writeSv(filePath, { exportPayload, pendingLua, truncated = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let body = `ForeverLANDB = {\n`;
  if (exportPayload != null) {
    const escaped = String(exportPayload)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    body += `  ["export"] = "${escaped}",\n`;
  }
  if (pendingLua != null) {
    body += `  ["pending"] = ${pendingLua},\n`;
  } else {
    body += `  ["pending"] = {\n  },\n`;
  }
  body += `  ["seq"] = 1,\n`;
  body += `}\n`;
  if (truncated) {
    // Cut mid-export string / mid-table.
    body = body.slice(0, Math.floor(body.length * 0.55));
  }
  fs.writeFileSync(filePath, body, "utf8");
}

function clipExport(events) {
  return `FOREVERLAN_CLIP|${JSON.stringify({ events })}`;
}

console.log("\n[1] SavedVariables snapshots");

const svDir = path.join(tmpRoot, "sv");
const svFile = path.join(svDir, "ForeverLAN.lua");

test("valid export snapshot", () => {
  const events = [
    { id: "a-1", type: "LOGIN", ts: 100, character: "Alex" },
    { id: "a-2", type: "PLAYER_DIED", ts: 101, character: "Alex" },
  ];
  writeSv(svFile, { exportPayload: clipExport(events) });
  const snap = readSavedVariablesSnapshot(svFile);
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 2);
  assert.equal(snap.via, "export");
  assert.ok(snap.fingerprint);
});

test("unchanged fingerprint is stable", () => {
  const a = readSavedVariablesSnapshot(svFile);
  const b = readSavedVariablesSnapshot(svFile);
  assert.equal(a.fingerprint, b.fingerprint);
});

test("temporarily malformed/partial SavedVariables → ok=false", () => {
  writeSv(svFile, {
    exportPayload: clipExport([{ id: "x", type: "LOGIN", ts: 1 }]),
    truncated: true,
  });
  const snap = readSavedVariablesSnapshot(svFile);
  assert.equal(snap.ok, false);
  assert.equal(readEventsFromSavedVariables(svFile).length, 0);
});

test("valid pending fallback", () => {
  writeSv(svFile, {
    pendingLua: `{
      {
        ["id"] = "p-1",
        ["type"] = "PLAYER_LEVEL_CHANGED",
        ["ts"] = 50,
        ["character"] = "Sam",
      },
    }`,
  });
  const snap = readSavedVariablesSnapshot(svFile);
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.events[0].id, "p-1");
});

await testAsync("poll skips unchanged; retries partial without destroying prior", async () => {
  const clientDir = path.join(tmpRoot, "wow");
  const accountSv = path.join(
    clientDir,
    "WTF",
    "Account",
    "TEST",
    "SavedVariables",
    "ForeverLAN.lua"
  );
  const good = [{ id: "g-1", type: "LOGIN", ts: 10 }];
  writeSv(accountSv, { exportPayload: clipExport(good) });

  const seen = [];
  let timer;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(timer);
      reject(new Error("poll timeout"));
    }, 8000);
    timer = pollSavedVariables(clientDir, (events) => {
      seen.push(events.map((e) => e.id).join(","));
      if (seen.length === 1) {
        // Rewrite as partial — must not fire a second empty success.
        writeSv(accountSv, {
          exportPayload: clipExport([{ id: "g-2", type: "LOGIN", ts: 11 }]),
          truncated: true,
        });
        // Then complete write.
        setTimeout(() => {
          writeSv(accountSv, {
            exportPayload: clipExport([
              { id: "g-1", type: "LOGIN", ts: 10 },
              { id: "g-2", type: "LOGIN", ts: 11 },
            ]),
          });
        }, 200);
      }
      if (seen.length >= 2) {
        clearTimeout(timeout);
        clearInterval(timer);
        resolve();
      }
    });
  });
  assert.ok(seen[0].includes("g-1"));
  assert.ok(seen[1].includes("g-2"));
});

console.log("\n[2] Outbox durability");

const outboxPath = path.join(tmpRoot, "outbox.jsonl");

test("outbox append + idempotent upsert", () => {
  if (fs.existsSync(outboxPath)) fs.unlinkSync(outboxPath);
  const box = new Outbox(outboxPath);
  const ev = { id: "e1", type: "LOGIN", ts: 1 };
  const first = box.upsert(ev);
  assert.equal(first.inserted, true);
  assert.equal(first.durable, true);
  assert.equal(box.isDurable("e1"), true);
  assert.equal(box.upsert(ev).inserted, false);
  assert.equal(box.pendingCount(), 1);
  assert.equal(box.stats().awaiting_delivery, 1);
  assert.ok(box.stats().file_bytes > 0);
});

test("outbox marks loaded rows durable", () => {
  const p = path.join(tmpRoot, "durable-load.jsonl");
  const row = {
    event: { id: "d1", type: "LOGIN", ts: 1 },
    received_at: new Date().toISOString(),
    sent_at: null,
    attempts: 0,
    last_error: null,
  };
  fs.writeFileSync(p, JSON.stringify(row) + "\n", "utf8");
  const box = new Outbox(p);
  assert.equal(box.isDurable("d1"), true);
});

test("outbox partial final line recovery", () => {
  const p = path.join(tmpRoot, "partial.jsonl");
  const good = JSON.stringify({
    event: { id: "keep-1", type: "LOGIN", ts: 1 },
    received_at: new Date().toISOString(),
    sent_at: null,
    attempts: 0,
    last_error: null,
  });
  fs.writeFileSync(p, good + "\n{\"event\":{\"id\":\"broken\"", "utf8"); // no trailing newline, incomplete
  const box = new Outbox(p);
  assert.equal(box.recoveredPartialLine, true);
  assert.equal(box.pendingCount(), 1);
  assert.ok(box.byId.has("keep-1"));
  assert.equal(box.byId.has("broken"), false);
  const disk = fs.readFileSync(p, "utf8");
  assert.ok(disk.includes("keep-1"));
  assert.equal(disk.includes("broken"), false);
});

await testAsync("successful markSent + rewrite keeps unsent", async () => {
  const p = path.join(tmpRoot, "sent.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  box.upsert({ id: "s1", type: "LOGIN", ts: 1 });
  box.upsert({ id: "s2", type: "PLAYER_DIED", ts: 2 });
  box.markSent("s1");
  box.flush();
  assert.equal(box.pendingCount(), 1);
  assert.ok(box.byId.has("s2"));
  const reloaded = new Outbox(p);
  assert.equal(reloaded.pendingCount(), 1);
  assert.ok(reloaded.byId.has("s1")); // retained recent sent
  assert.ok(reloaded.byId.has("s2"));
});

await testAsync("rewrite failure leaves original file", async () => {
  const p = path.join(tmpRoot, "rewrite-fail.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  box.upsert({ id: "r1", type: "LOGIN", ts: 1 });
  const before = fs.readFileSync(p, "utf8");
  const realRename = fs.renameSync;
  const realCopy = fs.copyFileSync;
  let renamed = false;
  fs.renameSync = () => {
    renamed = true;
    const err = new Error("simulated rename failure");
    err.code = "EPERM";
    throw err;
  };
  fs.copyFileSync = () => {
    throw new Error("simulated copy failure");
  };
  try {
    box.markSent("r1");
    box.flush();
  } finally {
    fs.renameSync = realRename;
    fs.copyFileSync = realCopy;
  }
  assert.equal(renamed, true);
  const after = fs.readFileSync(p, "utf8");
  assert.equal(after, before);
  const reloaded = new Outbox(p);
  assert.equal(reloaded.pendingCount(), 1);
});

await testAsync("windows-style rename-fail still replaces via copy", async () => {
  const p = path.join(tmpRoot, "rewrite-win.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  box.upsert({ id: "w1", type: "LOGIN", ts: 1 });
  box.upsert({ id: "w2", type: "PLAYER_DIED", ts: 2 });
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error("EPERM");
    err.code = "EPERM";
    throw err;
  };
  try {
    box.markSent("w1");
    box.flush();
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(box.pendingCount(), 1);
  const reloaded = new Outbox(p);
  assert.equal(reloaded.pendingCount(), 1);
  assert.ok(reloaded.byId.has("w1"));
  assert.ok(reloaded.byId.get("w1").sent_at);
});

console.log("\n[3] Egress status handling (mock fetch)");

await testAsync("201 and 409 both succeed; other status fails", async () => {
  const originalFetch = globalThis.fetch;
  const egress = new Egress("http://127.0.0.1:9", "tok");
  try {
    globalThis.fetch = async () => ({ status: 201, text: async () => "" });
    assert.equal((await egress.send({ id: "1", type: "LOGIN", ts: 1 })).ok, true);

    globalThis.fetch = async () => ({ status: 409, text: async () => "" });
    assert.equal((await egress.send({ id: "1", type: "LOGIN", ts: 1 })).ok, true);

    globalThis.fetch = async () => ({ status: 500, text: async () => "nope" });
    let threw = false;
    try {
      await egress.send({ id: "2", type: "LOGIN", ts: 2 });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("failed POST leaves outbox queued; 409 marks sent", async () => {
  const p = path.join(tmpRoot, "egress-box.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  box.upsert({ id: "h1", type: "LOGIN", ts: 100 });
  box.upsert({ id: "h2", type: "LOGIN", ts: 101 });

  const originalFetch = globalThis.fetch;
  const egress = new Egress("http://127.0.0.1:9", "tok");
  try {
    globalThis.fetch = async () => {
      throw new Error("host unavailable");
    };
    for (const row of box.pending(10)) {
      try {
        await egress.send(row.event);
        box.markSent(row.event.id);
      } catch (err) {
        box.markFailure(row.event.id, err.message);
        break;
      }
    }
    box.flush();
    assert.equal(box.pendingCount(), 2);

    globalThis.fetch = async () => ({ status: 201, text: async () => "" });
    for (const row of box.pending(10)) {
      await egress.send(row.event);
      box.markSent(row.event.id);
    }
    // Re-send same ids → 409 still ok
    globalThis.fetch = async () => ({ status: 409, text: async () => "" });
    await egress.send({ id: "h1", type: "LOGIN", ts: 100 });
    box.flush();
    assert.equal(box.pendingCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("collector restart with queued events", async () => {
  const p = path.join(tmpRoot, "restart.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  box.upsert({ id: "rs-1", type: "PLAYER_DIED", ts: 50 });
  box.upsert({ id: "rs-2", type: "PLAYER_LEVEL_CHANGED", ts: 51 });
  assert.equal(box.pendingCount(), 2);
  const again = new Outbox(p);
  assert.equal(again.pendingCount(), 2);
  const order = again.pending(10).map((r) => r.event.id);
  assert.deepEqual(order, ["rs-1", "rs-2"]);
});

await testAsync("repeated identical SV snapshot does not duplicate outbox rows", async () => {
  const p = path.join(tmpRoot, "dedupe.jsonl");
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const box = new Outbox(p);
  const events = [
    { id: "dup-1", type: "LOGIN", ts: 1 },
    { id: "dup-2", type: "PLAYER_DIED", ts: 2 },
  ];
  for (const ev of events) box.upsert(ev);
  for (const ev of events) box.upsert(ev); // second Push / reread
  assert.equal(box.pendingCount(), 2);
});

console.log("\n[4] Single-instance lock");

test("second lock acquire fails while first is held", () => {
  const lockPath = path.join(tmpRoot, "collector.lock");
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
  const a = acquireCollectorLock(lockPath);
  assert.equal(a.ok, true);
  const b = acquireCollectorLock(lockPath);
  assert.equal(b.ok, false);
  assert.ok(
    b.reason === "another_collector_running" || b.reason === "already_held_by_self",
    `unexpected reason ${b.reason}`
  );
  a.release();
  const c = acquireCollectorLock(lockPath);
  assert.equal(c.ok, true);
  c.release();
});

console.log("\n[5] Cleanup");
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  ok("temp dir removed");
} catch (err) {
  fail("cleanup", err);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
