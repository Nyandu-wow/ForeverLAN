/**
 * Forever LAN — host pipeline stress + light pentest (local / authorized).
 *
 * Simulates several friend collectors POSTing /events concurrently.
 * Does NOT drive the WoW addon (can't); stresses the path after Push/logout
 * (collector → POST /events → jsonl/sqlite → board rebuild → /lan).
 *
 *   node scripts/stress-host-pipeline.mjs
 *   node scripts/stress-host-pipeline.mjs --clients 4 --events 80
 *   node scripts/stress-host-pipeline.mjs --http-only   # SMOKE path, nothing stored
 *
 * Default PERSISTS loadtest-* events into the weekend log (unique ids).
 * Prefer running against a throwaway dataset, or accept ~clients*events rows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DEFAULT_LAN_ROSTER } from "../collector/lan-roster.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const host = (arg("host", process.env.FOREVERLAN_HOST || "http://127.0.0.1:8765")).replace(/\/$/, "");
const token = arg("token", process.env.FOREVERLAN_TOKEN || cfg.lanToken || "");
const clients = Math.max(1, Number(arg("clients", "4")) || 4);
const eventsPerClient = Math.max(1, Number(arg("events", "60")) || 60);
const concurrency = Math.max(1, Number(arg("concurrency", "12")) || 12);
const httpOnly = flag("http-only");
const modeOverride = arg("mode", ""); // "", "live", "catch-up"
const runId = `lt${Date.now().toString(36)}`;

if (!token) {
  console.error("Missing lanToken");
  process.exit(1);
}

const ROSTER = DEFAULT_LAN_ROSTER;
const ZONES = ["Elwynn Forest", "Westfall", "Loch Modan", "Teldrassil", "Dun Morogh", "Darkshore"];

const stats = {
  ok: 0,
  created: 0,
  dup: 0,
  smoke: 0,
  unauthorized: 0,
  bad: 0,
  other: 0,
  errors: 0,
  latencies: [],
};

async function health() {
  const r = await fetch(`${host}/health`);
  return { status: r.status, body: await r.json() };
}

async function postEvent(ev, headers = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${host}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": token,
        ...headers,
      },
      body: JSON.stringify(ev),
    });
    const ms = performance.now() - t0;
    stats.latencies.push(ms);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.status === 201) stats.created += 1;
    else if (res.status === 409) stats.dup += 1;
    else if (res.status === 200 && body?.ignored) stats.smoke += 1;
    else if (res.status === 401) stats.unauthorized += 1;
    else if (res.status === 400) stats.bad += 1;
    else stats.other += 1;
    if (res.status >= 200 && res.status < 300) stats.ok += 1;
    return { status: res.status, body, ms };
  } catch (err) {
    stats.errors += 1;
    return { status: 0, error: String(err.message || err), ms: performance.now() - t0 };
  }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function makeClientEvents(clientIndex) {
  const who = `LoadTest${clientIndex + 1}`;
  const guid = `Player-LoadTest-${runId}-${clientIndex}`;
  const baseTs = Math.floor(Date.now() / 1000) - (httpOnly || modeOverride === "live" ? 0 : 3600); // catch-up aged unless http-only/live
  const events = [];
  const push = (type, extra = {}, seq) => {
    const id = httpOnly
      ? `smoke-${runId}-c${clientIndex}-${seq}`
      : `loadtest-${runId}-c${clientIndex}-${seq}`;
    events.push({
      id,
      ts: baseTs + seq,
      type,
      character: who,
      class: ["Warrior", "Mage", "Priest", "Rogue"][clientIndex % 4],
      level: 10 + (seq % 20),
      zone: ZONES[seq % ZONES.length],
      guid,
      is_self: true,
      source: httpOnly ? "SMOKE" : "LOADTEST",
      ...extra,
    });
  };

  let seq = 0;
  push("LOGIN", {}, seq++);
  push("PLAYER_PLAYING", {}, seq++);
  push(
    "PARTY_ROSTER",
    {
      in_group: true,
      group_size: Math.min(clients, 4),
      members: ROSTER.slice(0, Math.min(clients, 4)).map((name, i) => ({
        character: name,
        online: true,
        level: 12 + i,
      })),
    },
    seq++
  );
  while (events.length < eventsPerClient) {
    const kind = seq % 7;
    if (kind === 0) push("PLAYER_ZONE_CHANGED", { zone: ZONES[seq % ZONES.length] }, seq++);
    else if (kind === 1) push("PLAYER_LEVEL_CHANGED", { level: 10 + (seq % 40), old_level: 9 + (seq % 40) }, seq++);
    else if (kind === 2) push("PLAYER_DIED", {}, seq++);
    else if (kind === 3) push("PLAYER_RESURRECTED", { corpse_run_seconds: 40 + (seq % 30) }, seq++);
    else if (kind === 4) push("PLAYER_QUESTS", { quests_completed: 50 + seq, quests_in_log: 5 }, seq++);
    else if (kind === 5) push("PLAYER_POWER_STATS", { attack_power: 100 + seq, spell_power: 20 }, seq++);
    else push("PLAYER_DISTANCE", { distance_yards: 100 + seq * 3, jumps: seq % 9 }, seq++);
  }
  return events;
}

async function pentestProbes() {
  const findings = [];
  const base = {
    id: `smoke-pentest-${runId}-1`,
    ts: Math.floor(Date.now() / 1000),
    type: "PING",
    character: "SmokeFriend",
    source: "SMOKE",
  };

  // 1) No token
  {
    const res = await fetch(`${host}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(base),
    });
    findings.push({
      name: "reject missing token",
      expect: 401,
      got: res.status,
      pass: res.status === 401,
    });
  }

  // 2) Wrong token
  {
    const res = await fetch(`${host}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": "definitely-not-the-token",
      },
      body: JSON.stringify({ ...base, id: `smoke-pentest-${runId}-2` }),
    });
    findings.push({
      name: "reject bad token",
      expect: 401,
      got: res.status,
      pass: res.status === 401,
    });
  }

  // 3) Malformed JSON
  {
    const res = await fetch(`${host}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": token,
      },
      body: "{not-json",
    });
    findings.push({
      name: "reject malformed JSON",
      expect: 400,
      got: res.status,
      pass: res.status === 400,
    });
  }

  // 4) Missing id/type
  {
    const r = await postEvent({ character: "x", source: "SMOKE" });
    findings.push({
      name: "reject missing id/type",
      expect: 400,
      got: r.status,
      pass: r.status === 400,
    });
  }

  // 5) Oversized body (~8MB) — expect hang/reject/400/413; must not crash host
  {
    const big = {
      id: `smoke-pentest-${runId}-big`,
      ts: Math.floor(Date.now() / 1000),
      type: "PING",
      character: "SmokeFriend",
      source: "SMOKE",
      blob: "x".repeat(8 * 1024 * 1024),
    };
    const t0 = performance.now();
    let status = 0;
    let err = null;
    try {
      const res = await fetch(`${host}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-foreverlan-token": token,
        },
        body: JSON.stringify(big),
        signal: AbortSignal.timeout(20000),
      });
      status = res.status;
      await res.text().catch(() => "");
    } catch (e) {
      err = String(e.message || e);
    }
    const ms = performance.now() - t0;
    let healthy = false;
    try {
      const h = await health();
      healthy = h.status === 200 && h.body?.ok;
    } catch {
      healthy = false;
    }
    findings.push({
      name: "8MB body does not kill host",
      expect: "host still /health ok",
      got: err ? `error:${err}` : `status=${status} ${ms.toFixed(0)}ms`,
      pass: healthy,
      note: "No body size limit on readBody — DoS surface on LAN",
    });
  }

  // 6) Prototype-pollution shaped payload (should not crash; may store as smoke)
  {
    const r = await postEvent({
      id: `smoke-pentest-${runId}-proto`,
      ts: Math.floor(Date.now() / 1000),
      type: "PING",
      character: "SmokeFriend",
      source: "SMOKE",
      "__proto__": { admin: true },
      constructor: { prototype: { polluted: true } },
    });
    let healthy = false;
    try {
      const h = await health();
      healthy = h.status === 200 && h.body?.ok;
    } catch {
      healthy = false;
    }
    findings.push({
      name: "prototype-shaped JSON survives",
      expect: "2xx/4xx + host up",
      got: `status=${r.status}`,
      pass: healthy && r.status > 0,
    });
  }

  // 7) Discover unauthenticated info leak check
  {
    const res = await fetch(`${host}/discover`);
    const body = await res.json();
    const hasToken = JSON.stringify(body).toLowerCase().includes("token") && body.lanToken;
    findings.push({
      name: "/discover does not leak lanToken",
      expect: "no lanToken field",
      got: hasToken ? "LEAK" : `ok keys=${Object.keys(body).join(",")}`,
      pass: !hasToken && body.ok === true,
    });
  }

  // 8) Duplicate idempotency
  {
    const ev = {
      id: httpOnly ? `smoke-dup-${runId}` : `loadtest-dup-${runId}`,
      ts: Math.floor(Date.now() / 1000) - 200,
      type: "PLAYER_LEVEL_CHANGED",
      character: "LoadTestDup",
      level: 11,
      old_level: 10,
      source: httpOnly ? "SMOKE" : "LOADTEST",
      is_self: true,
    };
    const a = await postEvent(ev, { "x-foreverlan-mode": "catch-up" });
    const b = await postEvent(ev, { "x-foreverlan-mode": "catch-up" });
    const pass = httpOnly
      ? a.status === 200 && b.status === 200
      : (a.status === 201 || a.status === 200) && (b.status === 409 || b.status === 200);
    findings.push({
      name: "duplicate id is idempotent",
      expect: httpOnly ? "200/200 smoke" : "201 then 409",
      got: `${a.status} then ${b.status}`,
      pass,
    });
  }

  return findings;
}

async function main() {
  console.log("Forever LAN host stress + pentest");
  console.log("================================");
  console.log(`host:        ${host}`);
  console.log(`clients:     ${clients}`);
  console.log(`events/each: ${eventsPerClient}`);
  console.log(`concurrency: ${concurrency}`);
  console.log(`mode:        ${httpOnly ? "HTTP-ONLY (SMOKE, not stored)" : modeOverride ? `PERSIST (${modeOverride})` : "PERSIST loadtest-* (half catch-up / half live)"}`);
  console.log(`runId:       ${runId}`);
  console.log("");

  const before = await health();
  console.log("health before:", JSON.stringify(before.body));
  if (!before.body?.ok) {
    console.error("Host not healthy — abort");
    process.exit(1);
  }

  console.log("\n--- pentest probes ---");
  const findings = await pentestProbes();
  for (const f of findings) {
    console.log(`${f.pass ? "PASS" : "FAIL"}  ${f.name}  (got ${f.got}${f.note ? `; ${f.note}` : ""})`);
  }

  console.log("\n--- multi-client burst ---");
  const all = [];
  for (let c = 0; c < clients; c++) {
    all.push(...makeClientEvents(c));
  }
  // Mix: catch-up (Friday backlog) vs live, unless --mode overrides
  const jobs = all.map((ev, i) => ({
    ev,
    mode:
      modeOverride === "catch-up" || modeOverride === "live"
        ? modeOverride
        : i < all.length / 2
          ? "catch-up"
          : "live",
  }));

  const tBurst = performance.now();
  await mapPool(jobs, concurrency, async (job) => {
    await postEvent(job.ev, { "x-foreverlan-mode": job.mode });
  });
  const burstMs = performance.now() - tBurst;

  // Wait for catch-up rebuild to settle
  await new Promise((r) => setTimeout(r, 2500));
  const after = await health();

  const lat = stats.latencies;
  console.log("");
  console.log("--- results ---");
  console.log(`posted:       ${jobs.length}`);
  console.log(`ok(2xx):      ${stats.ok}`);
  console.log(`created(201): ${stats.created}`);
  console.log(`duplicate:    ${stats.dup}`);
  console.log(`smoke/ignore: ${stats.smoke}`);
  console.log(`unauthorized: ${stats.unauthorized}`);
  console.log(`bad request:  ${stats.bad}`);
  console.log(`other:        ${stats.other}`);
  console.log(`network err:  ${stats.errors}`);
  console.log(
    `latency ms:   p50=${percentile(lat, 50).toFixed(1)}  p95=${percentile(lat, 95).toFixed(1)}  max=${percentile(lat, 100).toFixed(1)}`
  );
  console.log(`burst wall:   ${burstMs.toFixed(0)}ms  (${(jobs.length / (burstMs / 1000)).toFixed(0)} evt/s)`);
  console.log(`health after: events=${after.body?.events} ready=${after.body?.ready} clients=${after.body?.clients}`);
  console.log(
    `event delta:  ${(after.body?.events ?? 0) - (before.body?.events ?? 0)} (http-only expects 0)`
  );

  const pentestPass = findings.every((f) => f.pass);
  const stressPass =
    stats.errors === 0 &&
    after.body?.ok === true &&
    after.body?.ready === true &&
    (httpOnly ? stats.smoke + stats.ok >= jobs.length * 0.95 : stats.created + stats.dup >= jobs.length * 0.9);

  console.log("");
  console.log(pentestPass ? "PENTEST: PASS" : "PENTEST: FAIL (see FAIL lines)");
  console.log(stressPass ? "STRESS:  PASS" : "STRESS:  FAIL");
  if (!httpOnly) {
    console.log(
      "Note: loadtest-* events were stored. Use reset-weekend-data.bat before the real LAN if you want a clean slate."
    );
  }

  // Stability signal under rebuild: /lan must answer
  const lanRes = await fetch(`${host}/lan`);
  console.log(`/lan status: ${lanRes.status} (${(await lanRes.text()).length} bytes)`);

  process.exit(pentestPass && stressPass && lanRes.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
