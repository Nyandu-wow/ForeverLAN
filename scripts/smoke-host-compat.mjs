/**
 * Smoke: frozen client contract still works after a host/dashboard update.
 *
 * Posts an addon-shaped event (same fields ForeverLAN 0.1.27 sends) and checks
 * /discover + /health expose ingest_api v1 without requiring new client behavior.
 *
 *   node scripts/smoke-host-compat.mjs
 *   node scripts/smoke-host-compat.mjs http://127.0.0.1:8765
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const host = (process.argv[2] || process.env.FOREVERLAN_HOST || "http://127.0.0.1:8765").replace(
  /\/$/,
  ""
);
const token = process.argv[3] || process.env.FOREVERLAN_TOKEN || cfg.lanToken || "";

if (!token) {
  console.error("Missing lanToken");
  process.exit(1);
}

const failures = [];

function check(name, cond, detail) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const health = await (await fetch(`${host}/health`)).json();
check("health.ok", health.ok === true, JSON.stringify(health));
check("health.ready", health.ready === true, JSON.stringify(health));
check(
  "health.ingest_api is 1 (or absent on very old host)",
  health.ingest_api == null || health.ingest_api === 1,
  String(health.ingest_api)
);

const discover = await (await fetch(`${host}/discover`)).json();
check("discover.ok", discover.ok === true);
check("discover.v is 1", discover.v === 1, String(discover.v));
check("discover.service", discover.service === "foreverlan");
check("discover.tokenRequired", discover.tokenRequired === true);
check("discover does not leak lanToken", discover.lanToken == null);
check(
  "discover.ingest_api is 1 (or absent)",
  discover.ingest_api == null || discover.ingest_api === 1,
  String(discover.ingest_api)
);

// Shape matches frozen addon enqueue() — extra future host fields must not be required.
const now = Math.floor(Date.now() / 1000);
const ev = {
  v: 1,
  id: `smoke-compat-${now}`,
  ts: now,
  type: "PING",
  source: "SMOKE",
  character: "SmokeFriend",
  class: "Mage",
  level: 1,
  zone: "Compat Probe",
  guid: "Player-Smoke-Compat",
  is_self: true,
  // Unknown-to-old-host keys must still be accepted by a newer host:
  future_client_note: "ignore-me",
};

const res = await fetch(`${host}/events`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-foreverlan-token": token,
    "x-foreverlan-mode": "live",
  },
  body: JSON.stringify(ev),
});
const body = await res.json().catch(() => ({}));
check(
  "POST /events accepts frozen addon-shaped body",
  res.status === 200 || res.status === 201 || res.status === 409,
  `status=${res.status} body=${JSON.stringify(body)}`
);

// Wrong token still rejected (host update must not open ingest)
const bad = await fetch(`${host}/events`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-foreverlan-token": "not-the-weekend-token",
  },
  body: JSON.stringify({ ...ev, id: `smoke-compat-bad-${now}` }),
});
check("bad token still 401", bad.status === 401, `status=${bad.status}`);

console.log("");
if (failures.length) {
  console.error(`COMPAT FAIL (${failures.length}) — host may break frozen friend clients`);
  process.exit(1);
}
console.log("COMPAT OK — safe for frozen addon/agents if lanToken unchanged");
