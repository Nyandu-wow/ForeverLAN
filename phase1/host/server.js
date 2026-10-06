import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../collector/config.js";
import { LanSession } from "./lan-session.js";
import { formatPowerActivityLabel } from "./class-power.js";
import { openStore } from "./store.js";
import { createBoardReads } from "./board-reads.js";
import { isFullName } from "./character-id.js";
import { DEFAULT_LAN_ROSTER, DEFAULT_LAN_ROSTER_ALIASES, DEFAULT_BOARD_EXCLUDE } from "../collector/lan-roster.js";
import { isSmokeProbe } from "./test-events.js";
import { startLanBeacon } from "./lan-beacon.js";
import { eventTypeLabel } from "./event-labels.js";
import { buildRaceCeiling } from "./race-ceiling.js";
import {
  attachClientStatuses,
  buildHostDiagnostics,
  buildLookbackMoments,
} from "./control-room.js";
import { stampNow, displayTimeZone } from "../collector/wall-clock.js";
import {
  gateIngestHostnameRequest,
  remoteSecurityModeEnabled,
  remoteSecurityPublicMeta,
} from "./remote-security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const dataDir = config.dataDir || path.join(config.phase1Root, "data");
const eventsPath = path.join(dataDir, "host-events.jsonl");
const dbPath = path.join(dataDir, "foreverlan.sqlite");
const store = openStore(dbPath);
const partyStatePath = path.join(dataDir, "party-state.json");
const lanStatePath = path.join(dataDir, "lan-state.json");
fs.mkdirSync(dataDir, { recursive: true });

const DISPLAY_TZ = displayTimeZone(config.displayTimeZone);

function hostLog(...args) {
  console.log(`[${stampNow(DISPLAY_TZ)}]`, ...args);
}

function hostError(...args) {
  console.error(`[${stampNow(DISPLAY_TZ)}]`, ...args);
}

hostLog(`[host] data dir: ${dataDir}`);
hostLog(`[host] display timezone: ${DISPLAY_TZ}`);

let catchUpRebuildTimer = null;
let catchUpRebuildRunning = false;
/** Events persisted while a chronological rebuild was in flight or scheduled. */
let boardRebuildGeneration = 0;

function isBoardRebuildPending() {
  return catchUpRebuildRunning || catchUpRebuildTimer != null;
}

/** False until the weekend log has finished its first rebuild. */
let bootReady = false;

function decorateLanState(state) {
  if (!state) return state;
  if (!state.meta) state.meta = {};
  state.meta.display_time_zone = DISPLAY_TZ;
  state.meta.server_now = new Date().toISOString();
  state.meta.ingest_api = 1;
  state.meta.client_contract = "v1";
  state.meta.catch_up_active = isBoardRebuildPending();
  state.meta.ready = bootReady;
  state.meta.bootstrapping = !bootReady;
  // Always publish fold_errors so DIAG / weekend watch never sees "undefined".
  state.meta.fold_errors = Number(state.meta.fold_errors) || 0;
  if (!state.meta.fold_errors) state.meta.last_fold_error = null;

  const ceiling = buildRaceCeiling({
    levelCap: config.lanLevelCap ?? 60,
    betaLaunch: config.foreverBetaLaunch || "2026-11-04",
    weekendStart: config.lanWeekendStart || state.weekend?.start_date || null,
    watchingSince: state.watching_since || null,
    nowIso: state.meta.server_now,
    players: state.players || [],
  });
  state.meta.level_cap = ceiling.level_cap;
  state.meta.race_ceiling = ceiling;
  state.meta.race_label = ceiling.race_label;

  const nowMs = Date.now();
  state.players = attachClientStatuses(state.players || [], {
    nowMs,
    catchUpActive: state.meta.catch_up_active,
  });
  // Refresh lookback with catch-up-aware pulse already on state.
  if (Array.isArray(state.lookback_moments)) {
    state.lookback_moments = buildLookbackMoments({
      activity: state.activity,
      trajectory: state.trajectory,
      racePulse: state.race_pulse,
      players: state.players,
      sinceIso: new Date(nowMs - 30 * 60 * 1000).toISOString(),
      limit: 5,
    });
  }

  const cap = ceiling.level_cap;
  if (state.wrap?.race) {
    state.wrap.race = state.wrap.race.map((p) => ({
      ...p,
      to_60: Math.max(0, cap - (p.level || 0)),
      to_cap: Math.max(0, cap - (p.level || 0)),
    }));
  }
  if (state.wrap?.hall && state.hall) {
    // Keep wrap hall evidence in sync with live hall chips.
    const byTitle = new Map((state.hall || []).map((h) => [`${h.title}|${h.character || ""}`, h]));
    state.wrap.hall = (state.wrap.hall || []).map((h) => {
      const full = byTitle.get(`${h.title}|${h.character || ""}`);
      return full?.evidence ? { ...h, evidence: full.evidence } : h;
    });
  }
  return state;
}

const ingestLogPath = path.join(dataDir, "ingest.log");
const seenClientsPath = path.join(dataDir, "ingest-clients.json");
/** @type {Map<string, number>} first-seen ms for client IPs (persisted across host restarts) */
const seenClientIps = new Map();
try {
  if (fs.existsSync(seenClientsPath)) {
    const raw = JSON.parse(fs.readFileSync(seenClientsPath, "utf8"));
    for (const [ip, ts] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      if (ip && Number.isFinite(Number(ts))) seenClientIps.set(ip, Number(ts));
    }
  }
} catch {
  /* start fresh */
}
/** Rate-limit noisy catch-up lines per IP */
const catchUpLogAt = new Map();

function clientIp(req) {
  const raw =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "";
  // Node may give ::ffff:192.168.1.5
  const ip = String(raw).replace(/^::ffff:/i, "") || "unknown";
  // Display/logging only (never auth): tunnel traffic all arrives from loopback.
  const cf = String(req.headers?.["cf-connecting-ip"] || "").trim();
  return cf && (ip === "127.0.0.1" || ip === "::1") ? `${cf} (via tunnel)` : ip;
}

function persistSeenClients() {
  try {
    fs.writeFileSync(
      seenClientsPath,
      JSON.stringify(Object.fromEntries(seenClientIps), null, 2) + "\n",
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

function ingestLog(line) {
  const text = `[${stampNow(DISPLAY_TZ)}] ${line}`;
  console.log(`[ingest] ${text}`);
  try {
    fs.appendFileSync(ingestLogPath, text + "\n", "utf8");
  } catch {
    /* ignore disk issues — console still has it */
  }
}

function noteClient(ip, kind) {
  if (!ip || ip === "unknown") return false;
  if (seenClientIps.has(ip)) return false;
  seenClientIps.set(ip, Date.now());
  persistSeenClients();
  ingestLog(`NEW CLIENT ${ip} - first ${kind}`);
  return true;
}

hostLog(`[host] ingest log: ${ingestLogPath}`);

/** @type {Map<string, object>} */
const eventsById = new Map();
/** @type {object[]} */
const eventsOrder = [];
/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

/** @type {{ updated_at: string|null, members: object[], raw: object|null }} */
let partyState = { updated_at: null, members: [], raw: null };

const session = new LanSession({
  roster: config.lanRoster || DEFAULT_LAN_ROSTER,
  rosterAliases: config.lanRosterAliases || DEFAULT_LAN_ROSTER_ALIASES,
  boardExclude: config.lanBoardExclude || DEFAULT_BOARD_EXCLUDE,
  rosterAuto: config.lanRosterAuto !== false,
  weekendStart: config.lanWeekendStart || null,
  lanName: config.lanName || "Forever LAN",
  levelCap: config.lanLevelCap ?? 60,
});

/** Last published board — keep serving during boot/rebuild so Live never flashes empty. */
function tryLoadWarmLanState() {
  if (!fs.existsSync(lanStatePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(lanStatePath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    if (!Array.isArray(raw.players)) raw.players = [];
    if (!raw.meta || typeof raw.meta !== "object") raw.meta = {};
    raw.meta.board_provisional = true;
    return raw;
  } catch {
    return null;
  }
}

let lanState = decorateLanState(session.getPublicState());
let boardVersion = 0;
const boardReads = createBoardReads();

/** Publish a new canonical board. Read caches drop. GET handlers do not call this. */
function publishBoard(state) {
  boardVersion += 1;
  if (!state.meta || typeof state.meta !== "object") state.meta = {};
  state.meta.board_version = boardVersion;
  lanState = state;
  boardReads.invalidate(boardVersion);
  return lanState;
}

publishBoard(lanState);
{
  const warm = tryLoadWarmLanState();
  if (warm && (warm.players.length > 0 || Number(warm.meta?.real_event_count || warm.meta?.event_count || 0) > 0)) {
    publishBoard(decorateLanState(warm));
    hostLog(
      `[host] warm board from lan-state.json — players=${lanState.players.length} (rebuilding from event log…)`
    );
  }
}

function lanEtag() {
  const bucket = Math.floor(Date.now() / 10000);
  return `W/"b${lanState.meta?.board_version || 0}-${bucket}"`;
}

async function loadExisting() {
  if (fs.existsSync(eventsPath)) {
    const text = fs.readFileSync(eventsPath, "utf8");
    const endsWithNewline = text.endsWith("\n") || text.endsWith("\r\n");
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();

    const kept = [];
    let droppedPartial = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev?.id && !eventsById.has(ev.id)) {
          eventsById.set(ev.id, ev);
          eventsOrder.push(ev);
          kept.push(line);
        } else if (ev?.id) {
          kept.push(line);
        }
      } catch {
        const isLast = i === lines.length - 1;
        if (isLast && !endsWithNewline) {
          droppedPartial = true;
        }
        // Corrupt mid-file lines stay skipped (same as before); only trim a torn tail.
      }
      if (i > 0 && i % 2000 === 0) await new Promise((r) => setImmediate(r));
    }
    if (droppedPartial) {
      // Truncate only the torn tail (never rewrite the weekend log); keep the tail bytes aside.
      try {
        const buf = fs.readFileSync(eventsPath);
        const cut = buf.lastIndexOf(0x0a) + 1;
        fs.writeFileSync(`${eventsPath}.torn-${Date.now()}.txt`, buf.subarray(cut));
        fs.truncateSync(eventsPath, cut);
        hostLog(
          `[host] recovered host-events.jsonl: truncated torn final line (${kept.length} complete rows kept; tail saved beside the log)`
        );
      } catch (err) {
        hostError("[host] host-events recovery failed:", err?.message || err);
      }
    } else if (text.length && !endsWithNewline) {
      // Complete last row without newline — next append must not glue onto it.
      try {
        fs.appendFileSync(eventsPath, "\n", "utf8");
      } catch (err) {
        hostError("[host] host-events newline repair failed:", err?.message || err);
      }
    }
  }
  // Product board rebuilds from the full durable event log (skips simulator).
  // Async + yield so /health and POST stay responsive during boot.
  // Keep serving the warm lanState until this finishes — Live clients must not
  // see an empty board flash while the weekend log is replaying.
  const rebuilt = await session.rebuildFromEventsAsync(eventsOrder, { chunkSize: 400 });
  if (rebuilt?.meta) delete rebuilt.meta.board_provisional;
  reportFoldErrors(rebuilt, "boot rebuild");
  publishBoard(decorateLanState(rebuilt));
  saveLanState(true);
  store.importAll(eventsOrder);
  hostLog(`[host] sqlite events=${store.count()} (${dbPath})`);

  if (fs.existsSync(partyStatePath)) {
    try {
      partyState = JSON.parse(fs.readFileSync(partyStatePath, "utf8"));
    } catch {
      // ignore
    }
  }
}

function reportFoldErrors(state, when) {
  const n = state?.meta?.fold_errors || 0;
  if (!n) return;
  const last = state.meta.last_fold_error || {};
  hostError(
    `[host] ${when}: ${n} event(s) skipped by the board fold (kept in host-events.jsonl). Last: ${last.type || "?"} ${last.id || "?"} — ${last.error || "?"}`
  );
}

function persist(ev) {
  fs.appendFileSync(eventsPath, JSON.stringify(ev) + "\n", "utf8");
}

/** Cache files only (rebuildable from host-events.jsonl) — a lock/EPERM must never kill ingest. */
function writeCacheFile(file, body) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    hostError(`[host] cache write failed (${path.basename(file)}):`, err?.message || err);
  }
}

function savePartyState() {
  writeCacheFile(partyStatePath, JSON.stringify(partyState, null, 2));
}

let lanSaveTimer = null;
function saveLanState(immediate = false) {
  const write = () => {
    lanSaveTimer = null;
    // Compact JSON — pretty-print + OneDrive sync was freezing the board.
    writeCacheFile(lanStatePath, JSON.stringify(lanState));
  };
  if (immediate) {
    if (lanSaveTimer) clearTimeout(lanSaveTimer);
    write();
    return;
  }
  if (lanSaveTimer) return;
  lanSaveTimer = setTimeout(write, 2000);
}

function formatEvent(ev) {
  const t = new Date((ev.ts || Date.now() / 1000) * 1000);
  const clock = t.toLocaleTimeString("en-GB", { hour12: false, timeZone: DISPLAY_TZ });
  const who = [ev.character, ev.class, ev.level != null ? `Level ${ev.level}` : null]
    .filter(Boolean)
    .join(" — ");
  const label = ingestEventLabel(ev);

  switch (ev.type) {
    case "LOGIN":
    case "LOGOUT":
    case "WORLD_ENTER":
      return `[${clock}] ${label}\n${who || "(unknown)"}`;
    case "PLAYER_DETECTED":
      return `[${clock}] ${label}\n${who}${ev.zone ? `\n${ev.zone}` : ""}`;
    case "PLAYER_LEVEL_CHANGED":
      return `[${clock}] ${label}\n${ev.character || "?"} → Level ${ev.level}`;
    case "PLAYER_DIED":
      return `[${clock}] ${label}\n${who}`;
    case "PLAYER_RESURRECTED": {
      const secs = ev.corpse_run_seconds != null ? ` (${Math.round(ev.corpse_run_seconds)}s walk)` : "";
      return `[${clock}] ${label}\n${who}${secs}`;
    }
    case "PLAYER_PROFESSIONS": {
      const bits = (ev.professions || [])
        .map((p) => `${p.name} ${p.rank}/${p.max_rank}`)
        .join(", ");
      return `[${clock}] ${label}\n${who}\n${bits || "—"}`;
    }
    case "PLAYER_CRAFT": {
      const qty = ev.quantity > 1 ? `${ev.quantity}× ` : "";
      return `[${clock}] ${label}\n${who}\n${qty}${ev.item_name || "item"}`;
    }
    case "PLAYER_QUESTS":
      return `[${clock}] ${label}\n${who}\ncompleted=${ev.quests_completed ?? "?"}`;
    case "PLAYER_FOOD_BUFF": {
      const f = ev.food_buff;
      if (!f) return `[${clock}] ${label}\n${who}\n(none)`;
      const rem = f.remaining_seconds != null ? ` ${Math.round(f.remaining_seconds)}s left` : "";
      return `[${clock}] ${label}\n${who}\n${f.name || "?"}${rem}`;
    }
    case "PLAYER_DISTANCE":
      return `[${clock}] ${label}\n${who}\n${ev.distance_yards != null ? Math.round(Number(ev.distance_yards) * 0.9144) + " m" : "?"}${ev.jumps != null ? ` · ${ev.jumps} jumps` : ""}`;
    case "PLAYER_POWER_STATS": {
      const line = formatPowerActivityLabel({ ...ev, class: ev.class });
      return `[${clock}] ${label}\n${who}\n${line || "—"}`;
    }
    case "PLAYER_MONEY":
      return `[${clock}] ${label}\n${who}\n${ev.gold ?? 0}g ${ev.silver ?? 0}s`;
    case "PLAYER_MAP_OPENED":
      return `[${clock}] ${label}\n${who}\n${ev.map_kind || "map"} ×${ev.opens ?? 0}`;
    case "PLAYER_ZONE_CHANGED":
      return `[${clock}] ${label}\n${ev.character || "?"} — ${ev.zone || "?"}`;
    case "PLAYER_ENTERED_INSTANCE":
      return `[${clock}] ${label}\n${ev.instance_name || "?"}`;
    case "PLAYER_LEFT_INSTANCE":
      return `[${clock}] ${label}\n${ev.instance_name || "?"}`;
    case "PLAYER_PVP_KILL":
      return `[${clock}] ${label}\n${ev.character || "?"} → ${ev.opponent_name || "?"}`;
    case "PARTY_ROSTER":
      return `[${clock}] ${label}\nmembers=${ev.group_size || (ev.members || []).length}`;
    case "PARTY_KILL": {
      const victim = ev.dest_name || ev.victim_name || ev.target_name || "?";
      return `[${clock}] ${label}\n${ev.character || "?"} → ${victim}`;
    }
    case "COMBAT_ZONE":
      return `[${clock}] ${label}\n${ev.zone || "?"}`;
    case "COMBAT_LOG_VERSION":
      return `[${clock}] ${label}`;
    default:
      return `[${clock}] ${label}\n${who || ""}`.trim();
  }
}

/**
 * Short human labels for ingest.log / console (Observed event types only).
 * Internal type codes stay on the wire and in jsonl.
 */
function ingestEventLabel(ev) {
  return eventTypeLabel(ev);
}

function updatePartyFromEvent(ev) {
  if (ev.type === "PARTY_ROSTER" && Array.isArray(ev.members)) {
    partyState = {
      updated_at: new Date().toISOString(),
      members: ev.members,
      raw: {
        in_group: ev.in_group,
        in_raid: ev.in_raid,
        group_size: ev.group_size,
        reason: ev.reason,
      },
    };
    savePartyState();
    return true;
  }
  return false;
}

function broadcast(ev, partyUpdated = false, lanUpdated = false) {
  const payload = `data: ${JSON.stringify({
    event: ev,
    text: formatEvent(ev),
    party: partyUpdated ? partyState : undefined,
    lan: lanUpdated ? lanState : undefined,
    board_version: lanState.meta?.board_version || 0,
  })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/** Keep SSE alive through Cloudflare Tunnel / proxies (idle ~100s cut). */
function sseHeartbeat() {
  if (!sseClients.size) return;
  const payload = `: ping ${Date.now()}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function eventUnixSeconds(ev) {
  if (!ev || ev.ts == null) return null;
  const n = Number(ev.ts);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? n / 1000 : n;
}

/** Catch-up when collector drains a backlog, or when event time is clearly historical. */
function isCatchUpIngest(ev, modeHeader) {
  const mode = String(modeHeader || ev?.ingest_mode || "").toLowerCase();
  if (mode === "catch-up" || mode === "catchup" || mode === "offline") return true;
  if (mode === "live") return false;
  const ts = eventUnixSeconds(ev);
  if (ts == null) return false;
  return Date.now() / 1000 - ts > 120;
}

function scheduleCatchUpRebuild() {
  if (catchUpRebuildTimer) clearTimeout(catchUpRebuildTimer);
  // Flip catch_up_active immediately so Live can show "rebuilding" without blanking.
  if (lanState?.meta) {
    lanState.meta.catch_up_active = true;
    lanState.meta.server_now = new Date().toISOString();
  }
  // Debounce hard — never stack full rebuilds on a draining backlog.
  catchUpRebuildTimer = setTimeout(() => {
    catchUpRebuildTimer = null;
    if (catchUpRebuildRunning) {
      scheduleCatchUpRebuild();
      return;
    }
    catchUpRebuildRunning = true;
    const startedAtGeneration = boardRebuildGeneration;
    const startedWith = eventsOrder.length;
    session
      .rebuildFromEventsAsync(eventsOrder)
      .then((state) => {
        reportFoldErrors(state, "catch-up rebuild");
        publishBoard(decorateLanState(state));
        let maxIngest = null;
        for (const ev of eventsOrder) {
          if (ev.host_received_at && (!maxIngest || ev.host_received_at > maxIngest)) {
            maxIngest = ev.host_received_at;
          }
        }
        if (maxIngest && lanState.meta) lanState.meta.last_ingest_at = maxIngest;
        saveLanState(true);
        broadcast(
          {
            v: 1,
            id: `catchup-rebuild-${Date.now()}`,
            ts: Math.floor(Date.now() / 1000),
            type: "CATCH_UP_REBUILT",
            source: "host",
          },
          false,
          true
        );
        hostLog(`[host] catch-up rebuild complete — ${eventsOrder.length} events`);
      })
      .catch((err) => hostError("[host] catch-up rebuild failed:", err))
      .finally(() => {
        catchUpRebuildRunning = false;
        // Live/catch-up events that landed during this rebuild were deferred from
        // session.apply — rebuild again so the board includes them in ts order.
        if (boardRebuildGeneration !== startedAtGeneration || eventsOrder.length !== startedWith) {
          scheduleCatchUpRebuild();
        }
      });
  }, 3000);
}

/** High-frequency telemetry — apply immediately, publish board snapshot less often. */
const DEBOUNCED_TYPES = new Set([
  "PARTY_ROSTER",
  "PLAYER_DISTANCE",
  "PLAYER_POWER_STATS",
  "PLAYER_MAP_OPENED",
  "PLAYER_MONEY",
  "PLAYER_FOOD_BUFF",
  "PLAYER_COMBAT_TIME",
  "POSITION_UPDATE",
]);

let publishTimer = null;
let pendingPartyBroadcast = false;
function scheduleBoardPublish(partyUpdated) {
  if (partyUpdated) pendingPartyBroadcast = true;
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    publishBoard(decorateLanState(session.getPublicState()));
    saveLanState();
    const party = pendingPartyBroadcast;
    pendingPartyBroadcast = false;
    broadcast(
      {
        v: 1,
        id: `board-${Date.now()}`,
        ts: Math.floor(Date.now() / 1000),
        type: "BOARD_REFRESH",
        source: "host",
      },
      party,
      true
    );
  }, 500);
}

function acceptEvent(ev, reqHeaders = {}, ip = "unknown") {
  // CLIENT_CONTRACT v1: only id + type are required. Unknown types and extra
  // fields must still be accepted so a mid-weekend host update cannot break a
  // frozen friend addon/agent.
  if (!ev || !ev.id || !ev.type) {
    ingestLog(`REJECTED ${ip} - event missing id/type`);
    return { status: 400, body: { error: "event.id and event.type required" } };
  }
  // Path tests must not pollute the weekend log.
  if (isSmokeProbe(ev)) {
    noteClient(ip, "smoke test POST");
    ingestLog(`SMOKE ${ip} - path OK (not stored)`);
    return { status: 200, body: { ok: true, ignored: true, reason: "smoke" } };
  }
  if (eventsById.has(ev.id)) {
    // Quiet — retries are normal; don't spam the log.
    return { status: 409, body: { ok: true, duplicate: true, id: ev.id } };
  }
  const modeHeader = reqHeaders["x-foreverlan-mode"];
  const catchUp = isCatchUpIngest(ev, modeHeader);
  const stored = {
    ...ev,
    host_received_at: new Date().toISOString(),
    ingest_mode: catchUp ? "catch-up" : "live",
  };
  // Drop bulky diagnostic blob from the durable stream
  if (stored._position_probe) delete stored._position_probe;
  // Disk first — never 409 a retry for an event that never landed in jsonl.
  try {
    persist(stored);
  } catch (err) {
    hostError(`[host] persist failed id=${stored.id}:`, err?.message || err);
    return {
      status: 503,
      body: { error: "persist failed", retry: true, id: stored.id },
    };
  }
  eventsById.set(stored.id, stored);
  eventsOrder.push(stored);
  try {
    store.upsert(stored);
  } catch (err) {
    // jsonl is source of truth; sqlite index can rebuild on next boot.
    hostError(`[host] sqlite upsert failed id=${stored.id}:`, err?.message || err);
  }

  noteClient(ip, "event push");
  const who = stored.character || stored.guid || "?";
  const zone = stored.zone ? ` @ ${stored.zone}` : "";
  const what = ingestEventLabel(stored);
  if (catchUp) {
    const now = Date.now();
    const last = catchUpLogAt.get(ip) || 0;
    if (now - last > 4000) {
      catchUpLogAt.set(ip, now);
      ingestLog(
        `CATCH-UP ${ip} - ${who} · ${what}${zone} (backlog draining; rebuild scheduled)`
      );
    }
    // Persist with original ev.ts; rebuild chronologically so late uploads keep Friday 22:01.
    boardRebuildGeneration += 1;
    scheduleCatchUpRebuild();
    return {
      status: 201,
      body: { ok: true, id: ev.id, ingest_mode: "catch-up" },
    };
  }

  // Never session.apply while a chronological rebuild is running or scheduled.
  // Mid-rebuild live apply inserts Saturday state into a half-replayed Friday board.
  if (isBoardRebuildPending()) {
    boardRebuildGeneration += 1;
    scheduleCatchUpRebuild();
    // High-frequency types already debounce board publish — don't spam LIVE-DEFER lines.
    if (!DEBOUNCED_TYPES.has(stored.type)) {
      ingestLog(`LIVE-DEFER ${ip} - ${who} · ${what}${zone} (board rebuild pending)`);
    }
    const partyUpdated = updatePartyFromEvent(stored);
    broadcast(stored, partyUpdated, false);
    return {
      status: 201,
      body: { ok: true, id: ev.id, ingest_mode: "live", board: "deferred" },
    };
  }

  if (!DEBOUNCED_TYPES.has(stored.type)) {
    ingestLog(`LIVE ${ip} - ${who} · ${what}${zone}`);
  }

  const partyUpdated = updatePartyFromEvent(stored);
  const lanUpdated = session.apply(stored, { announce: true });
  if (lanUpdated) {
    if (DEBOUNCED_TYPES.has(stored.type)) {
      scheduleBoardPublish(partyUpdated);
      // Still push the raw event to the live feed without cloning full board state.
      broadcast(stored, partyUpdated, false);
    } else {
      publishBoard(decorateLanState(session.getPublicState()));
      saveLanState();
      broadcast(stored, partyUpdated, true);
    }
  } else if (partyUpdated) {
    broadcast(stored, true, false);
  } else {
    broadcast(stored, false, false);
  }
  return { status: 201, body: { ok: true, id: ev.id, ingest_mode: "live" } };
}

/** Max POST /events body — frozen clients send tiny JSON; blocks multi‑MB DoS. */
const MAX_EVENT_BODY_BYTES = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_EVENT_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error(`body too large (max ${MAX_EVENT_BODY_BYTES} bytes)`);
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    ...(extraHeaders || {}),
  });
  res.end(data);
}

function checkIngestAuth(req) {
  const expected = process.env.FOREVERLAN_TOKEN || config.lanToken || "";
  if (!expected) {
    // Empty token is only allowed when bound to loopback (local smoke/dev).
    // LAN bind (0.0.0.0) refuses open ingest — see boot check below.
    return { ok: true };
  }
  const got =
    req.headers["x-foreverlan-token"] ||
    (String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i) || [])[1] ||
    "";
  const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
  if (!crypto.timingSafeEqual(digest(got), digest(expected))) {
    return { ok: false, status: 401, body: { error: "unauthorized" } };
  }
  return { ok: true };
}

function serveFile(res, filePath, contentType) {
  const data = fs.readFileSync(filePath);
  const headers = { "content-type": contentType };
  if (String(contentType).startsWith("text/html")) headers["cache-control"] = "no-cache";
  res.writeHead(200, headers);
  res.end(data);
}

const PUBLIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    hostError("[host] request failed:", req.method, req.url, err?.message || err);
    try {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    } catch {
      /* socket already gone */
    }
  });
});

async function handleRequest(req, res) {
  // Constant base: a malformed Host header must not throw (Host is only read by the ingest gate).
  let url;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch {
    return sendJson(res, 400, { error: "bad request" });
  }

  // Ingest public hostname (WAN): POST /events only — board stays on localhost (push-only).
  {
    const gate = gateIngestHostnameRequest(req, url.pathname, config);
    if (gate.block) {
      return sendJson(res, gate.status || 403, gate.body || { error: "forbidden" });
    }
  }

  // Always answer health fast — even while the event log is still loading.
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      ready: bootReady,
      ingest_api: 1,
      client_contract: "v1",
      events: eventsOrder.length,
      clients: sseClients.size,
      party_members: partyState.members.length,
      lan_players: lanState.players.length,
      session_id: lanState.session_id,
      last_event_at: lanState.meta?.last_event_at || null,
      last_ingest_at: lanState.meta?.last_ingest_at || null,
      fold_errors: lanState.meta?.fold_errors || 0,
      discover: "/discover",
    });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-foreverlan-event-id,x-foreverlan-token,x-foreverlan-mode,authorization",
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, path.join(__dirname, "public", "party.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/wrap") {
    return serveFile(res, path.join(__dirname, "public", "wrap.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/raw") {
    return serveFile(res, path.join(__dirname, "public", "index.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname.startsWith("/public/")) {
    const rel = path.normalize(url.pathname.slice("/public/".length)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(__dirname, "public", rel);
    if (!filePath.startsWith(path.join(__dirname, "public"))) {
      return sendJson(res, 403, { error: "forbidden" });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return sendJson(res, 404, { error: "not found" });
    }
    const ext = path.extname(filePath).toLowerCase();
    return serveFile(res, filePath, PUBLIC_TYPES[ext] || "application/octet-stream");
  }

  if (req.method === "GET" && url.pathname === "/discover") {
    const ip = clientIp(req);
    noteClient(ip, "discovery probe (looking for Forever LAN host)");
    const remote = remoteSecurityPublicMeta(config);
    return sendJson(res, 200, {
      ok: true,
      v: 1,
      ingest_api: 1,
      client_contract: "v1",
      service: "foreverlan",
      httpPort: listenPort,
      name: config.lanName || "Forever LAN",
      session_id: lanState.session_id,
      tokenRequired: Boolean(process.env.FOREVERLAN_TOKEN || config.lanToken),
      // Extra keys are OK for frozen clients (CLIENT_CONTRACT).
      remote_security: remote,
    });
  }

  if (req.method === "GET" && url.pathname === "/party") {
    return sendJson(res, 200, partyState);
  }

  if (req.method === "GET" && url.pathname === "/lan") {
    const etag = lanEtag();
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, {
        etag,
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
      });
      return res.end();
    }
    // Fresh ready/catch-up flags + client online status. Board version only moves on publish.
    const body = decorateLanState(lanState);
    return sendJson(res, 200, body, { etag, "cache-control": "no-cache" });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/diagnostics") {
    const diag = buildHostDiagnostics({
      players: lanState.players || [],
      ready: bootReady,
      catchUpActive: isBoardRebuildPending(),
      eventCount: eventsOrder.length,
      lastIngestAt: lanState.meta?.last_ingest_at || null,
      lastEventAt: lanState.meta?.last_event_at || null,
      sseClients: sseClients.size,
      ingestClients: seenClientIps.size,
      foldErrors: lanState.meta?.fold_errors || 0,
      lastFoldError: lanState.meta?.last_fold_error || null,
    });
    return sendJson(res, 200, diag);
  }

  if (req.method === "GET" && url.pathname === "/diagnostics") {
    return serveFile(res, path.join(__dirname, "public", "diagnostics.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/professions") {
    return serveFile(res, path.join(__dirname, "public", "professions.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && ["/characters", "/timeline", "/deaths", "/zones", "/milestones", "/race"].includes(url.pathname)) {
    return serveFile(res, path.join(__dirname, "public", "explore.html"), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/v1/character") {
    const character = url.searchParams.get("name") || "";
    const guidParam = url.searchParams.get("guid") || "";
    const detail = boardReads.characterDetail(lanState, eventsOrder, {
      name: character,
      guid: guidParam,
    });
    if (!detail) return sendJson(res, 404, { error: "character not on roster or no events" });
    return sendJson(res, 200, detail);
  }

  if (req.method === "GET" && url.pathname === "/api/v1/catalog") {
    return sendJson(res, 200, boardReads.catalog(lanState, eventsOrder.length));
  }

  if (req.method === "GET" && url.pathname === "/api/v1/timeline") {
    const character = url.searchParams.get("character") || "";
    const bucket = url.searchParams.get("bucket") || "ALL";
    return sendJson(res, 200, boardReads.timelineRows(lanState, eventsOrder, { character, bucket }));
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const types = url.searchParams.get("types");
    let list = eventsOrder.slice(-500);
    if (types) {
      const set = new Set(types.split(","));
      list = list.filter((e) => set.has(e.type));
    }
    return sendJson(res, 200, { events: list });
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    // Remote beta: several dashboard tabs × friends watching over the tunnel.
    while (sseClients.size >= 24) {
      const oldest = sseClients.values().next().value;
      sseClients.delete(oldest);
      try {
        oldest.end();
      } catch {
        /* ignore */
      }
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write("\n");
    res.write(
      `data: ${JSON.stringify({
        party: partyState,
        lan: decorateLanState(lanState),
        board_version: lanState.meta?.board_version || 0,
        hello: true,
      })}\n\n`
    );
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/events") {
    if (!bootReady) return sendJson(res, 503, { error: "host booting" });
    const ip = clientIp(req);
    const auth = checkIngestAuth(req);
    if (!auth.ok) {
    ingestLog(`REJECTED ${ip} - bad or missing LAN token (POST /events)`);
      return sendJson(res, auth.status, auth.body);
    }
    try {
      const body = await readBody(req);
      const result = acceptEvent(body, req.headers || {}, ip);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      const code = Number(err.statusCode) || 400;
      ingestLog(`BAD REQUEST ${ip} - ${String(err.message || err)}`);
      if (code === 413) {
        res.on("finish", () => req.destroy());
        return sendJson(res, 413, { error: String(err.message || err) }, { connection: "close" });
      }
      return sendJson(res, code, { error: String(err.message || err) });
    }
  }

  sendJson(res, 404, { error: "not found" });
}

const listenHost = config.listenHost || "0.0.0.0";
const listenPort = Number(config.listenPort || 8765);
const configuredToken = process.env.FOREVERLAN_TOKEN || config.lanToken || "";
const bindingLanWide =
  listenHost === "0.0.0.0" || listenHost === "::" || listenHost === "[::]";
if (bindingLanWide && !configuredToken) {
  hostError(
    `[host] REFUSING to bind ${listenHost}:${listenPort} without lanToken.`,
    "Set lanToken in config.json (friend packs need it). Use listenHost 127.0.0.1 for local-only smoke."
  );
  process.exit(1);
}
if (configuredToken && /GENERATE_A_LONG_RANDOM_TOKEN/i.test(configuredToken)) {
  hostError(
    "[host] REFUSING to start: lanToken is still the public placeholder from config.example.json.",
    "Set a long random lanToken in config.json, then rebuild the friend packs."
  );
  process.exit(1);
}
if (remoteSecurityModeEnabled(config.remoteSecurityMode)) {
  const ingest = String(config.ingestPublicHostname || "").trim() || "(unset)";
  hostLog(
    `[host] remoteSecurityMode=wan — push-only: ingest ${ingest} accepts POST /events (lanToken);`,
    "board stays on http://127.0.0.1/ (leave dashboard hostname off the tunnel). Tunnel off for house LAN weekend."
  );
} else if (config.publicBaseUrl && String(config.publicBaseUrl).startsWith("https://")) {
  hostLog(
    `[host] NOTE: publicBaseUrl=${config.publicBaseUrl} is optional WAN leftover;`,
    "set remoteSecurityMode=wan + ingestPublicHostname before tunneling; do not tunnel for the LAN weekend."
  );
}
{
  const bare = (config.lanRoster || []).filter((n) => !isFullName(n));
  if (bare.length) {
    hostLog(
      `[host] NOTE: lanRoster entries without a surname only match that exact name: ${bare.join(", ")}.`,
      'Forever names are "First Last" — self-telemetry characters join the board by GUID regardless.'
    );
  }
}
server.listen(listenPort, listenHost, () => {
  const publicHost = config.publicHostname || null;
  hostLog(`[host] Forever LAN TV:   http://127.0.0.1:${listenPort}/`);
  hostLog(`[host] LAN ingest bind:  http://${listenHost}:${listenPort}/`);
  if (publicHost) {
    hostLog(`[host] LAN hostname:     http://${publicHost}:${listenPort}/  (only if DNS/hosts → this PC)`);
  }
  hostLog(`[host] Discover:         GET /discover`);
  hostLog(`[host] Raw event feed:   http://127.0.0.1:${listenPort}/raw`);
  hostLog(
    `[host] ingest auth:     ${configuredToken ? "token required" : "OPEN (loopback only)"}`
  );
  // Throwaway test hosts must not advertise themselves — friend agents would switch to them.
  if (config.lanBeacon !== false) {
    startLanBeacon({
      httpPort: listenPort,
      name: config.lanName || "Forever LAN",
      sessionId: lanState.session_id,
    });
  }

  // Cloudflare (and many proxies) idle-cut SSE ~100s; comment frames keep the tunnel quiet.
  setInterval(sseHeartbeat, 20_000).unref?.();

  // Load the weekend log after listen so /health answers during boot.
  // Warm lan-state.json (if any) is already served so Live does not flash empty.
  setImmediate(() => {
    hostLog("[host] loading weekend event log…");
    loadExisting()
      .then(() => {
        bootReady = true;
        publishBoard(decorateLanState(lanState));
        if (lanState.meta) delete lanState.meta.board_provisional;
        saveLanState(true);
        broadcast(
          {
            v: 1,
            id: `boot-ready-${Date.now()}`,
            ts: Math.floor(Date.now() / 1000),
            type: "BOOT_READY",
            source: "host",
          },
          true,
          true
        );
        hostLog(
          `[host] ready session=${lanState.session_id || "—"} events=${eventsOrder.length} players=${lanState.players.length}`
        );
      })
      .catch((err) => {
        hostError("[host] boot load failed — refusing ingest until restart:", err);
        // Keep serving warm lan-state.json if any, but do NOT set bootReady.
        // Friends must keep queueing locally (503) rather than POST into an empty map
        // that would 409 forever against a still-full jsonl on disk.
        bootReady = false;
        publishBoard(decorateLanState(lanState));
        if (lanState.meta) {
          lanState.meta.ready = false;
          lanState.meta.bootstrapping = true;
          lanState.meta.boot_error = String(err?.message || err);
        }
        broadcast(
          {
            v: 1,
            id: `boot-failed-${Date.now()}`,
            ts: Math.floor(Date.now() / 1000),
            type: "BOOT_FAILED",
            source: "host",
          },
          false,
          true
        );
      });
  });
});
