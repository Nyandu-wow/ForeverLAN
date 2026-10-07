import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadConfig,
  discoverClientDir,
  findCombatLogPath,
  chatLogPath,
  logsDir,
} from "./config.js";
import { Outbox } from "./outbox.js";
import { readClipboardText, parseClipboardPayload } from "./clipboard.js";
import { FileTailer, CombatLogParser } from "./combatlog.js";
import { Egress } from "./egress.js";
import { pollSavedVariables } from "./savedvars.js";
import {
  createSyncWho,
  DEFAULT_LAN_ROSTER,
  DEFAULT_LAN_ROSTER_ALIASES,
  DEFAULT_BOARD_EXCLUDE,
} from "./sync-who.js";
import { acquireCollectorLock } from "./instance-lock.js";
import { stampNow } from "./wall-clock.js";
import { ensureInstalledAddonInterface } from "../lib/addon-interface.js";

const execFileAsync = promisify(execFile);

function clog(...args) {
  console.log(`[${stampNow()}]`, ...args);
}

function cerror(...args) {
  console.error(`[${stampNow()}]`, ...args);
}

/** Quietly keep installed ForeverLAN TOC loadable — no manual sync step. */
function autoFixAddonInterface(clientDir) {
  try {
    const result = ensureInstalledAddonInterface(clientDir, { patchSource: false });
    if (result.changed) {
      clog(
        `[collector] ForeverLAN TOC Interface → ${result.forever} (${result.source}). ` +
          `If the addon list still says incompatible: /reload (or relaunch WowB).`
      );
    }
  } catch (err) {
    clog(`[collector] TOC auto-fix skipped: ${err?.message || err}`);
  }
}

/** Flush hook for crash handlers — set once outbox exists. */
let activeOutbox = null;

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { seenClipboardIds: [], wowRunning: false, svFingerprints: {} };
  }
}

function saveState(statePath, state) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    // keep seen ids bounded
    if (state.seenClipboardIds.length > 5000) {
      state.seenClipboardIds = state.seenClipboardIds.slice(-3000);
    }
    const fps = state.svFingerprints && typeof state.svFingerprints === "object" ? state.svFingerprints : {};
    const keys = Object.keys(fps);
    if (keys.length > 80) {
      // Drop oldest-looking paths first (sorted) — rare; keeps state file small.
      const keep = keys.sort().slice(-60);
      const next = {};
      for (const k of keep) next[k] = fps[k];
      state.svFingerprints = next;
    }
    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    try {
      fs.renameSync(tmp, statePath);
    } catch {
      fs.copyFileSync(tmp, statePath);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    cerror("[collector] saveState failed:", err?.message || err);
  }
}

async function isWowRunning() {
  if (process.platform !== "win32") {
    // Steam Deck / Linux: process check is optional; file watchers still run.
    return true;
  }
  try {
    // Single tasklist pass — cheaper than PowerShell every few seconds.
    const { stdout } = await execFileAsync("tasklist.exe", ["/NH"], {
      windowsHide: true,
      timeout: 4000,
    });
    return /\bWowB\.exe\b|\bWow\.exe\b|\bWowClassic\.exe\b/i.test(String(stdout || ""));
  } catch {
    return false;
  }
}

async function main() {
  let config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });

  const lockPath = path.join(config.dataDir, "collector.lock");
  const lock = acquireCollectorLock(lockPath, { log: clog });
  if (!lock.ok) {
    clog(
      `[collector] already running (pid ${lock.pid || "?"}) — not starting a second copy for ${config.outboxPath}`
    );
    process.exit(0);
  }

  const friendAgent = process.env.FOREVERLAN_FRIEND_AGENT === "1";
  let clientDir = discoverClientDir(config);
  while (!clientDir) {
    if (!friendAgent) {
      cerror("[collector] Could not discover Forever client directory.");
      cerror("Set config.wowRoot / clientFolder or FOREVERLAN_WOW_CLIENT.");
      process.exit(1);
    }
    clog("[collector] waiting for Forever client directory…");
    await new Promise((r) => setTimeout(r, 5000));
    config = loadConfig();
    clientDir = discoverClientDir(config);
  }

  const combatPath = findCombatLogPath(clientDir);
  const chatPath = chatLogPath(clientDir);
  clog("[collector] client:", clientDir);
  clog("[collector] combat log:", combatPath);
  clog("[collector] chat log:", chatPath, "(watched for discovery; may not be live)");
  clog("[collector] host:", config.hostUrl || "(none — local queue until discovered)");
  clog("[collector] outbox:", config.outboxPath);
  autoFixAddonInterface(clientDir);
  clog(
    "[collector] transport: combat-log = continuous (if /combatlog on); SavedVariables = after Push LAN reload or logout; outbox = LIVE + CATCH-UP"
  );

  const outbox = new Outbox(config.outboxPath, { log: clog });
  activeOutbox = outbox;
  const egress = new Egress(config.hostUrl, config.lanToken || "");
  const state = loadState(config.statePath);
  const seen = new Set(state.seenClipboardIds || []);
  let egressFailStreak = 0;

  // Friend agent (stdio → collector.log) + manual runs: surface crashes so the
  // watchdog/agent can respawn with a durable last line on disk.
  process.on("uncaughtException", (err) => {
    cerror("[collector] uncaughtException:", err?.stack || err);
    try {
      activeOutbox?.flush();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    cerror("[collector] unhandledRejection:", err?.stack || err);
    try {
      activeOutbox?.flush();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });

  {
    const s = outbox.stats();
    clog(
      `[collector] outbox status: awaiting=${s.awaiting_delivery} retained_sent=${s.retained_sent} file_bytes=${s.file_bytes}`
    );
    if (outbox.recoveredPartialLine) {
      clog("[collector] outbox recovered an incomplete final line on startup");
    }
  }

  function refreshHostFromConfig() {
    try {
      const fresh = loadConfig();
      const next = String(fresh.hostUrl || "").replace(/\/$/, "");
      const cur = egress.hostUrl || "";
      if (next && next !== cur) {
        egress.setHostUrl(next);
        clog("[collector] hostUrl refreshed:", egress.hostUrl);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  const boardExclude = config.lanBoardExclude || DEFAULT_BOARD_EXCLUDE;
  const syncWho = createSyncWho(
    config.lanRoster || DEFAULT_LAN_ROSTER,
    config.lanRosterAliases || DEFAULT_LAN_ROSTER_ALIASES,
    { boardExclude }
  );

  function queue(allowed, via, opts = {}) {
    const { inserted, durable } = outbox.upsert({
      ...allowed,
      ingested_via: via,
      ingested_at: new Date().toISOString(),
    });
    if (!durable) {
      // Append failed or prior undurable row — force rewrite before we mark seen.
      outbox.flush();
    }
    const ok = outbox.isDurable(allowed.id);
    if (inserted && ok) {
      if (!opts.quiet) {
        const who = syncWho.playingName();
        clog(
          `[collector] queued ${allowed.type} (${allowed.id.slice(0, 12)}…) via ${via}${who ? ` playing=${who}` : ""}`
        );
      }
    } else if (!ok) {
      cerror(
        `[collector] outbox not durable for ${allowed.id.slice(0, 12)}… — will retry on next SavedVariables/combat read`
      );
    }
    return { ok, inserted: inserted && ok, type: allowed.type };
  }

  function ingest(event, via) {
    if (!event?.id || !event?.type) return false;
    const allowed = syncWho.filterEvent(event);
    let ok = false;
    if (allowed) ok = queue(allowed, via).ok;
    for (const held of syncWho.takeReleased()) {
      if (queue(held, "combatlog").ok) ok = true;
    }
    return ok;
  }

  // Clipboard bridge — legacy, opt-in only. Forever blocks CopyToClipboard and the addon never
  // writes it; each poll spawns powershell.exe, so friend gaming PCs must not run it by default.
  const clipboardMs = Number(config.pollClipboardMs) || 0;
  let clipboardBusy = false;
  if (process.platform === "win32" && clipboardMs > 0) setInterval(async () => {
    if (clipboardBusy) return;
    clipboardBusy = true;
    try {
      const text = await readClipboardText();
      const events = parseClipboardPayload(text);
      let dirty = false;
      for (const ev of events) {
        if (seen.has(ev.id)) continue;
        // Only mark seen after the outbox has a durable row (or filter drops it).
        const allowed = syncWho.filterEvent(ev);
        if (!allowed) {
          seen.add(ev.id);
          dirty = true;
          continue;
        }
        if (queue(allowed, "clipboard").ok) {
          seen.add(ev.id);
          dirty = true;
        }
        for (const held of syncWho.takeReleased()) {
          queue(held, "combatlog");
          /* combat releases are not clipboard-seen */
        }
      }
      if (dirty) {
        state.seenClipboardIds = [...seen];
        saveState(config.statePath, state);
      }
    } catch (err) {
      cerror("[collector] clipboard error:", err.message);
    } finally {
      clipboardBusy = false;
    }
  }, Math.max(2000, clipboardMs));

  // SavedVariables bridge (fires after /reload or logout when WoW writes disk)
  const ackPath = path.join(config.dataDir, "addon-ack.json");
  if (!state.svFingerprints || typeof state.svFingerprints !== "object") {
    state.svFingerprints = {};
  }
  pollSavedVariables(
    clientDir,
    (events, file, meta = {}) => {
      const charLabel = path.basename(path.dirname(path.dirname(file)));
      const ids = [];
      let dirty = false;
      let skippedSeen = 0;
      let filtered = 0;
      let inserted = 0;
      let notDurable = 0;
      const byType = Object.create(null);
      const filteredTypes = Object.create(null);
      for (const ev of events) {
        ids.push(ev.id);
        if (seen.has(ev.id)) {
          // Already queued, but still tells sync-who whose GUIDs this client plays.
          syncWho.observe(ev);
          skippedSeen += 1;
          continue;
        }
        const allowed = syncWho.filterEvent(ev);
        if (!allowed) {
          // Filtered (off-roster / board-exclude) — safe to remember so we don't re-parse forever.
          seen.add(ev.id);
          dirty = true;
          filtered += 1;
          const ft = ev?.type || "?";
          filteredTypes[ft] = (filteredTypes[ft] || 0) + 1;
          continue;
        }
        const q = queue(allowed, "savedvars", { quiet: true });
        if (q.ok) {
          seen.add(ev.id);
          dirty = true;
          inserted += 1;
          byType[allowed.type] = (byType[allowed.type] || 0) + 1;
        } else {
          notDurable += 1;
        }
      }
      for (const held of syncWho.takeReleased()) queue(held, "combatlog", { quiet: true });
      if (inserted || filtered || notDurable) {
        const top = Object.entries(byType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([t, n]) => `${t}×${n}`)
          .join(", ");
        const who = syncWho.playingName();
        const filtHint =
          filtered > 0 && filtered <= 8
            ? ` [${Object.entries(filteredTypes)
                .map(([t, n]) => `${t}×${n}`)
                .join(", ")}]`
            : "";
        clog(
          `[collector] ${charLabel}: ${events.length} on disk → queued ${inserted} new` +
            ` (${skippedSeen} already seen` +
            (filtered ? `, ${filtered} filtered${filtHint}` : "") +
            (notDurable ? `, ${notDurable} not durable` : "") +
            `)` +
            (meta.via ? ` via=${meta.via}` : "") +
            (who ? ` playing=${who}` : "") +
            (top ? ` — ${top}` : "")
        );
      }
      // Unchanged / all-seen: stay quiet (fingerprint + seen already cover boot noise).
      if (dirty) {
        state.seenClipboardIds = [...seen];
        saveState(config.statePath, state);
      }
      try {
        fs.writeFileSync(
          ackPath,
          JSON.stringify(
            {
              acked_at: new Date().toISOString(),
              source_file: file,
              count: ids.length,
              ids: ids.slice(-500),
              bytes: meta.bytes ?? null,
              via: meta.via ?? null,
            },
            null,
            2
          ),
          "utf8"
        );
      } catch (err) {
        cerror("[collector] ack write failed:", err.message);
      }
    },
    {
      log: clog,
      excludeNames: boardExclude,
      initialFingerprints: state.svFingerprints,
      onFingerprintsChange: (fps) => {
        state.svFingerprints = fps;
        saveState(config.statePath, state);
      },
    }
  );

  // Combat log tail — Forever uses timestamped WoWCombatLog-*.txt; follow newest
  fs.mkdirSync(logsDir(clientDir), { recursive: true });
  let activeCombatPath = combatPath;
  const combatParser = new CombatLogParser();
  let combatTailer = new FileTailer(activeCombatPath, {
    pollMs: config.pollCombatLogMs || 500,
    onLine: (line) => {
      const ev = combatParser.parse(line);
      if (ev) ingest(ev, "combatlog");
    },
  });
  combatTailer.start();

  setInterval(() => {
    const newest = findCombatLogPath(clientDir);
    if (!newest || newest === activeCombatPath) return;
    clog(`[collector] combat log switched → ${path.basename(newest)}`);
    combatTailer.stop();
    activeCombatPath = newest;
    combatTailer = new FileTailer(activeCombatPath, {
      pollMs: config.pollCombatLogMs || 500,
      onLine: (line) => {
        const ev = combatParser.parse(line);
        if (ev) ingest(ev, "combatlog");
      },
    });
    combatTailer.start();
  }, 5000);

  // Optional chat log tail (discovery only)
  const chatTailer = new FileTailer(chatPath, {
    pollMs: 1000,
    onLine: (line) => {
      if (line.includes("FOREVERLAN") || line.includes("[ForeverLAN]")) {
        ingest(
          {
            v: 1,
            id: cryptoHash(line),
            ts: Math.floor(Date.now() / 1000),
            type: "CHAT_LOG_LINE",
            source: "chatlog",
            line: line.slice(0, 500),
          },
          "chatlog"
        );
      }
    },
  });
  chatTailer.start();

  // Process open/close hints
  let processBusy = false;
  setInterval(async () => {
    if (processBusy) return;
    processBusy = true;
    try {
      const running = await isWowRunning();
      if (running !== state.wowRunning) {
        state.wowRunning = running;
        saveState(config.statePath, state);
        ingest(
          {
            v: 1,
            id: `process-${running ? "start" : "stop"}-${Date.now()}`,
            ts: Math.floor(Date.now() / 1000),
            type: running ? "WOW_PROCESS_START" : "WOW_PROCESS_STOP",
            source: "collector",
          },
          "process"
        );
        clog(`[collector] WoW process ${running ? "detected" : "stopped"}`);
      }
    } finally {
      processBusy = false;
    }
  }, config.pollProcessMs || 5000);

  // Flush outbox to host (oldest event.ts first — preserves Friday 22:01 on Saturday upload)
  // Never overlap ticks; back off when the host is slow so we don't open a connection storm.
  // Collection continues regardless — empty hostUrl only pauses egress, not ingest.
  let flushing = false;
  let flushDelayMs = 1000;
  let noHostLogged = false;
  let hostDownLogged = false;
  const flushTick = async () => {
    if (flushing) {
      setTimeout(flushTick, flushDelayMs);
      return;
    }
    flushing = true;
    try {
      refreshHostFromConfig();
      if (!egress.hostUrl) {
        if (!noHostLogged) {
          clog("[collector] no host yet — queueing to outbox (discovery is separate)");
          noHostLogged = true;
        }
        flushDelayMs = 3000;
      } else {
        noHostLogged = false;
        const batch = outbox.pending(egressFailStreak > 0 ? 5 : 40);
        let sent = 0;
        for (const row of batch) {
          try {
            const result = await egress.send(row.event);
            outbox.markSent(row.event.id);
            egressFailStreak = 0;
            flushDelayMs = 1000;
            sent += 1;
            if (hostDownLogged) {
              clog("[collector] host is answering again — draining the local queue");
              hostDownLogged = false;
            }
            if (sent <= 3 || sent % 25 === 0) {
              clog(`[collector] sent ${row.event.type} [${result.mode || "live"}]`);
            }
          } catch (err) {
            const status = Number(err?.status) || 0;
            if (status === 400 || status === 413) {
              outbox.markRejected(row.event.id, err.message);
              clog(`[collector] dropping malformed event ${row.event.type} ${row.event.id}: ${err.message}`);
              continue;
            }
            outbox.markFailure(row.event.id, err.message);
            egressFailStreak += 1;
            flushDelayMs = Math.min(15000, 1000 * Math.pow(2, Math.min(egressFailStreak, 4)));
            // One line when the host goes quiet. Events stay in the outbox.
            if (status === 401 || status === 403) {
              if (!hostDownLogged) {
                hostDownLogged = true;
                clog(
                  `[collector] host refused ingest (${status}) — check lanToken / ingest hostname. Queue kept.`
                );
              }
            } else if (!hostDownLogged) {
              hostDownLogged = true;
              clog(
                `[collector] host not answering — keeping events locally until it is back (${err.message})`
              );
            }
            refreshHostFromConfig();
            break;
          }
        }
        if (sent > 3) clog(`[collector] sent batch of ${sent} · pending ${outbox.pendingCount()}`);
      }
      outbox.flush();
    } finally {
      flushing = false;
      setTimeout(flushTick, flushDelayMs);
    }
  };
  setTimeout(flushTick, 500);

  // Lightweight durability diagnostics (not a dashboard).
  setInterval(() => {
    const s = outbox.stats();
    clog(
      `[collector] queue: awaiting_delivery=${s.awaiting_delivery} outbox_bytes=${s.file_bytes} host=${egress.hostUrl || "(none)"}`
    );
  }, 5 * 60 * 1000);

  process.on("exit", () => {
    try {
      outbox.flush();
    } catch {
      /* ignore */
    }
  });

  clog("[collector] running. Start WoW Forever, enable the ForeverLAN addon, and watch the host UI.");
}

function cryptoHash(line) {
  return crypto.createHash("sha1").update(line).digest("hex").slice(0, 32);
}

main().catch((err) => {
  cerror(err);
  process.exit(1);
});
