/**
 * Forever LAN — beta reliability stress (no WoW required).
 *
 * Covers CharDB Push / pending retention, repeated Push dedupe, crash mid-write,
 * collector offline→online, host restart, multi-character SV discovery,
 * multi-client outboxes, queue-cap drop policy, conservative migration leftovers.
 *
 * Run: node scripts/stress-reliability.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Outbox } from "../collector/outbox.js";
import { Egress } from "../collector/egress.js";
import {
  findSavedVariableFiles,
  readSavedVariablesSnapshot,
  collectEventsFromSavedVariablesText,
  pollSavedVariables,
} from "../collector/savedvars.js";
import { migrateAccountQueue } from "./lib/migration-identity.mjs";
import {
  MAX_PENDING,
  QUEUE_SOFT_WARN,
  trimPendingOverCap,
  pruneFlushedLowValuePending,
  pendingFullyFlushedToDisk,
  coalescePending,
} from "./lib/queue-cap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "foreverlan-reliability-"));
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

function luaEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function eventLua(ev) {
  const parts = Object.entries(ev).map(([k, v]) => {
    if (typeof v === "number") return `["${k}"] = ${v}`;
    if (typeof v === "boolean") return `["${k}"] = ${v ? "true" : "false"}`;
    return `["${k}"] = "${luaEscape(v)}"`;
  });
  return `{ ${parts.join(", ")} }`;
}

function clipExport(events) {
  return `FOREVERLAN_CLIP|${JSON.stringify({ events })}`;
}

function writeCharSv(filePath, { pending = [], exportEvents = null, seq = 1 } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let body = `ForeverLANCharDB = {\n  ["schema"] = 3,\n  ["seq"] = ${seq},\n`;
  if (exportEvents) {
    body += `  ["export"] = "${luaEscape(clipExport(exportEvents))}",\n`;
    body += `  ["last_flush_at"] = 1700000000,\n`;
    body += `  ["last_flush_count"] = ${exportEvents.length},\n`;
  }
  body += `  ["pending"] = {\n`;
  for (const ev of pending) body += `    ${eventLua(ev)},\n`;
  body += `  },\n}\n`;
  // Account leftovers file companion (same folder for account SV tests uses separate path)
  fs.writeFileSync(filePath, body, "utf8");
}

function writeAccountSv(filePath, { pending = [], characters = null } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let body = `ForeverLANDB = {\n  ["schema"] = 3,\n  ["pending"] = {\n`;
  for (const ev of pending) body += `    ${eventLua(ev)},\n`;
  body += `  },\n`;
  if (characters) {
    body += `  ["characters"] = {\n`;
    for (const [key, bucket] of Object.entries(characters)) {
      body += `    ["${luaEscape(key)}"] = {\n      ["pending"] = {\n`;
      for (const ev of bucket.pending || []) body += `        ${eventLua(ev)},\n`;
      body += `      },\n    },\n`;
    }
    body += `  },\n`;
  }
  body += `}\n`;
  fs.writeFileSync(filePath, body, "utf8");
}

console.log("\n[1] SavedVariablesPerCharacter — Push LAN semantics");

test("Push export + retained pending → collector sees each id once", () => {
  const f = path.join(tmpRoot, "push", "ForeverLAN.lua");
  const events = [
    { id: "p1", type: "LOGIN", ts: 100, character: "Alex River" },
    { id: "p2", type: "PLAYER_DIED", ts: 101, character: "Alex River" },
  ];
  // Push keeps pending AND writes export (addon contract)
  writeCharSv(f, { pending: events, exportEvents: events });
  const snap = readSavedVariablesSnapshot(f);
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 2);
  assert.deepEqual(
    snap.events.map((e) => e.id).sort(),
    ["p1", "p2"]
  );
});

test("forced exit without Push — pending-only CharDB still collectible", () => {
  const f = path.join(tmpRoot, "crash-no-push", "ForeverLAN.lua");
  const events = [{ id: "c1", type: "PLAYER_LEVEL_CHANGED", ts: 50, character: "Sam", level: 12 }];
  writeCharSv(f, { pending: events });
  const snap = readSavedVariablesSnapshot(f);
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.events[0].id, "c1");
  assert.ok(snap.via === "pending" || snap.via.includes("pending"));
});

test("mid-write truncate (crash during SV flush) → ok=false", () => {
  const f = path.join(tmpRoot, "truncate", "ForeverLAN.lua");
  writeCharSv(f, {
    pending: [{ id: "t1", type: "LOGIN", ts: 1, character: "Casey" }],
    exportEvents: [{ id: "t1", type: "LOGIN", ts: 1, character: "Casey" }],
  });
  const good = readSavedVariablesSnapshot(f);
  assert.equal(good.ok, true);
  const raw = fs.readFileSync(f, "utf8");
  // Cut inside the export string (classic mid-flush) and also leave braces open.
  const cutAt = raw.indexOf("FOREVERLAN_CLIP|") + "FOREVERLAN_CLIP|".length + 8;
  assert.ok(cutAt > 20, "fixture must contain export payload");
  fs.writeFileSync(f, raw.slice(0, cutAt), "utf8");
  const bad = readSavedVariablesSnapshot(f);
  assert.equal(bad.ok, false);
  assert.ok(bad.reason);
});

test("poll skips unchanged; recovers after rewrite", () => {
  const clientDir = path.join(tmpRoot, "poll-client");
  const f = path.join(
    clientDir,
    "WTF",
    "Account",
    "TEST",
    "Forever",
    "Jordan",
    "SavedVariables",
    "ForeverLAN.lua"
  );
  writeCharSv(f, { pending: [{ id: "u1", type: "LOGIN", ts: 1, character: "Jordan" }] });
  const seen = [];
  const poller = pollSavedVariables(clientDir, (events) => {
    seen.push(events.map((e) => e.id).sort().join(","));
  });
  try {
    assert.deepEqual(seen, ["u1"]);
    poller.scan(); // unchanged mtime/fingerprint → no second callback
    assert.deepEqual(seen, ["u1"]);
    writeCharSv(f, {
      pending: [
        { id: "u1", type: "LOGIN", ts: 1, character: "Jordan" },
        { id: "u2", type: "PLAYER_DIED", ts: 2, character: "Jordan" },
      ],
    });
    const st = fs.statSync(f);
    fs.utimesSync(f, st.atime, new Date(st.mtimeMs + 1000));
    poller.scan();
    assert.deepEqual(seen, ["u1", "u1,u2"]);
  } finally {
    clearInterval(poller);
  }
});

console.log("\n[2] Repeated Push + duplicate event handling");

test("repeated identical Push upsert does not duplicate outbox", () => {
  const p = path.join(tmpRoot, "outbox-push.jsonl");
  const box = new Outbox(p);
  const events = [
    { id: "rp1", type: "LOGIN", ts: 10 },
    { id: "rp2", type: "PLAYER_DIED", ts: 11 },
  ];
  for (let round = 0; round < 5; round++) {
    for (const ev of events) box.upsert(ev);
  }
  assert.equal(box.pendingCount(), 2);
});

test("export + pending same ids in one SV file merge once", () => {
  const events = [
    { id: "m1", type: "LOGIN", ts: 1, character: "Alex" },
    { id: "m2", type: "PING", ts: 2, character: "Alex" },
  ];
  const text = [
    `ForeverLANCharDB = {`,
    `  ["export"] = "${luaEscape(clipExport(events))}",`,
    `  ["pending"] = { ${events.map(eventLua).join(", ")} },`,
    `}`,
  ].join("\n");
  const { events: got } = collectEventsFromSavedVariablesText(text);
  assert.equal(got.length, 2);
});

console.log("\n[3] Collector offline → online + host restart");

await testAsync("offline POST failures leave outbox queued; online drains", async () => {
  const p = path.join(tmpRoot, "offline-online.jsonl");
  const box = new Outbox(p);
  const events = [
    { id: "oo1", type: "LOGIN", ts: Math.floor(Date.now() / 1000) - 600, character: "Sam" },
    { id: "oo2", type: "PLAYER_DIED", ts: Math.floor(Date.now() / 1000) - 590, character: "Sam" },
  ];
  for (const ev of events) box.upsert(ev);
  const egress = new Egress("http://127.0.0.1:9", "test-token");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED simulated host down");
    };
    for (const row of box.pending(10)) {
      try {
        await egress.send(row.event);
        box.markSent(row.event.id);
      } catch {
        /* stay queued */
      }
    }
    assert.equal(box.pendingCount(), 2);

    let posts = 0;
    globalThis.fetch = async () => {
      posts += 1;
      return { status: 201, text: async () => "" };
    };
    for (const row of box.pending(10)) {
      const res = await egress.send(row.event);
      assert.equal(res.ok, true);
      assert.equal(res.mode, "catch-up");
      box.markSent(row.event.id);
    }
    box.flush();
    assert.equal(box.pendingCount(), 0);
    assert.equal(posts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync("host restart: unsent survive; already-sent 409 is success", async () => {
  const p = path.join(tmpRoot, "host-restart.jsonl");
  const box = new Outbox(p);
  box.upsert({ id: "hr1", type: "LOGIN", ts: 1 });
  box.upsert({ id: "hr2", type: "PLAYER_DIED", ts: 2 });
  box.markSent("hr1");
  box.flush();

  const afterRestart = new Outbox(p);
  assert.equal(afterRestart.pendingCount(), 1);
  assert.equal(afterRestart.pending(5)[0].event.id, "hr2");

  const egress = new Egress("http://127.0.0.1:9", "tok");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 409, text: async () => "duplicate" });
    const res = await egress.send({ id: "hr1", type: "LOGIN", ts: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log("\n[4] Multiple characters + multiple LAN clients");

test("findSavedVariableFiles discovers account + per-character paths", () => {
  const client = path.join(tmpRoot, "wow-client");
  const account = path.join(client, "WTF", "Account", "TEST");
  const accountSv = path.join(account, "SavedVariables", "ForeverLAN.lua");
  const charA = path.join(account, "Forever", "NyanduBigglesworth", "SavedVariables", "ForeverLAN.lua");
  const charB = path.join(account, "Forever", "NyanduDostoevsky", "SavedVariables", "ForeverLAN.lua");
  writeAccountSv(accountSv, {
    pending: [{ id: "legacy-ambig", type: "DING", ts: 1, character: "Alex" }],
  });
  writeCharSv(charA, {
    pending: [{ id: "a1", type: "LOGIN", ts: 2, character: "Alex River" }],
  });
  writeCharSv(charB, {
    pending: [{ id: "b1", type: "LOGIN", ts: 3, character: "Alex Brook" }],
  });
  const found = findSavedVariableFiles(client).map((p) => p.replace(/\\/g, "/"));
  assert.ok(found.some((p) => p.endsWith("Account/TEST/SavedVariables/ForeverLAN.lua")));
  assert.ok(found.some((p) => p.includes("/NyanduBigglesworth/SavedVariables/")));
  assert.ok(found.some((p) => p.includes("/NyanduDostoevsky/SavedVariables/")));
  assert.equal(found.length, 3);

  const all = [];
  for (const f of found) {
    const snap = readSavedVariablesSnapshot(f);
    assert.equal(snap.ok, true);
    all.push(...snap.events);
  }
  const ids = all.map((e) => e.id).sort();
  assert.deepEqual(ids, ["a1", "b1", "legacy-ambig"]);
});

test("two LAN client outboxes drain independently (multi-PC)", () => {
  const a = new Outbox(path.join(tmpRoot, "client-a", "outbox.jsonl"));
  const b = new Outbox(path.join(tmpRoot, "client-b", "outbox.jsonl"));
  a.upsert({ id: "lan-a-1", type: "LOGIN", ts: 1, character: "Jordan" });
  b.upsert({ id: "lan-b-1", type: "LOGIN", ts: 1, character: "Casey" });
  // Same event id from two PCs is possible only if ids collide — host is idempotent;
  // here ids differ. Shared id would still be one row per outbox file.
  b.upsert({ id: "lan-a-1", type: "LOGIN", ts: 1, character: "Jordan" });
  assert.equal(a.pendingCount(), 1);
  assert.equal(b.pendingCount(), 2);
  a.markSent("lan-a-1");
  a.flush();
  assert.equal(a.pendingCount(), 0);
  assert.equal(b.pendingCount(), 2, "client B outbox must not clear when A marks sent");
});

console.log("\n[5] Queue cap behavior");

test("queue soft-warn threshold matches addon (1200 of 1500)", () => {
  assert.equal(MAX_PENDING, 1500);
  assert.equal(QUEUE_SOFT_WARN, 1200);
});

test("coalesce keeps one distance/money/map row per stream; remints after Push", () => {
  let pending = [];
  let r = coalescePending(pending, "PLAYER_DISTANCE", {
    id: "d1",
    ts: 10,
    guid: "G1",
    distance_yards: 120,
  });
  pending = r.pending;
  assert.equal(r.coalesced, false);
  r = coalescePending(
    pending,
    "PLAYER_DISTANCE",
    { guid: "G1", distance_yards: 400, jumps: 16 },
    { nowTs: 20 }
  );
  pending = r.pending;
  assert.equal(r.coalesced, true);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "d1");
  assert.equal(pending[0].ts, 20);
  assert.equal(pending[0].distance_yards, 400);
  assert.equal(pending[0].jumps, 16);

  // After Push, flushed row must not absorb updates (host needs a new id).
  r = coalescePending(
    pending,
    "PLAYER_DISTANCE",
    { id: "d2", guid: "G1", distance_yards: 500 },
    { flushedAt: 20, nowTs: 30 }
  );
  pending = r.pending;
  assert.equal(r.coalesced, false);
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "d2");
  assert.equal(pending[1].ts, 30);

  r = coalescePending(pending, "PLAYER_MAP_OPENED", {
    id: "m1",
    ts: 11,
    guid: "G1",
    map_kind: "world_map",
    opens: 1,
  });
  pending = r.pending;
  r = coalescePending(pending, "PLAYER_MAP_OPENED", {
    guid: "G1",
    map_kind: "minimap",
    opens: 2,
    id: "m2",
    ts: 12,
  });
  pending = r.pending;
  assert.equal(pending.filter((e) => e.type === "PLAYER_MAP_OPENED").length, 2);

  r = coalescePending(pending, "PLAYER_CRAFT", { id: "c1", ts: 13, guid: "G1", spell: "A" });
  pending = r.pending;
  r = coalescePending(pending, "PLAYER_CRAFT", { id: "c2", ts: 14, guid: "G1", spell: "B" });
  pending = r.pending;
  assert.equal(pending.filter((e) => e.type === "PLAYER_CRAFT").length, 2);
});

test("coalesce snapshot drops stale fields omitted on the next emit", () => {
  let pending = [
    { id: "f1", type: "PLAYER_FOOD_BUFF", guid: "G1", ts: 1, food_buff: "Steak", well_fed: true },
  ];
  const r = coalescePending(pending, "PLAYER_FOOD_BUFF", { guid: "G1", well_fed: false }, { nowTs: 2 });
  assert.equal(r.coalesced, true);
  assert.equal(r.event.food_buff, undefined);
  assert.equal(r.event.well_fed, false);
});

test("over cap drops DROP_UNDER_PRESSURE before LOGIN/DIED/LEVEL", () => {
  const pending = [];
  for (let i = 0; i < 1400; i++) {
    pending.push({ id: `login-${i}`, type: "LOGIN", ts: i });
  }
  for (let i = 0; i < 200; i++) {
    pending.push({ id: `dist-${i}`, type: "PLAYER_DISTANCE", ts: 10000 + i });
  }
  // 1600 events → drop 100 pressure types first
  const { pending: kept, dropped } = trimPendingOverCap(pending, MAX_PENDING);
  assert.equal(kept.length, MAX_PENDING);
  assert.equal(dropped.length, 100);
  assert.ok(dropped.every((e) => e.type === "PLAYER_DISTANCE"));
  assert.ok(kept.every((e) => e.type === "LOGIN" || e.type === "PLAYER_DISTANCE"));
  assert.equal(kept.filter((e) => e.type === "LOGIN").length, 1400);
  assert.equal(kept.filter((e) => e.type === "PLAYER_DISTANCE").length, 100);
});

test("when only high-signal remains, oldest drops", () => {
  const pending = [];
  for (let i = 0; i < MAX_PENDING + 5; i++) {
    pending.push({ id: `ding-${i}`, type: "PLAYER_LEVEL_CHANGED", ts: i });
  }
  const { pending: kept, dropped } = trimPendingOverCap(pending);
  assert.equal(kept.length, MAX_PENDING);
  assert.equal(dropped.length, 5);
  assert.equal(dropped[0].id, "ding-0");
  assert.equal(kept[0].id, "ding-5");
});

test("over cap drops already-flushed rows before unflushed noise", () => {
  const pending = [];
  for (let i = 0; i < 50; i++) {
    pending.push({ id: `newdist-${i}`, type: "PLAYER_DISTANCE", ts: 20000 });
  }
  for (let i = 0; i < 1400; i++) {
    pending.push({ id: `login-${i}`, type: "LOGIN", ts: 10000 });
  }
  for (let i = 0; i < 150; i++) {
    pending.push({ id: `olddist-${i}`, type: "PLAYER_DISTANCE", ts: 1 });
  }
  const { pending: kept, dropped } = trimPendingOverCap(pending, MAX_PENDING, 5000);
  assert.equal(kept.length, MAX_PENDING);
  assert.equal(dropped.length, 100);
  assert.ok(dropped.every((e) => String(e.id).startsWith("olddist-")));
  assert.equal(kept.filter((e) => String(e.id).startsWith("newdist-")).length, 50);
});

test("after Push, prune flushed low-value until soft-warn; suppress full-flush nag", () => {
  const flushedAt = 1000;
  const pending = [];
  for (let i = 0; i < 1400; i++) {
    pending.push({ id: `p-${i}`, type: "PLAYER_POWER_STATS", ts: 500 + (i % 400) });
  }
  for (let i = 0; i < 100; i++) {
    pending.push({ id: `d-${i}`, type: "PLAYER_LEVEL_CHANGED", ts: 600 });
  }
  assert.equal(pendingFullyFlushedToDisk(pending, flushedAt), true);
  const { pending: kept, dropped } = pruneFlushedLowValuePending(pending, flushedAt);
  assert.equal(dropped.length, 1400);
  assert.equal(kept.length, 100);
  assert.equal(kept.filter((e) => e.type === "PLAYER_LEVEL_CHANGED").length, 100);
  assert.equal(pendingFullyFlushedToDisk(kept, flushedAt), true);
  kept.push({ id: "new", type: "PLAYER_DIED", ts: flushedAt + 1 });
  assert.equal(pendingFullyFlushedToDisk(kept, flushedAt), false);
});

console.log("\n[6] Migration leftover + CharDB coexistence");

test("ambiguous legacy stays on account; safe GUID migrates once", () => {
  const player = {
    guid: "Player-1-BIGG",
    fullName: "Alex River",
    firstName: "Alex",
    lastName: "River",
    realm: "Forever",
    charKey: "Alex River-Forever",
  };
  const accountDb = {
    pending: [
      { id: "safe", type: "LOGIN", character: "Alex River", realm: "Forever", guid: "Player-1-BIGG" },
      { id: "ambig", type: "DING", character: "Alex" },
    ],
  };
  const charDb = { pending: [] };
  const r1 = migrateAccountQueue(accountDb, charDb, player);
  assert.equal(r1.skipped, false);
  assert.equal(charDb.pending.map((e) => e.id).join(","), "safe");
  assert.ok(accountDb.pending.some((e) => e.id === "ambig"));
  assert.ok(!accountDb.pending.some((e) => e.id === "safe"));

  const r2 = migrateAccountQueue(accountDb, charDb, player);
  assert.equal(r2.skipped, true);
  assert.equal(charDb.pending.length, 1);
});

test("account leftover + CharDB file merge without inventing ids", () => {
  const text = [
    `ForeverLANCharDB = { ["pending"] = { ${eventLua({ id: "char-1", type: "LOGIN", ts: 1 })} }, }`,
    `ForeverLANDB = { ["pending"] = { ${eventLua({ id: "acct-1", type: "DING", ts: 2, character: "Alex" })} }, }`,
  ].join("\n");
  const { events } = collectEventsFromSavedVariablesText(text);
  assert.deepEqual(events.map((e) => e.id).sort(), ["acct-1", "char-1"]);
});

console.log("\n[7] Cleanup");
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  ok("temp dir removed");
} catch (err) {
  fail("cleanup", err);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nUNCERTAIN / NEEDS FOREVER CLIENT:");
  console.log("  - actual C_UI.Reload / logout SV write timing");
  console.log("  - WoW crash before SV flush (RAM queue loss — expected)");
  process.exit(1);
}
console.log("\nNote: WoW crash before disk flush cannot be regression-tested here (no ForceSave).");
process.exit(0);
