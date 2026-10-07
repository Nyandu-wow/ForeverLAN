/**
 * Raw event-log views for Explore (timeline rows, session windows).
 *
 * Domain facts — identity, deaths, dings, zones, awards — come from the LanSession
 * board only. Nothing here decides whether something counts as a death or a ding;
 * session tables receive those facts from the board and only bucket them in time.
 */

import { fullNameKey } from "./character-id.js";
import { eventTypeLabelUi } from "./event-labels.js";
import { isTestEvent } from "./test-events.js";

const LEVEL_TYPES = new Set(["PLAYER_LEVEL_CHANGED"]);
const DEATH_TYPES = new Set(["PLAYER_DIED", "COMBAT_PLAYER_DEATH", "PLAYER_PVP_DEATH"]);
const ZONE_TYPES = new Set(["PLAYER_ZONE_CHANGED", "COMBAT_ZONE"]);
const QUEST_TYPES = new Set(["PLAYER_QUESTS"]);
const GROUP_TYPES = new Set(["PARTY_ROSTER", "PLAYER_ONLINE", "PLAYER_OFFLINE", "LOGIN", "LOGOUT"]);
const PROF_TYPES = new Set(["PLAYER_PROFESSIONS", "PLAYER_CRAFT"]);

function isoFromUnix(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function eventUnix(ev) {
  const n = Number(ev?.ts);
  if (!Number.isFinite(n)) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function isoToUnix(iso) {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Whose GUID a raw event carries — combat-log deaths/kills put it on dest/source. */
function eventGuid(e) {
  if (e.type === "COMBAT_PLAYER_DEATH") return e.dest_guid || e.guid || null;
  if (e.type === "PARTY_KILL") return e.source_guid || null;
  return e.guid || null;
}

function identityName(a) {
  return typeof a === "string" ? a : a?.character;
}

function identityGuid(a) {
  return typeof a === "string" ? null : a?.guid || null;
}

/**
 * @param {object} e raw event
 * @param {{ guid?: string|null, character: string }[]|string[]} allowlist board identities or exact names
 */
function onAllowlist(e, allowlist) {
  if (!allowlist || !allowlist.length) return true;
  const guid = eventGuid(e);
  const key = fullNameKey(e.character);
  return allowlist.some((a) => {
    const ag = identityGuid(a);
    if (guid && ag) return ag === guid;
    const ak = fullNameKey(identityName(a));
    return !!key && !!ak && ak === key;
  });
}

function rosterEvents(events, allowlist) {
  return (events || []).filter((e) => {
    if (!e || !e.type || e.type === "SIMULATOR" || e.source === "simulator") return false;
    if (isTestEvent(e)) return false;
    if (!e.character) return false;
    return onAllowlist(e, allowlist);
  });
}

function belongsTo(e, character, guid) {
  const eg = eventGuid(e);
  if (guid && eg) return eg === guid;
  return fullNameKey(e.character) === fullNameKey(character);
}

/**
 * Board facts for one character, in unix seconds, for session bucketing.
 * @param {object|null} player LanSession public player
 * @param {object[]} deathLog LanSession death_log rows (already filtered to this player)
 */
export function sessionFactsFromBoard(player, deathLog = []) {
  return {
    deathTimes: (deathLog || []).map((d) => Number(d.ts) || isoToUnix(d.at)).filter(Boolean),
    dingTimes: (player?.ding_times || []).map(isoToUnix).filter(Boolean),
  };
}

/**
 * Sessions from LOGIN/ONLINE → OFFLINE/LOGOUT, or gaps > 45m in activity.
 * Windows come from the raw log; dings/deaths inside each window come from the board
 * (`facts`) so this table can never disagree with Live about what counted.
 */
export function characterSessions(events, character, allowlist, guid = null, facts = {}) {
  const rows = rosterEvents(events, allowlist)
    .filter((e) => belongsTo(e, character, guid))
    .sort((a, b) => eventUnix(a) - eventUnix(b));
  if (!rows.length) return [];

  const windows = [];
  let open = null;
  const close = (endTs, endType) => {
    if (!open) return;
    windows.push({ start_ts: open.start_ts, end_ts: endTs, zones: open.zones.size, end_reason: endType || "gap" });
    open = null;
  };

  for (const ev of rows) {
    const ts = eventUnix(ev);
    if (!ts) continue;
    const endTypes = ev.type === "LOGOUT" || ev.type === "PLAYER_OFFLINE";
    if (!open) {
      open = { start_ts: ts, zones: new Set(), last_ts: ts };
    } else if (ts - open.last_ts > 45 * 60) {
      close(open.last_ts, "inactivity");
      open = { start_ts: ts, zones: new Set(), last_ts: ts };
    }
    if (ev.zone) open.zones.add(ev.zone);
    open.last_ts = ts;
    if (endTypes) close(ts, ev.type);
  }
  if (open) close(open.last_ts, "still_open");

  const deathTimes = facts.deathTimes || [];
  const dingTimes = facts.dingTimes || [];
  const within = (list, w) => list.filter((t) => t >= w.start_ts && t <= w.end_ts).length;
  return windows
    .map((w) => ({ ...w, dings: within(dingTimes, w), deaths: within(deathTimes, w) }))
    // Blips under a minute are noise — unless a ding or death happened in them.
    .filter((w) => w.end_ts - w.start_ts >= 60 || w.dings > 0 || w.deaths > 0)
    .map((w, i) => ({
      n: i + 1,
      start_at: isoFromUnix(w.start_ts),
      end_at: isoFromUnix(w.end_ts),
      seconds: w.end_ts - w.start_ts,
      dings: w.dings,
      deaths: w.deaths,
      zones: w.zones,
      end_reason: w.end_reason,
    }))
    .reverse();
}

export function characterTimeline(events, character, allowlist, guid = null) {
  const name = String(character || "").trim();
  const all = !name || name.toUpperCase() === "ALL";
  if (!all && !onAllowlist({ character: name, guid }, allowlist)) return [];
  const rows = rosterEvents(events, allowlist)
    .filter((e) => all || belongsTo(e, name, guid))
    .filter((e) =>
      [
        ...LEVEL_TYPES,
        ...DEATH_TYPES,
        ...ZONE_TYPES,
        ...QUEST_TYPES,
        ...GROUP_TYPES,
        ...PROF_TYPES,
        "PLAYER_RESURRECTED",
        "PLAYER_DISTANCE",
        "PLAYER_MONEY",
        "PLAYER_LOOT_RARE",
        "PLAYER_LOOT_EPIC",
        "PLAYER_COMBAT_TIME",
        "PLAYER_PLAYING",
      ].includes(e.type)
    )
    .map((e) => ({
      id: e.id,
      ts: eventUnix(e),
      at: isoFromUnix(eventUnix(e)),
      type: e.type,
      label: eventTypeLabelUi(e),
      bucket: bucketOf(e.type),
      zone: e.zone || null,
      level: e.level ?? null,
      character: e.character || null,
      distance_yards: e.distance_yards ?? null,
      summary: summarize(e),
    }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return thinDistanceNoise(rows);
}

/** Keep distance checkpoints, not every heartbeat tick. */
function thinDistanceNoise(rows) {
  const out = [];
  const lastKeptYards = new Map();
  for (const r of rows) {
    if (r.type !== "PLAYER_DISTANCE") {
      out.push(r);
      continue;
    }
    const yards = Number(r.distance_yards) || 0;
    const key = r.character || r.guid || "?";
    const prev = lastKeptYards.get(key);
    // Newest-first: keep first sighting, then only ~500 yd (~457 m) steps.
    if (prev == null || Math.abs(yards - prev) >= 500) {
      out.push(r);
      lastKeptYards.set(key, yards);
    }
  }
  return out;
}

function bucketOf(type) {
  if (LEVEL_TYPES.has(type)) return "LEVELING";
  if (DEATH_TYPES.has(type) || type === "PLAYER_RESURRECTED") return "DEATHS";
  if (QUEST_TYPES.has(type)) return "QUESTS";
  if (ZONE_TYPES.has(type)) return "ZONES";
  if (GROUP_TYPES.has(type) || type === "PLAYER_PLAYING") return "GROUP";
  if (PROF_TYPES.has(type)) return "PROFESSIONS";
  if (type === "PLAYER_DISTANCE" || type === "PLAYER_COMBAT_TIME") return "TRAVEL";
  if (type === "PLAYER_LOOT_RARE" || type === "PLAYER_LOOT_EPIC") return "LOOT";
  return "OTHER";
}

function summarize(e) {
  if (e.type === "PLAYER_LEVEL_CHANGED") return `Level ${e.level}`;
  if (DEATH_TYPES.has(e.type)) {
    if (e.death_summary) return e.death_summary;
    if (e.killer_name) return `slain by ${e.killer_name}`;
    if (e.environmental_type) return String(e.environmental_type);
    return e.zone ? `Died in ${e.zone}` : "Died";
  }
  if (e.type === "PLAYER_RESURRECTED") return "Resurrected";
  if (ZONE_TYPES.has(e.type)) return e.zone ? `Entered ${e.zone}` : "Zone change";
  if (e.type === "LOGIN") return "Logged in";
  if (e.type === "LOGOUT" || e.type === "PLAYER_OFFLINE") return "Offline";
  if (e.type === "PLAYER_ONLINE") return "Online";
  if (e.type === "PLAYER_PLAYING") return `Playing as ${e.character || "?"}`;
  if (e.type === "PLAYER_QUESTS") return e.quests_completed != null ? `${e.quests_completed} quests completed` : "Quest update";
  if (e.type === "PLAYER_PROFESSIONS") return "Professions updated";
  if (e.type === "PLAYER_CRAFT") {
    const qty = e.quantity > 1 ? `${e.quantity}× ` : "";
    return `Created ${qty}${e.item_name || "item"}`;
  }
  if (e.type === "PLAYER_LOOT_EPIC") return `Epic loot: ${e.item_name || "item"}`;
  if (e.type === "PLAYER_LOOT_RARE") return `Blue loot: ${e.item_name || "item"}`;
  if (e.type === "PLAYER_COMBAT_TIME") {
    const s = Math.round(Number(e.combat_seconds) || 0);
    if (s < 60) return `${s}s in combat`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s in combat` : `${m}m in combat`;
  }
  if (e.type === "PLAYER_DISTANCE") {
    const yards = Number(e.distance_yards) || 0;
    const m = Math.round(yards * 0.9144);
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km traveled` : `${m} m traveled`;
  }
  if (e.type === "PLAYER_MONEY" && e.copper != null) {
    const g = Math.floor(Number(e.copper) / 10000);
    return `${g}g`;
  }
  return e.type;
}
