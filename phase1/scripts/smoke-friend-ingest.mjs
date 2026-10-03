/**
 * Smoke: POST one catch-up event to the Forever LAN host (friend → host path).
 *
 *   set FOREVERLAN_HOST=http://192.168.x.x:8765
 *   set FOREVERLAN_TOKEN=your-token
 *   node scripts/smoke-friend-ingest.mjs
 *
 * Or: node scripts/smoke-friend-ingest.mjs http://127.0.0.1:8765 your-token
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1Root = path.resolve(__dirname, "..");

function loadTokenFromConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(phase1Root, "config.json"), "utf8"));
    return raw.lanToken || "";
  } catch {
    return "";
  }
}

const host = (process.argv[2] || process.env.FOREVERLAN_HOST || "http://127.0.0.1:8765").replace(
  /\/$/,
  ""
);
const token = process.argv[3] || process.env.FOREVERLAN_TOKEN || loadTokenFromConfig();

if (!token) {
  console.error("Missing lanToken. Pass as arg, FOREVERLAN_TOKEN, or set config.json");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
// Fixed historical-looking stamp so catch-up path is exercised (lag > 120s).
const eventTs = now - 3600;
const id = `smoke-friend-${eventTs}`;

const ev = {
  id,
  ts: eventTs,
  type: "PLAYER_LEVEL_CHANGED",
  character: "SmokeFriend",
  class: "Mage",
  level: 1,
  old_level: 1,
  zone: "Smoke Test",
  source: "SMOKE",
  is_self: true,
};

const res = await fetch(`${host}/events`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-foreverlan-token": token,
    "x-foreverlan-mode": "catch-up",
  },
  body: JSON.stringify(ev),
});

const body = await res.text();
console.log("host:", host);
console.log("status:", res.status);
console.log("body:", body);
if (res.status !== 200 && res.status !== 201 && res.status !== 409) {
  process.exit(1);
}
console.log("OK — friend→host path works (200 ignored smoke / 201 would be real).");
console.log("Smoke events are not stored on the weekend log.");
