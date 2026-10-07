/**
 * Forever LAN — single entrypoint.
 * Starts host + collector and keeps them healthy. Close this window to stop.
 *
 * Restart policy:
 * - Host down  → restart host only (collector keeps queueing).
 * - Collector down → restart collector only (board stays up).
 * - Never kill healthy children just because the other half hiccuped.
 * - Back off if restarts loop (avoids the stop/start thrash).
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { stampNow } from "./collector/wall-clock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

let hostProc = null;
let collectorProc = null;
let hostStarting = false;
let collectorStarting = false;
let lastOk = false;
let restartStreak = 0;
let nextRestartAt = 0;

function log(msg) {
  console.log(`[${stampNow()}] ${msg}`);
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function childAlive(proc) {
  return Boolean(proc && proc.pid && proc.exitCode == null && !proc.killed && pidAlive(proc.pid));
}

/** Kill stray host/collector processes that are not our managed children. */
function killOrphans() {
  const keep = new Set([process.pid]);
  if (hostProc?.pid) keep.add(hostProc.pid);
  if (collectorProc?.pid) keep.add(collectorProc.pid);
  const keepList = [...keep].join(",");
  try {
    execSync(
      `powershell -NoProfile -Command "$keep=@(${keepList}); Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'host[/\\\\]server\\\\.js|collector[/\\\\]index\\\\.js' -and $keep -notcontains $_.ProcessId } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore", windowsHide: true }
    );
  } catch {
    /* ignore */
  }
}

function freePortIfForeign() {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(":8765") || !line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const owner = Number(parts[parts.length - 1]);
      if (!Number.isFinite(owner) || owner <= 0) continue;
      if (owner === process.pid || owner === hostProc?.pid) continue;
      try {
        execSync(`taskkill /F /PID ${owner}`, { stdio: "ignore", windowsHide: true });
        log(`Freed port 8765 (foreign PID ${owner})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function spawnChild(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      FOREVERLAN_TZ: process.env.FOREVERLAN_TZ || "Europe/Amsterdam",
    },
  });
  child.on("exit", (code, signal) => {
    log(`${name} stopped (code=${code ?? "—"} signal=${signal ?? "—"})`);
    if (name === "host" && hostProc === child) hostProc = null;
    if (name === "collector" && collectorProc === child) collectorProc = null;
  });
  return child;
}

function startHost() {
  if (hostStarting || childAlive(hostProc)) return;
  hostStarting = true;
  try {
    freePortIfForeign();
    killOrphans();
    if (hostProc && !hostProc.killed) {
      try {
        hostProc.kill();
      } catch {
        /* ignore */
      }
    }
    hostProc = null;
    log("Starting board…");
    hostProc = spawnChild("host", ["host/server.js"]);
  } finally {
    // Host listens quickly; allow ticks again after a short settle.
    setTimeout(() => {
      hostStarting = false;
    }, 1500);
  }
}

function startCollector() {
  if (collectorStarting || childAlive(collectorProc)) return;
  collectorStarting = true;
  try {
    killOrphans();
    if (collectorProc && !collectorProc.killed) {
      try {
        collectorProc.kill();
      } catch {
        /* ignore */
      }
    }
    collectorProc = null;
    log("Starting collector…");
    collectorProc = spawnChild("collector", ["collector/index.js"]);
  } finally {
    setTimeout(() => {
      collectorStarting = false;
    }, 1000);
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:8765/health", { timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          resolve(res.statusCode === 200 && j.ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function tick() {
  if (hostStarting || collectorStarting) return;
  if (Date.now() < nextRestartAt) return;

  const ok = await checkHealth();
  const hostOk = ok && childAlive(hostProc);
  const collectorOk = childAlive(collectorProc);

  if (hostOk && collectorOk) {
    if (!lastOk) log("Board is healthy.");
    lastOk = true;
    restartStreak = 0;
    return;
  }

  lastOk = false;
  restartStreak += 1;
  const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(restartStreak - 1, 5)));
  nextRestartAt = Date.now() + delay;

  if (!hostOk) {
    log(`Board not responding — restarting host (backoff ${Math.round(delay / 1000)}s)`);
    startHost();
    // Collector can stay up and keep queueing while the host comes back.
    if (!collectorOk) {
      setTimeout(() => startCollector(), 2000);
    }
    return;
  }

  log(`Collector missing — restarting collector only (backoff ${Math.round(delay / 1000)}s)`);
  startCollector();
}

console.log("");
console.log("  FOREVER LAN");
console.log("  Board: http://127.0.0.1:8765/");
console.log("  Leave this window open while you play.");
console.log("  Close it when you're done.");
console.log("");

// Cold start: clear foreign leftovers, then bring up host → collector.
killOrphans();
freePortIfForeign();
startHost();
setTimeout(() => startCollector(), 2500);

setTimeout(() => {
  tick();
  setInterval(tick, 20000);
}, 8000);

function shutdown() {
  log("Shutting down…");
  try {
    if (collectorProc?.pid) process.kill(collectorProc.pid);
  } catch {
    /* ignore */
  }
  try {
    if (hostProc?.pid) process.kill(hostProc.pid);
  } catch {
    /* ignore */
  }
  // Best-effort orphan cleanup of our stack only.
  hostProc = null;
  collectorProc = null;
  killOrphans();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
