/**
 * End-to-end host smoke on a throwaway data dir (never the weekend log).
 * Boots host/server.js on loopback with the LAN beacon off, then checks:
 *  - smoke probes (any case) are acknowledged but not stored
 *  - duplicate ids → 409; catch-up events keep original ts
 *  - a poison event cannot take the board down (live apply + host restart rebuild)
 *  - /lan, /api/v1/catalog, /api/v1/character agree on deaths / levels / identity
 *   node scripts/smoke-host-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foreverlan-e2e-"));
const port = 18000 + Math.floor(Math.random() * 1000);
const token = "e2e-token";
const base = `http://127.0.0.1:${port}`;
const configPath = path.join(tmp, "config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify({
    dataDir: path.join(tmp, "data"),
    listenHost: "127.0.0.1",
    listenPort: port,
    lanToken: token,
    lanBeacon: false,
    lanName: "E2E",
    lanRoster: ["Alex River", "Sam Hill", "Jordan Vale", "Casey Brook"],
    lanLevelCap: 60,
  })
);

let host = null;
async function startHost() {
  host = spawn(process.execPath, [path.join(root, "host", "server.js")], {
    env: { ...process.env, FOREVERLAN_CONFIG: configPath, FOREVERLAN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  host.stdout.on("data", (d) => (log += d));
  host.stderr.on("data", (d) => (log += d));
  host.logText = () => log;
  for (let i = 0; i < 100; i++) {
    try {
      const h = await (await fetch(`${base}/health`)).json();
      if (h.ready) return h;
    } catch {
      /* booting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`host did not become ready:\n${log}`);
}
async function stopHost() {
  if (!host) return;
  const done = new Promise((r) => host.once("exit", r));
  host.kill();
  await done;
  host = null;
}
async function post(ev, mode) {
  const headers = { "content-type": "application/json", "x-foreverlan-token": token };
  if (mode) headers["x-foreverlan-mode"] = mode;
  const res = await fetch(`${base}/events`, { method: "POST", headers, body: JSON.stringify(ev) });
  return { status: res.status, body: await res.json() };
}
const get = async (p) => (await fetch(`${base}${p}`)).json();
async function settle(pred, label) {
  for (let i = 0; i < 80; i++) {
    const lan = await get("/lan");
    if (pred(lan)) return lan;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("ok  ", name);
}

const now = Math.floor(Date.now() / 1000);
const A = "Player-9-BIGG";
const self = { v: 1, source: "addon", is_self: true, character: "Alex River", guid: A };

try {
  await startHost();

  await test("smoke probes are acknowledged but never stored (any case)", async () => {
    for (const ev of [
      { id: "smoke-x1", type: "PING", source: "SMOKE" },
      { id: "catchup-smoke-x2", type: "PLAYER_LEVEL_CHANGED", source: "smoke", character: "Alex River", level: 10, old_level: 9, ts: now - 86400 },
    ]) {
      const r = await post(ev);
      assert.equal(r.status, 200);
      assert.equal(r.body.ignored, true);
    }
    const h = await get("/health");
    assert.equal(h.events, 0);
  });

  await test("live events land on the board; duplicate id → 409", async () => {
    assert.equal((await post({ ...self, id: "e1", type: "LOGIN", ts: now - 60, level: 1 }, "live")).status, 201);
    assert.equal((await post({ ...self, id: "e2", type: "PLAYER_LEVEL_CHANGED", ts: now - 30, old_level: 1, level: 2 }, "live")).status, 201);
    assert.equal((await post({ ...self, id: "e2", type: "PLAYER_LEVEL_CHANGED", ts: now - 30, old_level: 1, level: 2 })).status, 409);
    const lan = await settle((l) => l.players?.[0]?.level === 2, "live ding");
    assert.equal(lan.players[0].levels_gained, 1);
  });

  await test("malformed roster (null members) is stored and cannot stall the board", async () => {
    const r = await post({ ...self, id: "poison-roster", type: "PARTY_ROSTER", ts: now - 20, members: [null, 7] }, "live");
    assert.equal(r.status, 201);
    assert.equal((await post({ ...self, id: "e3", type: "PLAYER_DIED", ts: now - 10, level: 2 }, "live")).status, 201);
    await settle((l) => l.players?.[0]?.deaths === 1, "death after poison");
  });

  await test("catch-up backlog keeps original ts and rebuilds chronologically", async () => {
    const friday = now - 20 * 3600;
    assert.equal((await post({ ...self, id: "c0", type: "LOGIN", ts: friday - 5, level: 1 }, "catch-up")).status, 201);
    const lan = await settle((l) => l.players?.[0]?.first_seen_at === new Date((friday - 5) * 1000).toISOString(), "catch-up rebuild");
    assert.equal(lan.players[0].start_level, 1);
    assert.equal(lan.players[0].level, 2);
  });

  const checkApis = async (label) => {
    const lan = await get("/lan");
    const catalog = await get("/api/v1/catalog");
    const p = lan.players[0];
    const c = catalog.characters.find((x) => x.guid === p.guid);
    assert.equal(catalog.source, "lan-session");
    assert.equal(c.character, p.character, `${label}: identity`);
    assert.equal(c.deaths, p.deaths, `${label}: deaths`);
    assert.equal(catalog.deaths.length, p.deaths, `${label}: death rows`);
    assert.equal(c.levels_gained, p.levels_gained, `${label}: levels`);
    const detail = await get(`/api/v1/character?guid=${encodeURIComponent(p.guid)}`);
    assert.equal(detail.deaths.length, p.deaths, `${label}: detail deaths`);
    assert.equal(detail.sessions.reduce((a, s) => a + s.deaths, 0), p.deaths, `${label}: session deaths`);
    assert.equal(detail.sessions.reduce((a, s) => a + s.dings, 0), (p.ding_times || []).length, `${label}: session dings`);
    const timeline = await get(`/api/v1/timeline?character=${encodeURIComponent(p.character)}`);
    assert(timeline.rows.every((r) => !String(r.id).includes("smoke")), `${label}: no smoke rows in timeline`);
    assert.equal(typeof timeline.total, "number", `${label}: timeline total`);
    assert.equal(typeof timeline.limit, "number", `${label}: timeline limit`);
    assert.equal(typeof timeline.truncated, "boolean", `${label}: timeline truncated`);
    assert.ok(timeline.rows.length <= timeline.limit, `${label}: timeline respects limit`);
    assert.ok(lan.meta?.display_time_zone, `${label}: /lan exposes display_time_zone`);
    assert.equal(catalog.display_time_zone, lan.meta.display_time_zone, `${label}: catalog tz matches /lan`);
  };

  await test("Live /lan == Explore catalog == character detail (deaths, dings, identity)", () => checkApis("live"));

  await test("host restart replays the log (malformed roster included) to the same board", async () => {
    const before = await get("/lan");
    await stopHost();
    const h = await startHost();
    // e1, e2, poison-roster, e3, c0 — the duplicate e2 and both smoke probes were never stored.
    assert.equal(h.events, 5, "every stored event survives restart, nothing else");
    assert.equal(h.fold_errors, 0);
    const after = await get("/lan");
    const pick = (l) => l.players.map((p) => [p.character, p.level, p.start_level, p.deaths, p.first_seen_at]);
    assert.deepEqual(pick(after), pick(before));
    await checkApis("after restart");
  });
} finally {
  await stopHost();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nsmoke-host-e2e: PASS (${passed} checks)`);
