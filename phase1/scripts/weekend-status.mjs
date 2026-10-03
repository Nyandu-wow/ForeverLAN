/**
 * the host: quick weekend status — is the host up, who pushed lately?
 *
 *   node scripts/weekend-status.mjs
 *   or double-click scripts/weekend-status.bat
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../collector/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1 = path.resolve(__dirname, "..");
const config = loadConfig(path.join(phase1, "config.json"));
const port = Number(config.listenPort || 8765);
const dataDir = config.dataDir || path.join(phase1, "data");
const ingestLog = path.join(dataDir, "ingest.log");
const hostUrl = `http://127.0.0.1:${port}`;

function lanIpv4s() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const addr of list || []) {
      const fam = addr.family;
      if ((fam !== "IPv4" && fam !== 4) || addr.internal) continue;
      const ip = String(addr.address || "");
      if (ip.startsWith("169.254.")) continue;
      out.push(ip);
    }
  }
  return out;
}

async function getJson(url, ms = 2000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    clearTimeout(t);
  }
}

function tailLines(file, n = 12) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).slice(-n);
}

console.log("");
console.log("Forever LAN - weekend status");
console.log("============================");
console.log(`PC name:     ${os.hostname()}`);
console.log(`Board:       ${hostUrl}/`);
console.log(`Data:        ${dataDir}`);
console.log(`Ingest log:  ${ingestLog}`);
const ips = lanIpv4s();
console.log(`LAN IPv4:    ${ips.length ? ips.join(", ") : "(none)"}`);
console.log("");

const health = await getJson(`${hostUrl}/health`);
const discover = await getJson(`${hostUrl}/discover`);

if (!health.ok) {
  console.log("HOST: DOWN or not ready");
  console.log(`  ${health.error || `HTTP ${health.status}`}`);
  console.log("  Start with: scripts\\start-weekend.bat  (or Desktop Forever LAN)");
} else {
  const h = health.body || {};
  console.log("HOST: UP");
  console.log(`  ready=${h.ready}  events=${h.events}  players=${h.lan_players}`);
  console.log(`  session=${h.session_id || "-"}`);
  console.log(`  contract=${h.client_contract || "?"}  ingest_api=${h.ingest_api ?? "?"}`);
  console.log(`  last_ingest=${h.last_ingest_at || "-"}`);
  console.log(`  last_game_event=${h.last_event_at || "-"}`);
  if (h.ingest_api != null && h.ingest_api !== 1) {
    console.log("  WARNING: ingest_api != 1 — may break frozen friend agents (see CLIENT_CONTRACT.md)");
  }
}

if (discover.ok && discover.body?.service === "foreverlan") {
  console.log("DISCOVER: OK (friends can find this PC)");
  if (discover.body.v !== 1) {
    console.log(`  WARNING: discover.v=${discover.body.v} (frozen clients expect v=1)`);
  }
} else {
  console.log("DISCOVER: FAIL - friends cannot auto-find the host yet");
  console.log(`  ${discover.error || `HTTP ${discover.status}`}`);
}

console.log("");
console.log("Recent ingest (who's talking to you):");
const lines = tailLines(ingestLog, 15);
if (!lines.length) {
  console.log("  (no ingest.log yet - no friend has probed or pushed)");
} else {
  for (const line of lines) console.log(`  ${line}`);
}

const loadtestHits = lines.filter((l) => /LoadTest|loadtest-/i.test(l)).length;
const eventsPath = path.join(dataDir, "host-events.jsonl");
let loadtestStored = 0;
if (fs.existsSync(eventsPath)) {
  // Cheap sample: last 200KB only (status must stay fast)
  const st = fs.statSync(eventsPath);
  const fd = fs.openSync(eventsPath, "r");
  const sample = Buffer.alloc(Math.min(200_000, st.size));
  fs.readSync(fd, sample, 0, sample.length, Math.max(0, st.size - sample.length));
  fs.closeSync(fd);
  loadtestStored = (sample.toString("utf8").match(/"source":"LOADTEST"|loadtest-/g) || []).length;
}
if (loadtestHits || loadtestStored) {
  console.log("");
  console.log("NOTE: load/stress-test events are in this dataset.");
  console.log("  Before the real LAN weekend: stop host → scripts\\reset-weekend-data.bat");
  console.log("  (backup first if you want to keep practice data)");
}

console.log("");
console.log("Checklist:");
console.log("  1. Admin once: scripts\\open-lan-firewall.bat");
console.log("  2. Start:      scripts\\start-weekend.bat");
console.log("  3. Friend zip: scripts\\prepare-friend-zip.bat");
console.log("  4. Deck zip:   scripts\\prepare-steamdeck-zip.bat");
console.log("  5. Compat:     node scripts\\smoke-host-compat.mjs");
console.log("  6. Watch:      ingest.log or this status script");
console.log("");
console.log("Mid-weekend host/dashboard update (addon FINAL):");
console.log("  scripts\\restart-host.bat  →  node scripts\\smoke-host-compat.mjs");
console.log("  Do NOT change lanToken or rebuild friend zips. See CLIENT_CONTRACT.md");
console.log("");
