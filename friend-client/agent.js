/**
 * Forever LAN friend agent — runs silently after INSTALL.
 *
 * LOCK: Discovery is never a prerequisite for local collection.
 * The collector starts immediately, queues to the local outbox, and keeps
 * collecting while the host is down. Discovery runs in parallel; when the
 * host appears, config is updated and the collector flushes backlog
 * (original ev.ts preserved — Friday → Saturday catch-up).
 *
 * Friends never open a terminal.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveHostUrl } from "./discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function installRoot() {
  return process.env.FOREVERLAN_HOME || __dirname;
}

function loadParty() {
  const root = installRoot();
  const candidates = [
    path.join(root, "party.json"),
    path.join(__dirname, "party.json"),
    path.join(__dirname, "party.example.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return { ...JSON.parse(fs.readFileSync(p, "utf8")), _path: p };
    } catch {
      /* ignore */
    }
  }
  return {};
}

function writeLog(line) {
  try {
    const logDir = path.join(installRoot(), "data");
    fs.mkdirSync(logDir, { recursive: true });
    // Same wall-clock as host/collector (Europe/Amsterdam by default — never UTC toISOString).
    let stamp;
    try {
      stamp = new Date().toLocaleString("sv-SE", {
        timeZone: process.env.FOREVERLAN_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    fs.appendFileSync(path.join(logDir, "agent.log"), `[${stamp}] ${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function configPathFor(home) {
  return path.join(home, "data", "collector-config.json");
}

function lockPathFor(home) {
  return path.join(home, "data", "collector.lock");
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

/** True when another live collector already owns this install's outbox. */
function liveCollectorOwnsOutbox(home) {
  const lockPath = lockPathFor(home);
  if (!fs.existsSync(lockPath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!pidAlive(raw.pid)) return false;
    // Lock from a previous boot (Windows reuses pids) is stale even if that pid is alive now.
    const started = Date.parse(raw.started_at || "");
    return !Number.isFinite(started) || started >= Date.now() - os.uptime() * 1000 - 60_000;
  } catch {
    try {
      return pidAlive(Number(String(fs.readFileSync(lockPath, "utf8")).trim()));
    } catch {
      return false;
    }
  }
}

/** Last known host URL from a previous run (hint only — never blocks collection). */
function readLastHostUrl(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPathFor(home), "utf8"));
    const u = String(raw.hostUrl || "").replace(/\/$/, "");
    return u || null;
  } catch {
    return null;
  }
}

function writeCollectorConfig(hostUrl, party, token) {
  const home = installRoot();
  const dataDir = path.join(home, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = configPathFor(home);
  const config = {
    // Empty string = collect + queue only; egress waits until discovery fills this in.
    hostUrl: hostUrl || "",
    lanToken: token,
    wowRoot: party.wowRoot || "",
    clientFolder: party.clientFolder || "_classic_beta_",
    pollClipboardMs: 0,
    pollCombatLogMs: 500,
    pollProcessMs: 2000,
    outboxPath: path.join(dataDir, "outbox.jsonl"),
    statePath: path.join(dataDir, "collector-state.json"),
    lanRoster: party.lanRoster || ["Alex River", "Sam Hill", "Jordan Vale", "Casey Brook"],
  };
  const body = JSON.stringify(config, null, 2);
  const tmp = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.renameSync(tmp, configPath);
  } catch {
    // Windows: rename cannot replace an existing file.
    fs.copyFileSync(tmp, configPath);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
  return configPath;
}

function findCollectorMain(home) {
  const candidates = [
    path.join(home, "collector", "index.js"),
    path.join(__dirname, "collector", "index.js"),
    path.join(__dirname, "..", "collector", "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findNodeBinary(home) {
  const candidates = [
    path.join(home, "runtime", "bin", "node"), // Linux / Steam Deck tarball
    path.join(home, "runtime", "node.exe"), // Windows portable
    path.join(__dirname, "runtime", "bin", "node"),
    path.join(__dirname, "runtime", "node.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.execPath;
}

async function main() {
  const party = loadParty();
  const token = party.lanToken || process.env.FOREVERLAN_TOKEN || "";
  if (!token || token.includes("PASTE_")) {
    writeLog("FATAL: party.json missing lanToken. Re-run the host prepare-friend-pack.");
    process.exit(1);
  }

  const home = installRoot();
  const dataDir = path.join(home, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  // One agent per install — Startup watchdog may retry; never run two discover loops.
  const lockModPath = [
    path.join(home, "collector", "instance-lock.js"),
    path.join(__dirname, "collector", "instance-lock.js"),
    path.join(__dirname, "..", "collector", "instance-lock.js"),
  ].find((p) => fs.existsSync(p));
  if (lockModPath) {
    const { acquirePidLock } = await import(pathToFileURL(lockModPath).href);
    const lock = acquirePidLock(path.join(dataDir, "agent.lock"), {
      label: "agent",
      log: writeLog,
    });
    if (!lock.ok) {
      writeLog(`another agent already running (pid ${lock.pid || "?"}) — exit 0 (watchdog will idle)`);
      process.exit(0);
    }
  }

  try {
    fs.writeFileSync(path.join(dataDir, "agent.pid"), String(process.pid), "utf8");
  } catch {
    /* ignore */
  }

  writeLog("agent starting (collect first; discover in background)");

  const collectorMain = findCollectorMain(home);
  if (!collectorMain) {
    writeLog("FATAL: collector/index.js not found next to agent");
    process.exit(1);
  }
  const nodeBin = findNodeBinary(home);

  // Prefer last-known host as a hint so egress can flush sooner if still valid.
  // Never wait on discovery before spawning the collector.
  // An https:// party.hostUrl is a pinned remote-beta ingest: no LAN beacon/subnet scans.
  const pinnedRemote = /^https:\/\//i.test(String(party.hostUrl || ""));
  let hostUrl = pinnedRemote ? party.hostUrl : readLastHostUrl(home) || party.hostUrl || null;
  let configPath = writeCollectorConfig(hostUrl, party, token);

  let child = null;
  let watchTimer = null;
  let collectorLogFd = null;
  let respawnFailStreak = 0;

  function closeCollectorLogFd() {
    if (collectorLogFd == null) return;
    try {
      fs.closeSync(collectorLogFd);
    } catch {
      /* ignore */
    }
    collectorLogFd = null;
  }

  /** Keep the last ~5MB of collector stdout/stderr on disk for friend-PC crash diagnosis. */
  function openCollectorLogFd() {
    const logPath = path.join(dataDir, "collector.log");
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
        try {
          fs.renameSync(logPath, `${logPath}.1`);
        } catch {
          /* ignore rotate race */
        }
      }
    } catch {
      /* ignore */
    }
    return fs.openSync(logPath, "a");
  }

  function scheduleCollectorRespawn(reason) {
    respawnFailStreak += 1;
    const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(respawnFailStreak - 1, 5)));
    writeLog(
      `collector respawn in ${Math.round(delay / 1000)}s (streak=${respawnFailStreak}${reason ? `, ${reason}` : ""})`
    );
    setTimeout(() => startCollector(), delay);
  }

  function watchUntilCollectorGone() {
    if (watchTimer) return;
    watchTimer = setInterval(() => {
      if (child) return;
      if (liveCollectorOwnsOutbox(home)) return;
      clearInterval(watchTimer);
      watchTimer = null;
      writeLog("collector lock free — starting collector");
      respawnFailStreak = 0;
      startCollector();
    }, 30_000);
  }

  function startCollector() {
    if (child) return;
    if (liveCollectorOwnsOutbox(home)) {
      writeLog("collector already running (lock held) — not spawning a second copy");
      watchUntilCollectorGone();
      return;
    }
    writeLog(
      `spawn collector ${collectorMain} (host=${hostUrl || "none - queueing locally"})`
    );
    closeCollectorLogFd();
    let stdio = "ignore";
    try {
      collectorLogFd = openCollectorLogFd();
      stdio = ["ignore", collectorLogFd, collectorLogFd];
    } catch (err) {
      writeLog(`collector log open failed: ${err?.message || err} — spawning without file log`);
      collectorLogFd = null;
    }
    child = spawn(nodeBin, [collectorMain], {
      cwd: path.dirname(collectorMain),
      env: {
        ...process.env,
        FOREVERLAN_CONFIG: configPath,
        FOREVERLAN_FRIEND_AGENT: "1",
        FOREVERLAN_HOME: home,
      },
      stdio,
      windowsHide: true,
    });
    // Missing node / bad path never fires "exit" — without this the agent would wedge forever.
    child.on("error", (err) => {
      writeLog(`collector spawn error: ${err?.message || err}`);
      closeCollectorLogFd();
      child = null;
      scheduleCollectorRespawn("spawn error");
    });
    child.on("exit", (code, signal) => {
      writeLog(`collector exited code=${code} signal=${signal}`);
      closeCollectorLogFd();
      child = null;
      // Exit 0 + lock still held = a sibling collector owns the outbox (not a crash).
      if (code === 0 && liveCollectorOwnsOutbox(home)) {
        writeLog("another collector still owns the outbox — waiting instead of respawn loop");
        respawnFailStreak = 0;
        watchUntilCollectorGone();
        return;
      }
      if (code === 0) {
        // Clean exit without sibling — restart soon but reset crash backoff.
        respawnFailStreak = 0;
        setTimeout(() => startCollector(), 2000);
        return;
      }
      // Crash/exit only — never spawn a second collector while one is still alive.
      scheduleCollectorRespawn(`exit ${code}/${signal}`);
    });
  }

  startCollector();

  /**
   * P0: Collector reloads hostUrl from collector-config.json on flush
   * (refreshHostFromConfig). Never kill/respawn on URL change — one process
   * owns the outbox for the whole run.
   */
  function applyHostUrl(found) {
    const next = String(found || "").replace(/\/$/, "");
    if (!next) return;
    const prev = hostUrl ? String(hostUrl).replace(/\/$/, "") : "";
    if (next === prev) return;
    writeLog(prev ? `host changed ${prev} -> ${next} (config only; collector keeps running)` : `host discovered ${next}`);
    hostUrl = next;
    configPath = writeCollectorConfig(hostUrl, party, token);
  }

  if (pinnedRemote) {
    writeLog(`remote ingest pinned ${hostUrl} — LAN discovery off`);
    return;
  }

  // Discovery loop — never gates collection.
  for (;;) {
    try {
      const found = await resolveHostUrl({ ...party, hostUrl: hostUrl || party.hostUrl });
      if (found) {
        applyHostUrl(found);
      } else if (!hostUrl) {
        writeLog("host not found yet; collecting locally, will retry");
      } else {
        writeLog("rediscover: host not reachable; outbox keeps queueing");
      }
    } catch (err) {
      writeLog(`discover error: ${err?.message || err}`);
    }
    await sleep(hostUrl ? 45_000 : 10_000);
  }
}

main().catch((err) => {
  writeLog(`FATAL: ${err?.stack || err}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  writeLog(`uncaughtException: ${err?.stack || err}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  writeLog(`unhandledRejection: ${err?.stack || err}`);
  process.exit(1);
});
