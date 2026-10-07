/**
 * Forever LAN session state — rebuilt from persisted normalized events.
 * Product board must not invent unsupported telemetry.
 */

import {
  fullNameKey,
  preferDisplayName,
  resolveRosterKey,
  aliasMapFrom,
  isFullName,
} from "./character-id.js";
import {
  curateWrapHall,
  decorateAward,
  findOnyxiaWipe,
  findTooSoon,
} from "./prize-pool.js";
import {
  attachHallEvidence,
  buildCareerMilestones,
  buildLookbackMoments,
  buildRacePulse,
  scaffoldMomentClusters,
} from "./control-room.js";
import {
  formatPowerActivityLabel,
  hasRelevantPower,
  relevantPowerStats,
} from "./class-power.js";
import {
  announceHeadline,
  announceRacePulse,
  decorateActivityAnnouncements,
} from "./announcer.js";
import {
  buildLegacyMilestones,
  buildPlayerLegacy,
  detectLevelLegacyCrossings,
  detectProfessionLegacyCrossings,
  isLegacyProfessionName,
  professionJourney,
  LEGACY_PROF_THRESHOLDS,
} from "./legacy-milestones.js";
import { isTestEvent } from "./test-events.js";

const IMPORTANT_TYPES = new Set([
  "PLAYER_LEVEL_CHANGED",
  "PLAYER_DIED",
  "PLAYER_RESURRECTED",
  "PLAYER_PVP_KILL",
  "PLAYER_PVP_DEATH",
  "PLAYER_ZONE_CHANGED",
  "PLAYER_ENTERED_INSTANCE",
  "PLAYER_LEFT_INSTANCE",
  "PLAYER_ONLINE",
  "PLAYER_OFFLINE",
  "PLAYER_DETECTED",
  "LOGIN",
  "LOGOUT",
  "GROUP_ROSTER", // unused alias
  "PARTY_ROSTER",
  "COMBAT_PLAYER_DEATH",
  "PARTY_KILL",
  "PLAYER_PROFESSIONS",
  "PLAYER_QUESTS",
  "PLAYER_FOOD_BUFF",
  "PLAYER_DISTANCE",
  "PLAYER_POWER_STATS",
  "PLAYER_MONEY",
  "PLAYER_MAP_OPENED",
]);

function eventSourceKind(ev) {
  if (isTestEvent(ev)) return "TEST";
  if (ev.simulated || ev.source === "simulator") return "SIMULATOR";
  if (ev.source === "combatlog" || String(ev.type || "").startsWith("COMBAT_") || ev.type === "PARTY_KILL") {
    return "COMBAT_LOG";
  }
  if (ev.source === "addon" || ev.source === "savedvars" || ev.ingested_via === "savedvars") {
    return "HOST_CLIENT";
  }
  if (ev.source === "friend_addon") return "FRIEND_ADDON";
  if (ev.zone_source === "inferred_same_UnitPosition_instance") return "INFERRED";
  return ev.source ? String(ev.source).toUpperCase() : "UNKNOWN";
}

function confidenceFor(kind, ev) {
  if (kind === "HOST_CLIENT") return "VERIFIED";
  if (kind === "COMBAT_LOG") return "HIGH";
  if (kind === "INFERRED") return "LOW";
  if (kind === "SIMULATOR") return "LOW";
  return "MEDIUM";
}

function emptySession(opts = {}) {
  const weekendStart = opts.weekendStart || null;
  const sessionId = weekendStart ? `lan-${weekendStart}` : null;
  return {
    session_id: sessionId,
    started_at: weekendStart ? `${weekendStart}T00:00:00.000Z` : null,
    updated_at: null,
    weekend: weekendInfo(weekendStart),
    watching_since: null,
    lan_name: opts.lanName || "Forever LAN",
    players: [],
    activity: [],
    death_log: [],
    records: [],
    hall: [],
    achievements: [],
    totals: {
      online_count: 0,
      player_count: 0,
      highest_level: null,
      average_level: null,
      total_levels_gained: 0,
      total_deaths: 0,
      total_distance_yards: 0,
      total_jumps: 0,
      total_pvp_kills: 0,
      in_dungeon: false,
      dungeon_name: null,
      in_group: false,
      group_size: 0,
      in_instance_count: 0,
      party_count: 0,
      zones: [],
      recent_pvp: false,
    },
    observations: [],
    commentary: "",
    headline: null,
    rivalry: null,
    professions: null,
    legacy: null,
    wrap: null,
    meta: {
      event_count: 0,
      real_event_count: 0,
      fold_errors: 0,
      last_fold_error: null,
      last_event_at: null,
      last_ingest_at: null,
      data_model: "events=host-events.jsonl; state=LanSession;/lan",
      xp_available: false,
      weekend_start: weekendStart,
    },
  };
}

/** @param {string|null} startDate YYYY-MM-DD */
function weekendInfo(startDate, now = new Date()) {
  if (!startDate) return null;
  const start = parseLocalDate(startDate);
  if (!start) return null;
  const today = startOfLocalDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  const day = Math.floor((today - start) / dayMs) + 1;
  const weekday = now.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  if (day < 1) {
    const when = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
    return { start_date: startDate, day: null, label: `STARTS ${when}` };
  }
  return { start_date: startDate, day, label: `DAY ${day} · ${weekday}` };
}

function parseLocalDate(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function createPlayer(seed = {}) {
  const names = new Set();
  const cleaned = String(seed.character || "").trim();
  if (cleaned && !/^(unknown|nil|none|player)$/i.test(cleaned)) names.add(cleaned);
  return {
    guid: seed.guid || null,
    character: names.size ? [...names][0] : seed.character || null,
    first_name: seed.first_name || null,
    last_name: seed.last_name || null,
    names,
    realm: seed.realm || null,
    class: seed.class || null,
    race: seed.race || null,
    level: seed.level ?? null,
    start_level: seed.level ?? null,
    levels_gained: 0,
    zone: null,
    zone_source: null,
    zone_kind: null,
    online: seed.online === true,
    dead: !!seed.dead,
    is_self: !!seed.is_self,
    in_party: false,
    in_instance: false,
    instance_name: null,
    deaths: 0,
    deaths_pve: 0,
    deaths_pvp: 0,
    pvp_kills: 0,
    corpse_run_started_at: null,
    corpse_run_seconds: 0,
    longest_corpse_run_seconds: 0,
    levels_since_death: 0,
    best_levels_since_death: 0,
    professions: [],
    profession_skill_ups: 0,
    profession_feed: [],
    profession_baseline: {},
    crafts: 0,
    craft_items: {},
    quests_completed: null,
    quests_in_log: null,
    quests_ready: null,
    food_buff: null,
    distance_yards: 0,
    jumps: 0,
    combat_seconds: 0,
    loot_rare: 0,
    loot_epic: 0,
    repair_copper: 0,
    recent_loots: [],
    deaths_fall: 0,
    last_death_summary: null,
    last_killer_name: null,
    last_death_cause: null,
    attack_power: null,
    ranged_attack_power: null,
    spell_power: null,
    spell_healing: null,
    copper: null,
    gold: null,
    world_map_opens: 0,
    minimap_opens: 0,
    first_seen_at: null,
    last_seen_at: null,
    last_host_seen_at: null,
    last_ding_at: null,
    last_death_at: null,
    ding_times: [],
    level_history: [],
    zones_seen: [],
    /** Counted: logged PLAYER_ZONE_CHANGED entries per zone (repeats of the same zone skipped). */
    zone_visits: {},
    zone_entry_last: null,
    offline_started_at: null,
    offline_seconds: 0,
    longest_offline_seconds: 0,
    death_times: [],
    last_event_kind: null,
    last_event_text: null,
    last_event_at: null,
    activity_count: 0,
    position: null,
    // which product fields have real observations
    seen: {
      class: !!seed.class,
      race: !!seed.race,
      level: seed.level != null,
      zone: false,
      death: false,
      pvp_kill: false,
      pvp_death: false,
      instance: false,
      position: false,
      corpse_run: false,
      professions: false,
      crafts: false,
      quests: false,
      food_buff: false,
      distance: false,
      jumps: false,
      combat: false,
      loot: false,
      repair: false,
      power: false,
      money: false,
      map_opens: false,
    },
    sources: {},
  };
}

function itemIdFromLink(link) {
  const m = String(link || "").match(/item:(\d+)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function wowheadItemUrl(itemId, itemName) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const slug =
    String(itemName || "item")
      .toLowerCase()
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";
  return `https://www.wowhead.com/forever/item=${id}/${slug}`;
}

export class LanSession {
  constructor(opts = {}) {
    /** Configured roster: exact full-name keys ("alex river"). */
    this.roster = new Set((opts.roster || []).map(fullNameKey).filter(Boolean));
    /** Bare first-name → Forever full name (Casey → Casey Brook). Never Alex. */
    this.rosterAliases = aliasMapFrom(opts.rosterAliases || null);
    /** Display spelling for roster keys. */
    this.rosterDisplay = new Map();
    for (const n of opts.roster || []) {
      const k = fullNameKey(n);
      if (k) this.rosterDisplay.set(k, String(n).split("-")[0].trim());
    }
    /** Bank / throwaway alts — never auto-roster or show on the race board. */
    this.boardExclude = new Set((opts.boardExclude || []).map(fullNameKey).filter(Boolean));
    /** When true, self-addon LOGIN/telemetry auto-adds that character to the board roster. */
    this.rosterAuto = opts.rosterAuto !== false;
    /** Auto-rostered identities: GUIDs, plus full names for GUID-less self events. */
    this.autoGuids = new Set();
    this.autoNames = new Set();
    this.weekendStart = opts.weekendStart || null;
    this.lanName = opts.lanName || "Forever LAN";
    /** Forever level cap for this weekend (launch L60; practice may use beta cap). */
    this.levelCap = Math.max(1, Math.min(60, Number(opts.levelCap) || 60));
    this.state = emptySession({ weekendStart: this.weekendStart, lanName: this.lanName });
    this.state.meta.level_cap = this.levelCap;
    /** @type {Map<string, object>} */
    this.byGuid = new Map();
    /** @type {Map<string, boolean>} */
    this.milestones = new Map(); // record key -> claimed
    this.processedIds = new Set();
    /** @type {{ gap: number, character: string|null, vs: string|null }} */
    this.peakLead = { gap: 0, character: null, vs: null };
    /** @type {{ levels: number, character: string|null }} */
    this.peakComeback = { levels: 0, character: null };
    /** @type {Map<string, number>} */
    this.worstDeficit = new Map();
    /** @type {Map<string, number>} */
    this.leadTrades = new Map(); // "A|B" -> count
    /** @type {string|null} */
    this.prevSoleLeader = null;
    /** @type {Map<string, number[]>} */
    this.recentDeathMs = new Map(); // character -> unix ms[]
    /** @type {{ text: string, score: number, ts: string, kind: string }|null} */
    this.stickyHeadline = null;
    /** @type {Map<string, object>} record key -> player that claimed it (names re-resolve at finalize) */
    this.recordOwners = new Map();
  }

  reset() {
    this.state = emptySession({ weekendStart: this.weekendStart, lanName: this.lanName });
    this.state.meta.level_cap = this.levelCap;
    this.byGuid.clear();
    this.milestones.clear();
    this.processedIds.clear();
    this.peakLead = { gap: 0, character: null, vs: null };
    this.peakComeback = { levels: 0, character: null };
    this.worstDeficit.clear();
    this.leadTrades.clear();
    this.prevSoleLeader = null;
    this.recentDeathMs.clear();
    this.stickyHeadline = null;
    this.recordOwners.clear();
    this.autoGuids.clear();
    this.autoNames.clear();
  }

  /**
   * Rebuild from full event list (deduped by id, chronological).
   * Skips simulator events for the product board.
   */
  rebuildFromEvents(events) {
    this.reset();
    const list = chronological(events);

    for (const ev of list) {
      // One #finalize at the end — per-event finalize on a full weekend log
      // blocks the host so collectors time out.
      this.apply(ev, { announce: true, finalize: false });
    }
    this.#finalize();
    return this.getPublicState();
  }

  /**
   * Same as rebuildFromEvents but yields every chunk so HTTP /health stays responsive.
   */
  async rebuildFromEventsAsync(events, { chunkSize = 80 } = {}) {
    this.reset();
    const list = chronological(events);
    for (let i = 0; i < list.length; i++) {
      this.apply(list[i], { announce: true, finalize: false });
      if (i > 0 && i % chunkSize === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }
    this.#finalize();
    return this.getPublicState();
  }

  /**
   * Fold one event. A malformed event must never take the board down: the host has
   * already persisted it, so a throw here would repeat on every rebuild and at boot.
   */
  apply(ev, opts = {}) {
    if (!ev?.id || !ev?.type) return false;
    if (this.processedIds.has(ev.id)) return false;
    this.processedIds.add(ev.id);
    try {
      return this.#applyOne(ev, opts);
    } catch (err) {
      const meta = this.state.meta;
      meta.fold_errors = (meta.fold_errors || 0) + 1;
      meta.last_fold_error = {
        id: String(ev.id).slice(0, 120),
        type: String(ev.type).slice(0, 60),
        error: String(err?.message || err).slice(0, 200),
      };
      return false;
    }
  }

  #applyOne(ev, { announce = true, finalize = true } = {}) {
    ev = this.#repairMisfiledSurname(ev);
    this.state.meta.event_count += 1;
    const kind = eventSourceKind(ev);
    if (kind === "SIMULATOR" || kind === "TEST") {
      // Keep in event log for debugging, but do not drive the product board.
      return false;
    }
    this.state.meta.real_event_count += 1;
    this.#maybeAutoRoster(ev, kind);

    if (!this.state.watching_since) {
      // Original event time — never prefer ingest wall-clock for race/replay clocks.
      // Skip absurd clocks (smoke / year-skew) so session id isn't "2025-09-23".
      const iso = isoFromTs(ev.ts);
      const ts = Number(ev.ts);
      const nowSec = Math.floor(Date.now() / 1000);
      const sec = Number.isFinite(ts) ? (ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)) : 0;
      const sane = sec && Math.abs(nowSec - sec) <= 60 * 24 * 3600;
      if (sane && iso) {
        this.state.watching_since = iso;
      } else if (!this.state.watching_since && ev.host_received_at) {
        // Fall back only when no sane game clock yet.
        this.state.watching_since = ev.host_received_at;
      }
    }
    if (!this.state.started_at) {
      this.state.started_at = this.state.watching_since;
    }
    if (!this.state.session_id) {
      const day = (this.state.started_at || "").slice(0, 10);
      this.state.session_id = day ? `lan-${day}` : `lan-unknown`;
    }
    const eventIso = isoFromTs(ev.ts) || new Date().toISOString();
    this.state.updated_at = eventIso;
    this.state.meta.last_event_at = eventIso;
    if (ev.host_received_at) {
      this.state.meta.last_ingest_at = ev.host_received_at;
    }
    this.state.weekend = weekendInfo(this.weekendStart);

    let changed = false;

    if (ev.type === "PARTY_ROSTER" && Array.isArray(ev.members)) {
      changed = this.#applyRoster(ev, kind) || changed;
    }

    if (
      [
        "LOGIN",
        "PLAYER_DETECTED",
        "PLAYER_LEVEL_CHANGED",
        "PLAYER_DIED",
        "PLAYER_RESURRECTED",
        "PLAYER_ZONE_CHANGED",
        "PLAYER_PVP_KILL",
        "PLAYER_PVP_DEATH",
        "PLAYER_ONLINE",
        "PLAYER_OFFLINE",
        "LOGOUT",
        "PLAYER_ENTERED_INSTANCE",
        "PLAYER_LEFT_INSTANCE",
        "COMBAT_PLAYER_DEATH",
        "PARTY_KILL",
        "POSITION_UPDATE",
        "COMBAT_ZONE",
        "PLAYER_PROFESSIONS",
        "PLAYER_CRAFT",
        "PLAYER_QUESTS",
        "PLAYER_FOOD_BUFF",
        "PLAYER_DISTANCE",
        "PLAYER_POWER_STATS",
        "PLAYER_MONEY",
        "PLAYER_MAP_OPENED",
        "PLAYER_PLAYING",
        "PLAYER_COMBAT_TIME",
        "PLAYER_LOOT_RARE",
        "PLAYER_LOOT_EPIC",
        "PLAYER_REPAIR_SPEND",
      ].includes(ev.type)
    ) {
      changed = this.#applyNamed(ev, kind, announce) || changed;
    }

    if (changed && finalize) this.#finalize();
    return changed;
  }

  getPublicState() {
    return structuredClone(this.state);
  }

  #applyPosition(p, pos) {
    if (!p || !pos || typeof pos !== "object") return;
    const accuracy = pos.accuracy || "UNKNOWN";
    // Never upgrade honesty: EXACT stays; don't pretend ZONE is EXACT
    const next = {
      accuracy,
      zone: pos.zone || pos.map_name || null,
      subzone: pos.subzone || null,
      map_id: pos.map_id ?? pos.ui_map_id ?? null,
      map_name: pos.map_name || pos.ui_map_name || null,
      parent_map_id: pos.parent_map_id ?? pos.ui_map_parent ?? null,
      map_x: pos.map_x ?? null,
      map_y: pos.map_y ?? null,
      world_x: pos.world_x ?? null,
      world_y: pos.world_y ?? null,
      instance_id: pos.instance_id ?? null,
      continent_id: pos.continent_id ?? null,
      source: pos.source || null,
      confidence: pos.confidence || null,
      ts: pos.ts || null,
    };
    const hasExact =
      accuracy === "EXACT" &&
      ((next.map_x != null && next.map_y != null) ||
        (next.world_x != null && next.world_y != null));
    const hasZone = accuracy === "ZONE" || next.map_id != null || next.zone;
    if (!hasExact && !hasZone && accuracy === "UNKNOWN") {
      return;
    }
    p.position = next;
    p.seen.position = true;
    if (next.zone && !p.seen.zone) {
      p.zone = next.zone;
      p.zone_source = next.source;
      p.zone_kind = accuracy === "EXACT" ? "HOST_CLIENT" : accuracy === "ZONE" ? "HOST_CLIENT" : "INFERRED";
      p.seen.zone = true;
    }
  }

  #playerKey(ev) {
    return ev.guid || (ev.character ? `name:${ev.character}` : null);
  }

  /** @param {{ guid?: string, character?: string, names?: Set<string> }} who */
  #isExcluded(who) {
    if (!this.boardExclude.size || !who) return false;
    const names = who.names?.size ? [...who.names, who.character] : [who.character];
    return names.some((n) => {
      const key = fullNameKey(n);
      return !!key && this.boardExclude.has(key);
    });
  }

  /**
   * Older addon builds put Forever surname in `realm` (UnitName 2nd return).
   * Example: character=Sam, realm=This → character=Sam Hill.
   */
  #repairMisfiledSurname(ev) {
    if (!ev || typeof ev !== "object") return ev;
    if (Array.isArray(ev.members)) {
      return {
        ...ev,
        members: ev.members.map((m) => this.#repairMisfiledSurname(m)),
        character: this.#repairMisfiledSurname({ character: ev.character, realm: ev.realm }).character,
      };
    }
    const c = String(ev.character || "").trim();
    const realm = String(ev.realm || "").trim();
    if (!c || !realm || isFullName(c)) return ev;
    const resolved = resolveRosterKey(c, this.roster, this.rosterAliases);
    if (!resolved) return ev;
    const canon = this.rosterDisplay.get(resolved);
    if (!canon || !isFullName(canon)) return ev;
    const last = canon.split(/\s+/).slice(1).join(" ");
    if (!last || fullNameKey(last) !== fullNameKey(realm)) return ev;
    return {
      ...ev,
      character: canon,
      first_name: ev.first_name || canon.split(/\s+/)[0],
      last_name: ev.last_name || last,
      realm: "",
      realm_misfiled_surname: realm,
    };
  }

  /** @param {{ guid?: string, character?: string, names?: Set<string> }} who */
  #onRoster(who) {
    if (this.#isExcluded(who)) return false;
    if (this.roster.size === 0 && this.autoGuids.size === 0 && this.autoNames.size === 0) return true;
    if (!who) return false;
    if (who.guid && this.autoGuids.has(who.guid)) return true;
    const names = who.names?.size ? [...who.names, who.character] : [who.character];
    return names.some((n) => {
      const key = fullNameKey(n);
      if (key && this.autoNames.has(key)) return true;
      return !!resolveRosterKey(n, this.roster, this.rosterAliases);
    });
  }

  /**
   * Friends / host: only characters that actually push self-addon telemetry join the board.
   * Combat-log UNIT_DIED for random nearby players never auto-rosters.
   * Bank / excluded alts never auto-roster even with is_self.
   */
  #maybeAutoRoster(ev, kind) {
    if (!this.rosterAuto) return;
    if (!ev?.is_self || !ev.character) return;
    if (this.#isExcluded(ev)) return;
    if (kind === "COMBAT_LOG" || kind === "CHAT_LOG" || kind === "INFERRED" || kind === "SIMULATOR") {
      return;
    }
    const src = String(ev.source || "").toLowerCase();
    if (src === "combatlog" || src === "chatlog") return;
    // Host addon + friend addon self-telemetry only.
    if (kind !== "HOST_CLIENT" && kind !== "FRIEND_ADDON" && src !== "addon" && src !== "friend_addon" && src !== "savedvars") {
      return;
    }
    if (ev.guid) {
      this.autoGuids.add(ev.guid);
      return;
    }
    const key = fullNameKey(ev.character);
    if (key) this.autoNames.add(key);
  }

  /** Never shorten a known full name (Alex River → Alex). Promote aliases. */
  #preferCharacterName(p, name) {
    if (!p || !name) return;
    const next = String(name).trim();
    if (!next || /^(unknown|nil|none|player)$/i.test(next)) return;
    if (!p.names) p.names = new Set();
    p.names.add(next);
    const resolved = resolveRosterKey(next, this.roster, this.rosterAliases);
    if (resolved && !isFullName(p.character)) {
      const canon = this.rosterDisplay.get(resolved) || this.rosterAliases.get(fullNameKey(next)) || next;
      p.names.add(canon);
      p.character = preferDisplayName(p.character, canon);
      return;
    }
    p.character = preferDisplayName(p.character, next);
  }

  #pushDeathLog(p, ev) {
    if (!p?.character || !ev?.id) return;
    const at = isoFromTs(ev.ts) || new Date().toISOString();
    const ts = (() => {
      const n = Number(ev.ts);
      if (!Number.isFinite(n)) return Math.floor(new Date(at).getTime() / 1000);
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    })();
    if (!Array.isArray(this.state.death_log)) this.state.death_log = [];
    this.state.death_log.push({
      id: ev.id,
      character: p.character,
      guid: p.guid || ev.guid || null,
      level: p.level ?? ev.level ?? null,
      zone: (p.zone && p.zone_kind !== "INFERRED" ? p.zone : null) || ev.zone || null,
      ts,
      at,
      death_cause: ev.death_cause || (ev.type === "PLAYER_PVP_DEATH" ? "pvp" : null),
      killer_name: ev.killer_name || null,
      death_summary: ev.death_summary || null,
      environmental_type: ev.environmental_type || null,
    });
  }

  /** Combat log counted this fall first; move it onto the addon's clock (authoritative ev.ts). */
  #restampLastDeath(p, ev) {
    const iso = isoFromTs(ev.ts);
    if (!iso) return;
    p.last_death_source = "ADDON";
    p.last_death_at = iso;
    if (p.dead) p.corpse_run_started_at = iso;
    if (Array.isArray(p.death_times) && p.death_times.length) {
      p.death_times[p.death_times.length - 1] = iso;
    }
    const rows = this.state.death_log;
    if (!Array.isArray(rows)) return;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row) continue;
      const same = (p.guid && row.guid && p.guid === row.guid) || row.character === p.character;
      if (!same) continue;
      row.ts = Math.floor(unixSeconds(ev.ts));
      row.at = iso;
      if (p.guid && !row.guid) row.guid = p.guid;
      return;
    }
  }

  /** Enrich an already-counted death with combat-log recap (no double count). */
  #patchDeathLogRecap(p, ev) {
    if (!p?.character || !Array.isArray(this.state.death_log)) return;
    const tSec = (() => {
      const n = Number(ev.ts);
      if (!Number.isFinite(n)) return 0;
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    })();
    for (let i = this.state.death_log.length - 1; i >= 0; i--) {
      const row = this.state.death_log[i];
      if (!row) continue;
      const same =
        (p.guid && row.guid && p.guid === row.guid) ||
        row.character === p.character;
      if (!same) continue;
      if (tSec && row.ts && Math.abs(tSec - row.ts) > 360) continue;
      if (ev.death_summary) row.death_summary = ev.death_summary;
      if (ev.death_cause) row.death_cause = ev.death_cause;
      if (ev.killer_name) row.killer_name = ev.killer_name;
      if (ev.environmental_type) row.environmental_type = ev.environmental_type;
      if (ev.zone && !row.zone) row.zone = ev.zone;
      return;
    }
  }

  #attachDeathRecap(p, ev, { announce = false, kind = "COMBAT_LOG", countCause = false } = {}) {
    if (!p || !ev) return;
    const summary = ev.death_summary || null;
    const cause = ev.death_cause || null;
    const killer = ev.killer_name || null;
    const env = ev.environmental_type || null;
    if (!summary && !cause && !killer && !env) return;
    const first = !p.last_death_summary;
    if (summary) p.last_death_summary = summary;
    if (cause) p.last_death_cause = cause;
    if (killer) p.last_killer_name = killer;
    if (countCause && first) {
      if (cause === "environmental" && /fall/i.test(String(env || summary || ""))) {
        p.deaths_fall = (p.deaths_fall || 0) + 1;
      } else if (cause === "creature" || cause === "environmental") {
        p.deaths_pve = (p.deaths_pve || 0) + 1;
      } else if (cause === "pvp") {
        p.deaths_pvp = (p.deaths_pvp || 0) + 1;
        p.seen.pvp_death = true;
      }
    }
    if (announce && summary) {
      this.#activity(ev, "DEATH", `${p.character} ${summary}`, kind);
    }
  }

  #ensure(ev, kind) {
    if (ev.character && !this.#onRoster(ev)) return null;
    const key = this.#playerKey(ev);
    if (!key) return null;
    let p = this.byGuid.get(key);
    if (!p && ev.character) {
      // Upgrade a prior name-only row onto a real GUID (exact full name only) —
      // never merge two different GUIDs.
      for (const [k, existing] of this.byGuid) {
        if (existing.guid && ev.guid && existing.guid === ev.guid) {
          p = existing;
          break;
        }
        if (
          ev.guid &&
          !existing.guid &&
          existing.character === ev.character &&
          String(k).startsWith("name:")
        ) {
          this.byGuid.delete(k);
          existing.guid = ev.guid;
          this.byGuid.set(ev.guid, existing);
          p = existing;
          break;
        }
      }
    }
    if (!p) {
      p = createPlayer(ev);
      p.created_by_event = ev.id || null;
      p.first_seen_at = isoFromTs(ev.ts) || new Date().toISOString();
      if (ev.level != null) p.start_level = ev.level;
      this.byGuid.set(key, p);
    }
    if (ev.guid && p.guid !== ev.guid) {
      // Only remape when this row had no GUID yet (name:… → Player-…).
      if (!p.guid) {
        this.byGuid.delete(key);
        p.guid = ev.guid;
        this.byGuid.set(ev.guid, p);
      }
      // Different GUID on an already-GUID row = different character; do not overwrite.
    }
    if (ev.realm && !p.realm) p.realm = ev.realm;
    if (ev.first_name) p.first_name = ev.first_name;
    if (ev.last_name) p.last_name = ev.last_name;
    this.#preferCharacterName(p, ev.character);
    if (ev.first_name && ev.last_name) {
      this.#preferCharacterName(p, `${ev.first_name} ${ev.last_name}`);
    }
    p.last_seen_at = isoFromTs(ev.ts) || new Date().toISOString();
    if (ev.host_received_at) p.last_host_seen_at = ev.host_received_at;
    p.sources[ev.type] = kind;
    // Live presence: any self addon telemetry (except offline/logout) means playing.
    // Fixes Push LAN leaving Offline until the next LOGIN flush.
    if (
      p.is_self &&
      kind !== "SIMULATOR" &&
      (ev.source === "addon" || !ev.source) &&
      ev.type !== "LOGOUT" &&
      ev.type !== "PLAYER_OFFLINE"
    ) {
      if (!ev.ui_reload && ev.reason !== "push_reload") {
        this.#closeOffline(p, p.last_seen_at);
        p.online = true;
      }
    }
    return p;
  }

  /**
   * Fold name-only stubs into GUID twins (PARTY_ROSTER often omits GUID).
   * Exact full name only: "Alex" never folds into "Alex River".
   * Never merge two different GUIDs; a stub whose name fits several GUIDs is dropped.
   */
  #reconcileIdentities() {
    const guidPlayers = [...this.byGuid.values()].filter((p) => p.guid && p.character);
    const orphans = [...this.byGuid.entries()].filter(
      ([k, p]) => p && p.character && !p.guid && String(k).startsWith("name:")
    );
    for (const [key, orphan] of orphans) {
      const names = new Set([...(orphan.names || []), orphan.character].map(fullNameKey).filter(Boolean));
      const exact = guidPlayers.filter((p) =>
        [...(p.names || []), p.character].some((n) => names.has(fullNameKey(n)))
      );
      if (exact.length !== 1) {
        if (exact.length > 1) {
          this.#rehomeDeathRows(orphan, null);
          this.byGuid.delete(key);
        }
        continue;
      }
      const target = exact[0];

      this.#mergePlayerInto(target, orphan);
      this.#rehomeDeathRows(orphan, target);
      this.byGuid.delete(key);
    }
  }

  /**
   * Keep death_log on the same identities as players[]: move a folded stub's rows onto
   * its GUID twin (one row per fall), or drop them with an ambiguous stub the board drops.
   */
  #rehomeDeathRows(orphan, target) {
    const rows = this.state.death_log;
    if (!Array.isArray(rows) || !rows.length) return;
    const names = orphan.names?.size ? orphan.names : new Set([orphan.character]);
    const isOrphanRow = (r) => r && !r.guid && names.has(r.character);
    if (!rows.some(isOrphanRow)) return;
    if (!target) {
      this.state.death_log = rows.filter((r) => !isOrphanRow(r));
      return;
    }
    const isTargetRow = (r) =>
      r && ((target.guid && r.guid === target.guid) || (!r.guid && r.character === target.character));
    const kept = rows.filter((r) => isTargetRow(r) && !isOrphanRow(r));
    for (const r of rows) {
      if (!isOrphanRow(r)) continue;
      if (kept.some((k) => Math.abs((k.ts || 0) - (r.ts || 0)) <= 15)) continue;
      r.character = target.character;
      r.guid = target.guid || null;
      kept.push(r);
    }
    this.state.death_log = rows.filter((r) => !isOrphanRow(r) && !isTargetRow(r)).concat(kept);
    target.deaths = kept.length;
    if (kept.length) target.seen.death = true;
  }

  #mergePlayerInto(target, orphan) {
    if (!target || !orphan || target === orphan) return;
    for (const [key, owner] of this.recordOwners) {
      if (owner === orphan) this.recordOwners.set(key, target);
    }
    for (const n of orphan.names || []) this.#preferCharacterName(target, n);
    this.#preferCharacterName(target, orphan.character);
    if (orphan.class && !target.class) {
      target.class = orphan.class;
      target.seen.class = true;
    }
    if (orphan.race && !target.race) {
      target.race = orphan.race;
      target.seen.race = true;
    }
    if (orphan.level != null) {
      target.level = Math.max(target.level || 0, orphan.level || 0);
      target.seen.level = true;
    }
    // Prefer the richer death count (GUID path usually wins); never sum (double-count).
    if ((orphan.deaths || 0) > (target.deaths || 0)) {
      target.deaths = orphan.deaths;
      target.seen.death = true;
    }
    if (orphan.zone && !target.zone) {
      target.zone = orphan.zone;
      target.zone_source = orphan.zone_source;
      target.zone_kind = orphan.zone_kind;
      target.seen.zone = true;
    }
    if (orphan.is_self) target.is_self = true;
    if (orphan.last_seen_at && (!target.last_seen_at || orphan.last_seen_at > target.last_seen_at)) {
      target.last_seen_at = orphan.last_seen_at;
      // Presence follows the fresher row (GUID vs name-stub merge).
      target.online = !!orphan.online;
      if (!orphan.online && orphan.offline_started_at) {
        target.offline_started_at = orphan.offline_started_at;
      }
    }
  }

  #applyRoster(ev, kind) {
    const seenGuids = new Set();
    this.state.totals.in_group = !!ev.in_group;
    this.state.totals.group_size = ev.group_size ?? (ev.members || []).length;

    for (const raw of ev.members) {
      if (!raw || typeof raw !== "object") continue;
      // Members carry no clock of their own — stamp the roster's event time so a
      // rebuild never writes wall-clock first/last seen onto the board.
      const m = raw.ts != null ? raw : { ...raw, ts: ev.ts };
      const p = this.#ensure(m, kind);
      if (!p) continue;
      if (ev.host_received_at) p.last_host_seen_at = ev.host_received_at;
      seenGuids.add(p.guid || p.character);
      if (m.character) this.#preferCharacterName(p, m.character);
      if (m.class) {
        p.class = m.class;
        p.seen.class = true;
      }
      if (m.race) {
        p.race = m.race;
        p.seen.race = true;
      }
      if (m.level != null && m.level > 0) {
        if (p.start_level == null || p.start_level <= 0) p.start_level = m.level;
        if (p.level == null || m.level >= p.level) {
          p.level = m.level;
        }
        p.seen.level = true;
        p.levels_gained = Math.max(0, (p.level ?? 0) - (p.start_level ?? p.level ?? 0));
        this.#pushLevelHistory(
          p,
          isoFromTs(ev.ts) || p.last_seen_at,
          p.level,
          p.zone && p.zone_kind !== "INFERRED" ? p.zone : m.zone || null
        );
      }
      if (m.zone && m.zone_source && m.zone_source !== "unavailable") {
        const zKind =
          m.zone_source === "inferred_same_UnitPosition_instance" ? "INFERRED" : kind;
        // Prefer direct over inferred
        if (p.zone_kind !== "HOST_CLIENT" || zKind === "HOST_CLIENT") {
          p.zone = m.zone;
          p.zone_source = m.zone_source;
          p.zone_kind = zKind;
          p.seen.zone = true;
        }
      }
      p.online = m.online === true;
      p.dead = !!m.dead;
      if (m.is_self) p.is_self = true;
      p.in_party = !m.is_self && !!ev.in_group;
      if (m.is_self) p.in_party = !!ev.in_group;
      if (m.in_instance && m.instance_name) {
        p.in_instance = true;
        p.instance_name = m.instance_name;
        p.seen.instance = true;
      }
      if (m.position && typeof m.position === "object") {
        this.#applyPosition(p, m.position);
      }
    }

    // Mark players not in this roster as not in party (still keep on board)
    for (const p of this.byGuid.values()) {
      const id = p.guid || p.character;
      if (!seenGuids.has(id) && !seenGuids.has(p.character)) {
        if (!p.is_self) p.in_party = false;
      }
    }
    this.#noteRacePeaks(ev, false, kind);
    return true;
  }

  /**
   * Combat log sees every nearby player, not the LAN party.
   * Only attach a log line to someone the addon has already seen.
   * Forever combat-log names carry no surname ("Alex-ClassicBetaPvP-"), so the
   * GUID is the identity; the name fallback is exact full name for GUID-less rows.
   */
  #findKnown(guid, rawName) {
    if (guid) {
      const p = this.byGuid.get(guid);
      if (p?.character && this.#onRoster(p)) return p;
    }
    const want = fullNameKey(rawName);
    if (!want) return null;
    const matches = [];
    for (const p of this.byGuid.values()) {
      if (!p.character) continue;
      if (guid && p.guid && p.guid !== guid) continue;
      if (![...(p.names || []), p.character].some((n) => fullNameKey(n) === want)) continue;
      const src = p.sources || {};
      const fromAddon = [
        "PARTY_ROSTER",
        "LOGIN",
        "PLAYER_DETECTED",
        "PLAYER_LEVEL_CHANGED",
        "PLAYER_ONLINE",
        "PLAYER_OFFLINE",
        "PLAYER_ZONE_CHANGED",
        "PLAYER_DIED",
        "POSITION_UPDATE",
      ].some((t) => src[t]);
      if (fromAddon || p.is_self) matches.push(p);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Apply a higher observed level from any self/party snapshot (LOGIN, power, etc.).
   * Classic never loses levels. Does not invent death causes — only syncs UnitLevel.
   */
  #syncObservedLevel(p, ev, kind, announce) {
    const lvl = Number(ev.level);
    if (!Number.isFinite(lvl) || lvl <= 0) return false;
    if (p.level != null && lvl < p.level) return false;
    if (p.level != null && lvl === p.level) {
      p.seen.level = true;
      return false;
    }
    const prev = p.level;
    if (p.start_level == null || p.start_level <= 0) {
      p.start_level = prev != null && prev > 0 ? prev : lvl;
    }
    p.level = lvl;
    p.seen.level = true;
    p.levels_gained = Math.max(0, p.level - (p.start_level ?? p.level));
    if (prev != null && lvl > prev) {
      const dingIso = isoFromTs(ev.ts) || new Date().toISOString();
      p.last_ding_at = dingIso;
      if (!Array.isArray(p.ding_times)) p.ding_times = [];
      p.ding_times.push(dingIso);
      this.#pushLevelHistory(p, dingIso, p.level, p.zone && p.zone_kind !== "INFERRED" ? p.zone : ev.zone || null);
      if (announce) this.#activity(ev, "DING", `${p.character} reached level ${p.level}`, kind);
      if (announce && prev != null && prev > 0) {
        for (const cross of detectLevelLegacyCrossings(prev, p.level, p.character, p.class || null)) {
          this.#activity(
            ev,
            "MOMENT",
            `LEGACY DING — ${p.character} reached Legacy Level ${cross.threshold}.`,
            kind,
            { legacy: { kind: "level", threshold: cross.threshold } }
          );
        }
      }
    }
    return true;
  }

  #applyNamed(ev, kind, announce) {
    // Combat log zone — logging client only. Never invent a player from it.
    if (ev.type === "COMBAT_ZONE" && ev.zone) {
      const who = String(ev.character || ev.observer || "").trim();
      let self = null;
      if (ev.guid) {
        self = this.byGuid.get(ev.guid) || null;
      }
      if (!self && who) {
        // Exact full name first (Alex ≠ Alex River), then is_self fallback.
        const want = fullNameKey(who);
        for (const p of this.byGuid.values()) {
          if (fullNameKey(p.character) === want) {
            self = p;
            break;
          }
        }
      }
      if (!self) {
        for (const p of this.byGuid.values()) {
          if (p.is_self) {
            self = p;
            break;
          }
        }
      }
      if (!self) return false;
      self.zone = ev.zone;
      self.zone_source = "combatlog_ZONE_CHANGE";
      self.zone_kind = "COMBAT_LOG";
      self.seen.zone = true;
      if (announce) this.#activity(ev, "ZONE", `${self.character} entered ${ev.zone}`, kind);
      return true;
    }

    if (ev.type === "PLAYER_PLAYING") {
      const p = this.#ensure(ev, kind);
      if (!p) return false;
      p.is_self = true;
      if (ev.character) this.#preferCharacterName(p, ev.character);
      if (ev.class) {
        p.class = ev.class;
        p.seen.class = true;
      }
      // Classic never loses levels — never overwrite a higher observed level.
      this.#syncObservedLevel(p, ev, kind, false);
      return true;
    }

    // Nearby UNIT_DIED is not a LAN member unless the addon already knows them.
    if (ev.type === "COMBAT_PLAYER_DEATH") {
      const p = this.#findKnown(ev.dest_guid || ev.guid, ev.dest_name || ev.character);
      if (!p) return false;
      const hasRecap = !!(ev.death_summary || ev.death_cause || ev.killer_name || ev.environmental_type);
      // Prefer addon PLAYER_DIED — combat clocks often lag ~5 minutes behind the addon.
      const tSec = (() => {
        const n = Number(ev.ts);
        if (!Number.isFinite(n)) return 0;
        return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
      })();
      if (tSec && p.last_death_at) {
        const last = Math.floor(new Date(p.last_death_at).getTime() / 1000);
        if (Number.isFinite(last) && Math.abs(tSec - last) <= 360) {
          // Same death: attach recap without double-counting.
          if (hasRecap) {
            this.#attachDeathRecap(p, ev, { announce, kind, countCause: true });
            this.#patchDeathLogRecap(p, ev);
          }
          return true;
        }
      }
      p.deaths += 1;
      p.seen.death = true;
      p.dead = true;
      p.last_death_source = "COMBAT_LOG";
      p.levels_since_death = 0;
      p.last_death_at = isoFromTs(ev.ts) || new Date().toISOString();
      p.corpse_run_started_at = p.last_death_at;
      if (p.last_death_at) p.death_times.push(p.last_death_at);
      if (hasRecap) {
        this.#attachDeathRecap(p, ev, { announce, kind, countCause: true });
      } else if (announce) {
        this.#activity(ev, "DEATH", `${p.character} died`, kind);
      }
      this.#pushDeathLog(p, ev);
      this.#awardDeaths(p, ev, kind, announce);
      return true;
    }
    if (ev.type === "PARTY_KILL") {
      const name = ev.source_name || ev.character;
      if (!name) return false;
      // Only count as PvP if dest looks like a player — combat log parser should set flags; be conservative
      const dest = ev.dest_name || "";
      const destGuid = ev.dest_guid || "";
      const isPlayer = String(destGuid).startsWith("Player-") || ev.dest_is_player === true;
      if (!isPlayer) return false;
      const p = this.#findKnown(ev.source_guid, name);
      if (!p) return false;
      p.pvp_kills += 1;
      p.seen.pvp_kill = true;
      if (announce) this.#activity(ev, "PVP", `${p.character} killed ${dest || "a player"}`, kind);
      this.#awardPvp(p, ev, announce, kind);
      return true;
    }

    const p = this.#ensure(ev, kind);
    if (!p) {
      if (ev.type === "PLAYER_ENTERED_INSTANCE" || ev.type === "PLAYER_LEFT_INSTANCE") {
        return this.#applyInstance(ev, kind, announce);
      }
      return false;
    }

    if (ev.type === "POSITION_UPDATE" && ev.position) {
      this.#applyPosition(p, ev.position);
      if (ev.character) this.#preferCharacterName(p, ev.character);
      if (ev.class) {
        p.class = ev.class;
        p.seen.class = true;
      }
      // Classic never loses levels — never overwrite a higher observed level.
      this.#syncObservedLevel(p, ev, kind, false);
      return true;
    }

    if (ev.character) this.#preferCharacterName(p, ev.character);
    if (ev.class) {
      p.class = ev.class;
      p.seen.class = true;
    }
    if (ev.race) {
      p.race = ev.race;
      p.seen.race = true;
    }

    if (ev.type === "LOGIN" || ev.type === "PLAYER_ONLINE" || ev.type === "PLAYER_DETECTED") {
      this.#closeOffline(p, isoFromTs(ev.ts) || new Date().toISOString());
      // DETECTED/LOGIN/ONLINE mean the observer saw them connected — unless the
      // payload explicitly says online:false (disconnected party member).
      p.online = ev.online !== false;
      if (ev.level != null && ev.level > 0) {
        if (p.start_level == null || p.start_level <= 0) p.start_level = ev.level;
        // Classic levels never drop — ignore bogus party/addon regressions.
        if (p.level == null || ev.level >= p.level) {
          p.level = ev.level;
        }
        p.seen.level = true;
        p.levels_gained = Math.max(0, (p.level ?? 0) - (p.start_level ?? 0));
        const seedZone = p.zone && p.zone_kind !== "INFERRED" ? p.zone : ev.zone || null;
        this.#pushLevelHistory(p, isoFromTs(ev.ts), p.level, seedZone);
        this.#noteRacePeaks(ev, false, kind);
      }
      if (ev.zone && ev.zone_source && ev.zone_source !== "unavailable") {
        p.zone = ev.zone;
        p.zone_source = ev.zone_source;
        p.zone_kind = kind;
        p.seen.zone = true;
      }
      if (ev.position) this.#applyPosition(p, ev.position);
      if (ev.type === "PLAYER_DETECTED" && announce && !ev.is_self) {
        this.#activity(ev, "PARTY", `${p.character} joined the watch`, kind);
      }
      return true;
    }

    if (ev.type === "LOGOUT" || ev.type === "PLAYER_OFFLINE") {
      // Push LAN /reload emits LOGOUT before LOGIN is flushed — do not flip Offline.
      if (ev.ui_reload || ev.reason === "push_reload") {
        return true;
      }
      p.online = false;
      if (!p.offline_started_at) {
        p.offline_started_at = isoFromTs(ev.ts) || new Date().toISOString();
      }
      if (announce && !p.is_self) {
        this.#activity(ev, "PARTY", `${p.character} went offline`, kind);
      }
      return true;
    }

    if (ev.type === "PLAYER_LEVEL_CHANGED" && ev.level != null && ev.level > 0) {
      const newLevel = Number(ev.level);
      const oldLevel = Number(ev.old_level) > 0 ? Number(ev.old_level) : 0;
      // createPlayer seeds level from this very event — that is not a prior observation.
      const firstSighting = p.created_by_event === ev.id;
      const prevLevel = firstSighting ? null : p.level;
      // Classic never loses levels: fake downs (5→3) and the re-emit after one (3→5) are no-ops.
      if (prevLevel != null && newLevel <= prevLevel) {
        return true;
      }
      if (prevLevel == null && !(oldLevel > 0 && newLevel > oldLevel)) {
        // 0→N / missing old_level = the addon's first look at this character, not a ding.
        p.level = newLevel;
        if (firstSighting || p.start_level == null || p.start_level <= 0) p.start_level = newLevel;
        p.seen.level = true;
        p.levels_gained = Math.max(0, p.level - p.start_level);
        const seedZone = p.zone && p.zone_kind !== "INFERRED" ? p.zone : ev.zone || null;
        this.#pushLevelHistory(p, isoFromTs(ev.ts), p.level, seedZone);
        this.#noteRacePeaks(ev, false, kind);
        return true;
      }
      if (firstSighting) p.level = oldLevel;
      const leaderBefore = this.#soleLeaderName();
      if (firstSighting) {
        p.start_level = oldLevel;
      } else if (p.start_level == null || p.start_level <= 0) {
        p.start_level = oldLevel > 0 ? oldLevel : newLevel;
      }
      const dingIso = isoFromTs(ev.ts) || new Date().toISOString();
      const histZone = p.zone && p.zone_kind !== "INFERRED" ? p.zone : ev.zone || null;
      // Crossings/history start from what the board already knew, not a stale old_level.
      const fromLevel = prevLevel ?? oldLevel;
      if (fromLevel > 0) {
        this.#pushLevelHistory(p, dingIso, fromLevel, histZone);
      }
      p.level = newLevel;
      p.seen.level = true;
      p.levels_gained = Math.max(0, p.level - (p.start_level ?? p.level));
      p.last_ding_at = dingIso;
      if (!Array.isArray(p.ding_times)) p.ding_times = [];
      p.ding_times.push(dingIso);
      this.#pushLevelHistory(p, dingIso, p.level, histZone);
      p.levels_since_death = (p.levels_since_death || 0) + 1;
      p.best_levels_since_death = Math.max(p.best_levels_since_death || 0, p.levels_since_death);
      if (announce) this.#activity(ev, "DING", `${p.character} reached level ${p.level}`, kind);
      if (announce && fromLevel > 0) {
        for (const cross of detectLevelLegacyCrossings(
          fromLevel,
          p.level,
          p.character,
          p.class || ev.class || null
        )) {
          this.#activity(
            ev,
            "MOMENT",
            `LEGACY DING — ${p.character} reached Legacy Level ${cross.threshold}.`,
            kind,
            { legacy: { kind: "level", threshold: cross.threshold } }
          );
        }
      }
      if (
        p.level >= 2 &&
        this.#claimRecord("first_ding", p, ev, `${p.character} — first ding of the weekend`, "DING! GRATS!", p.character)
      ) {
        if (announce) this.#activity(ev, "MOMENT", `${p.character} scores the first ding of the weekend.`, kind);
      }
      this.#awardDingFlavor(p, ev, announce, kind);
      this.#awardDeathless(p, ev, announce, kind);
      for (const milestone of [10, 20, 30, 40, 50, 60].filter((m) => m <= this.levelCap)) {
        if (p.level >= milestone && this.#claimRecord(
          `first_level_${milestone}`,
          p,
          ev,
          `${p.character} — first to level ${milestone}`,
          `FIRST TO ${milestone}`,
          p.character
        )) {
          this.#activity(ev, "MOMENT", `${p.character} is first to ${milestone} — race to ${this.levelCap}.`, kind);
        }
      }
      const leaderAfter = this.#soleLeaderName();
      if (
        announce &&
        leaderBefore &&
        leaderAfter === p.character &&
        leaderBefore !== p.character
      ) {
        this.#activity(ev, "MOMENT", `${p.character} takes the lead in the race to ${this.levelCap}.`, kind);
        this.#noteLeadTrade(leaderBefore, leaderAfter);
      } else if (leaderAfter && this.prevSoleLeader && leaderAfter !== this.prevSoleLeader) {
        this.#noteLeadTrade(this.prevSoleLeader, leaderAfter);
      }
      if (leaderAfter) this.prevSoleLeader = leaderAfter;
      this.#noteRacePeaks(ev, announce, kind);
      this.#noteTightRace(ev, announce, kind, p);
      this.#noteStuckBehind(ev, announce, kind, p);
      this.#noteDingDrought(ev, announce, kind);
      return true;
    }

    if (ev.type === "PLAYER_DIED" || ev.type === "PLAYER_PVP_DEATH") {
      // Addon often emits PLAYER_DEAD + UnitIsDead for the same fall — count once.
      const tSec = (() => {
        const n = Number(ev.ts);
        if (!Number.isFinite(n)) return 0;
        return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
      })();
      if (tSec && p.last_death_at) {
        const last = Math.floor(new Date(p.last_death_at).getTime() / 1000);
        const gap = Math.abs(tSec - last);
        // Same fall: addon double-emit (≤15s), or the combat log already counted it
        // (its clock can run ahead or behind the addon by ~5m).
        const sameFall =
          Number.isFinite(last) &&
          (gap <= 15 || (p.last_death_source === "COMBAT_LOG" && gap <= 360));
        if (sameFall) {
          p.dead = true;
          if (p.last_death_source === "COMBAT_LOG" && gap > 15) {
            this.#restampLastDeath(p, ev);
          }
          if (ev.death_summary || ev.killer_name || ev.environmental_type) {
            this.#attachDeathRecap(p, ev, { announce: false, kind, countCause: false });
            this.#patchDeathLogRecap(p, ev);
          }
          return true;
        }
      }
      p.dead = true;
      p.deaths += 1;
      p.seen.death = true;
      p.last_death_source = "ADDON";
      p.levels_since_death = 0;
      p.last_death_at = isoFromTs(ev.ts) || new Date().toISOString();
      // Always restart the corpse-run clock on each death (don't keep a days-old start).
      p.corpse_run_started_at = p.last_death_at;
      if (p.last_death_at) p.death_times.push(p.last_death_at);
      const cause = ev.death_cause || (ev.type === "PLAYER_PVP_DEATH" ? "pvp" : null);
      if (cause === "pvp") {
        p.deaths_pvp += 1;
        p.seen.pvp_death = true;
      } else if (cause === "pve") {
        p.deaths_pve += 1;
      }
      if (ev.death_summary || ev.killer_name || ev.environmental_type) {
        this.#attachDeathRecap(p, ev, { announce: false, kind, countCause: false });
      }
      this.#pushDeathLog(p, ev);
      // If cause unknown, count total only — do not invent PvE/PvP split
      if (announce) {
        const recap = p.last_death_summary || ev.death_summary;
        if (recap) this.#activity(ev, "DEATH", `${p.character} ${recap}`, kind);
        else {
          const suffix = cause ? ` (${cause})` : "";
          this.#activity(ev, "DEATH", `${p.character} died${suffix}`, kind);
        }
      }
      this.#awardDeaths(p, ev, kind, announce);
      return true;
    }

    if (ev.type === "PLAYER_RESURRECTED") {
      p.dead = false;
      const endedAt = isoFromTs(ev.ts) || new Date().toISOString();
      // Single corpse runs longer than this are almost always bad telemetry
      // (e.g. death before the feature existed + rez days later).
      const MAX_CORPSE_RUN_SECONDS = 2 * 60 * 60;
      let seconds =
        ev.corpse_run_seconds != null && Number.isFinite(Number(ev.corpse_run_seconds))
          ? Math.max(0, Math.round(Number(ev.corpse_run_seconds)))
          : null;
      if (seconds == null && p.corpse_run_started_at) {
        const ms = new Date(endedAt) - new Date(p.corpse_run_started_at);
        if (Number.isFinite(ms) && ms >= 0) seconds = Math.round(ms / 1000);
      }
      p.corpse_run_started_at = null;
      if (seconds != null && seconds > MAX_CORPSE_RUN_SECONDS) {
        // Discard absurd spans — do not invent a long walk.
        seconds = null;
      }
      if (seconds != null && seconds > 0) {
        p.corpse_run_seconds = (p.corpse_run_seconds || 0) + seconds;
        p.longest_corpse_run_seconds = Math.max(p.longest_corpse_run_seconds || 0, seconds);
        p.seen.corpse_run = true;
        const notable = seconds >= 180 && this.#claimRecord(
          `corpse_run_long_${p.character}_${Math.floor(seconds / 60)}`,
          p,
          ev,
          `${p.character} — ${formatDuration(seconds)} corpse run`,
          "CORPSE RUN",
          `${p.character} · ${formatDuration(seconds)}`
        );
        if (announce) {
          // One feed line only — claimRecord already stores the hall award.
          const kindOut = seconds >= 60 ? "MOMENT" : "DEATH";
          this.#activity(
            ev,
            kindOut,
            notable
              ? `${p.character} finished a ${formatDuration(seconds)} corpse run.`
              : `${p.character} finished a corpse run (${formatDuration(seconds)})`,
            kind
          );
        }
      }
      return true;
    }

    if (ev.type === "PLAYER_PROFESSIONS" && Array.isArray(ev.professions)) {
      const hadSnapshot = p.seen.professions;
      const prevByName = new Map(
        (p.professions || [])
          .filter((pr) => pr?.name)
          .map((pr) => [String(pr.name), pr])
      );
      const next = ev.professions
        .filter((pr) => pr?.name)
        .map((pr) => ({
          name: String(pr.name),
          rank: Number(pr.rank) || 0,
          max_rank: Number(pr.max_rank) || 0,
          kind: pr.kind || null,
        }));
      if (!p.profession_baseline) p.profession_baseline = {};
      const ups = [];
      for (const pr of next) {
        const old = prevByName.get(pr.name);
        if (p.profession_baseline[pr.name] == null) {
          // First sighting is baseline. A mid-weekend "learned" starts at 0.
          p.profession_baseline[pr.name] =
            hadSnapshot && !old ? 0 : pr.rank;
        }
        if (!old) {
          // First weekend snapshot is baseline — do not count login ranks as skill-ups.
          if (hadSnapshot) {
            ups.push({
              name: pr.name,
              from: 0,
              to: pr.rank,
              max_rank: pr.max_rank,
              kind: pr.kind,
              learned: true,
            });
            p.profession_skill_ups = (p.profession_skill_ups || 0) + Math.max(0, pr.rank);
          }
          continue;
        }
        if (pr.rank > (old.rank || 0)) {
          const delta = pr.rank - (old.rank || 0);
          ups.push({
            name: pr.name,
            from: old.rank || 0,
            to: pr.rank,
            max_rank: pr.max_rank,
            kind: pr.kind,
            learned: false,
          });
          p.profession_skill_ups = (p.profession_skill_ups || 0) + delta;
        }
      }
      p.professions = next;
      p.seen.professions = true;
      const ts = isoFromTs(ev.ts) || new Date().toISOString();
      if (ups.length) {
        if (!Array.isArray(p.profession_feed)) p.profession_feed = [];
        for (const u of ups) {
          p.profession_feed.push({
            ts,
            event_id: ev.id || null,
            character: p.character,
            guid: p.guid || null,
            name: u.name,
            from: u.from,
            to: u.to,
            max_rank: u.max_rank,
            kind: u.kind,
            learned: !!u.learned,
          });
        }
        if (p.profession_feed.length > 40) {
          p.profession_feed = p.profession_feed.slice(-40);
        }
      }
      if (announce && ups.length) {
        for (const u of ups) {
          const text = u.learned
            ? `${p.character} learned ${u.name} (${u.to}/${u.max_rank || "?"})`
            : `${p.character}: ${u.name} ${u.from} → ${u.to}`;
          this.#activity(ev, "PROFESSION", text, kind, {
            profession: u.name,
            rank_from: u.from,
            rank_to: u.to,
          });
          if (!u.learned && isLegacyProfessionName(u.name)) {
            for (const cross of detectProfessionLegacyCrossings(u.from, u.to, u.name, p.character)) {
              this.#activity(
                ev,
                "MOMENT",
                `LEGACY MILESTONE — ${p.character} reached ${u.name} ${cross.threshold}.`,
                kind,
                {
                  legacy: {
                    kind: "profession",
                    profession: u.name,
                    threshold: cross.threshold,
                  },
                }
              );
            }
          }
        }
      }
      return true;
    }

    if (ev.type === "PLAYER_CRAFT") {
      const itemName = String(ev.item_name || "item").trim() || "item";
      const qty = Math.max(1, Math.round(Number(ev.quantity) || 1));
      p.crafts = (p.crafts || 0) + qty;
      if (!p.craft_items || typeof p.craft_items !== "object") p.craft_items = {};
      p.craft_items[itemName] = (p.craft_items[itemName] || 0) + qty;
      p.seen.crafts = true;
      const ts = isoFromTs(ev.ts) || new Date().toISOString();
      if (!Array.isArray(p.profession_feed)) p.profession_feed = [];
      p.profession_feed.push({
        ts,
        event_id: ev.id || null,
        character: p.character,
        guid: p.guid || null,
        name: itemName,
        from: null,
        to: null,
        max_rank: null,
        kind: "craft",
        learned: false,
        action: ev.action || "create",
        quantity: qty,
        item_name: itemName,
      });
      if (p.profession_feed.length > 40) {
        p.profession_feed = p.profession_feed.slice(-40);
      }
      if (announce) {
        const qtxt = qty > 1 ? `${qty}× ` : "";
        this.#activity(ev, "PROFESSION", `${p.character} created ${qtxt}${itemName}`, kind, {
          item_name: itemName,
          quantity: qty,
        });
      }
      return true;
    }

    if (ev.type === "PLAYER_QUESTS") {
      if (ev.quests_completed != null) p.quests_completed = Number(ev.quests_completed) || 0;
      if (ev.quests_in_log != null) p.quests_in_log = Number(ev.quests_in_log) || 0;
      if (ev.quests_ready != null) p.quests_ready = Number(ev.quests_ready) || 0;
      p.seen.quests = true;
      if (announce && ev.quests_completed != null) {
        this.#activity(
          ev,
          "QUEST",
          `${p.character} has completed ${p.quests_completed} quests`,
          kind
        );
      }
      return true;
    }

    if (ev.type === "PLAYER_FOOD_BUFF") {
      p.food_buff = ev.food_buff || null;
      p.seen.food_buff = !!ev.food_buff;
      if (announce && ev.food_buff?.name) {
        const rem =
          ev.food_buff.remaining_seconds != null
            ? ` (${formatDuration(ev.food_buff.remaining_seconds)} left)`
            : "";
        this.#activity(ev, "BUFF", `${p.character} food: ${ev.food_buff.name}${rem}`, kind);
      }
      return true;
    }

    if (ev.type === "PLAYER_DISTANCE") {
      if (ev.distance_yards != null) {
        const yards = Math.max(0, Math.round(Number(ev.distance_yards) || 0));
        p.distance_yards = Math.max(p.distance_yards || 0, yards);
        p.seen.distance = true;
      }
      if (ev.jumps != null) {
        const jumps = Math.max(0, Math.round(Number(ev.jumps) || 0));
        p.jumps = Math.max(p.jumps || 0, jumps);
        p.seen.jumps = true;
      }
      return true;
    }

    if (ev.type === "PLAYER_COMBAT_TIME") {
      if (ev.combat_seconds != null) {
        const secs = Math.max(0, Math.round(Number(ev.combat_seconds) || 0));
        p.combat_seconds = Math.max(p.combat_seconds || 0, secs);
        p.seen.combat = true;
      }
      return true;
    }

    if (ev.type === "PLAYER_LOOT_RARE" || ev.type === "PLAYER_LOOT_EPIC") {
      const quality = ev.type === "PLAYER_LOOT_EPIC" ? "epic" : "rare";
      const itemName = ev.item_name || "an item";
      const itemId = ev.item_id || itemIdFromLink(ev.item_link);
      const url = wowheadItemUrl(itemId, itemName);
      if (quality === "epic") p.loot_epic = (p.loot_epic || 0) + 1;
      else p.loot_rare = (p.loot_rare || 0) + 1;
      p.seen.loot = true;
      if (!Array.isArray(p.recent_loots)) p.recent_loots = [];
      p.recent_loots.unshift({
        item_name: itemName,
        item_id: itemId || null,
        item_quality: quality === "epic" ? 4 : 3,
        wowhead_url: url,
        ts: isoFromTs(ev.ts) || new Date().toISOString(),
      });
      if (p.recent_loots.length > 8) p.recent_loots.length = 8;
      if (announce) {
        const label = quality === "epic" ? "Epic" : "blue";
        this.#activity(ev, "LOOT", `${p.character} looted ${label} ${itemName}`, kind, {
          item_name: itemName,
          item_id: itemId || null,
          item_quality: quality === "epic" ? 4 : 3,
          wowhead_url: url,
        });
      }
      return true;
    }

    if (ev.type === "PLAYER_REPAIR_SPEND") {
      const total =
        ev.repair_copper != null
          ? Math.max(0, Math.round(Number(ev.repair_copper) || 0))
          : Math.max(0, (p.repair_copper || 0) + Math.round(Number(ev.spend_copper) || 0));
      p.repair_copper = Math.max(p.repair_copper || 0, total);
      p.seen.repair = p.repair_copper > 0;
      return true;
    }

    if (ev.type === "PLAYER_POWER_STATS") {
      // Snapshots often carry current level — sync if a ding event was delayed/missed.
      this.#syncObservedLevel(p, ev, kind, announce);
      if (ev.detection === "secret_blocked") {
        // Forever hid the numbers — do not publish SP/AP 0 as if observed.
        p.attack_power = null;
        p.ranged_attack_power = null;
        p.spell_power = null;
        p.spell_healing = null;
        p.seen.power = false;
        return true;
      }
      if (ev.attack_power != null) p.attack_power = Number(ev.attack_power);
      if (ev.ranged_attack_power != null) p.ranged_attack_power = Number(ev.ranged_attack_power);
      if (ev.spell_power != null) p.spell_power = Number(ev.spell_power);
      if (ev.spell_healing != null) p.spell_healing = Number(ev.spell_healing);
      if (ev.class) p.class = ev.class;
      const powerView = { ...p, class: p.class || ev.class || null };
      p.seen.power = hasRelevantPower(powerView);
      if (announce && p.seen.power) {
        const label = formatPowerActivityLabel(powerView);
        if (label) this.#activity(ev, "POWER", `${p.character}: ${label}`, kind);
      }
      return true;
    }

    if (ev.type === "PLAYER_MONEY" && ev.copper != null) {
      p.copper = Number(ev.copper) || 0;
      p.gold = ev.gold != null ? Number(ev.gold) : Math.floor(p.copper / 10000);
      p.seen.money = true;
      if (announce) {
        this.#activity(ev, "MONEY", `${p.character} has ${formatGold(p.copper)}`, kind);
      }
      return true;
    }

    if (ev.type === "PLAYER_MAP_OPENED") {
      const kindMap = ev.map_kind === "minimap" ? "minimap" : "world_map";
      const opens = Math.max(0, Number(ev.opens) || 0);
      if (kindMap === "minimap") {
        p.minimap_opens = Math.max(p.minimap_opens || 0, opens);
      } else {
        p.world_map_opens = Math.max(p.world_map_opens || 0, opens);
      }
      p.seen.map_opens = true;
      if (announce && opens > 0) {
        const label = kindMap === "minimap" ? "minimap clicks" : "map opens";
        this.#activity(ev, "MAP", `${p.character}: ${opens} ${label}`, kind);
      }
      return true;
    }

    if (ev.type === "PLAYER_ZONE_CHANGED" && ev.zone && ev.zone_source !== "unavailable") {
      const zKind =
        ev.zone_source === "inferred_same_UnitPosition_instance" ? "INFERRED" : kind;
      p.zone = ev.zone;
      p.zone_source = ev.zone_source || null;
      p.zone_kind = zKind;
      p.seen.zone = true;
      if (ev.position) this.#applyPosition(p, ev.position);
      if (zKind !== "INFERRED" && p.zone && !p.zones_seen.includes(p.zone)) {
        p.zones_seen.push(p.zone);
      }
      if (zKind !== "INFERRED" && p.zone && p.zone !== p.zone_entry_last) {
        p.zone_visits[p.zone] = (p.zone_visits[p.zone] || 0) + 1;
        p.zone_entry_last = p.zone;
      }
      if (announce && zKind !== "INFERRED") {
        this.#activity(ev, "ZONE", `${p.character} entered ${p.zone}`, kind);
      }
      this.#noteSharedZone(ev, announce, kind, p);
      return true;
    }

    if (ev.type === "PLAYER_PVP_KILL") {
      p.pvp_kills += 1;
      p.seen.pvp_kill = true;
      if (announce) {
        this.#activity(
          ev,
          "PVP",
          `${p.character} killed ${ev.opponent_name || "a player"}`,
          kind
        );
      }
      this.#awardPvp(p, ev, announce, kind);
      return true;
    }

    if (ev.type === "PLAYER_ENTERED_INSTANCE" || ev.type === "PLAYER_LEFT_INSTANCE") {
      return this.#applyInstance(ev, kind, announce, p);
    }

    return true;
  }

  #applyInstance(ev, kind, announce, p = null) {
    if (ev.type === "PLAYER_ENTERED_INSTANCE") {
      this.state.totals.in_dungeon = true;
      this.state.totals.dungeon_name = ev.instance_name || ev.zone || null;
      if (p) {
        p.in_instance = true;
        p.instance_name = this.state.totals.dungeon_name;
        p.seen.instance = true;
      }
      if (announce && this.state.totals.dungeon_name) {
        this.#activity(ev, "DUNGEON", `Entered ${this.state.totals.dungeon_name}`, kind);
      }
      this.#claimRecord(
        "first_dungeon",
        p,
        ev,
        `${p?.character || "Party"} — first dungeon (${this.state.totals.dungeon_name})`,
        "FIRST DUNGEON",
        this.state.totals.dungeon_name
          ? `${p?.character || "Party"} · ${this.state.totals.dungeon_name}`
          : (p?.character || "Party")
      );
      return true;
    }
    if (ev.type === "PLAYER_LEFT_INSTANCE") {
      const left = ev.instance_name || this.state.totals.dungeon_name || "the instance";
      this.state.totals.in_dungeon = false;
      this.state.totals.dungeon_name = null;
      if (p) {
        p.in_instance = false;
        p.instance_name = null;
      }
      if (announce) this.#activity(ev, "DUNGEON", `Left ${left}`, kind);
      return true;
    }
    return false;
  }

  #activity(ev, kind, text, sourceKind, extra = {}) {
    const ts = isoFromTs(ev.ts) || new Date().toISOString();
    this.state.activity.unshift({
      id: ev.id,
      ts,
      kind,
      text,
      source: sourceKind,
      confidence: confidenceFor(sourceKind, ev),
      character: ev.character || null,
      guid: ev.guid || null,
      ...extra,
    });
    if (this.state.activity.length > 50) this.state.activity.length = 50;

    const who = ev.character || ev.guid;
    if (who) {
      for (const p of this.byGuid.values()) {
        if (p.character === who || p.guid === who || p.guid === ev.guid) {
          p.last_event_kind = kind;
          p.last_event_text = text;
          p.last_event_at = ts;
          p.last_seen_at = ts;
          p.activity_count = (p.activity_count || 0) + 1;
          break;
        }
      }
    }
  }

  #soleLeaderName(exceptPlayer = null) {
    let best = -1;
    /** @type {string[]} */
    const names = [];
    for (const p of this.byGuid.values()) {
      if (!p.character || !p.seen.level || p.level == null) continue;
      if (exceptPlayer && p === exceptPlayer) continue;
      if (p.level > best) {
        best = p.level;
        names.length = 0;
        names.push(p.character);
      } else if (p.level === best) {
        names.push(p.character);
      }
    }
    return names.length === 1 ? names[0] : null;
  }

  #noteRacePeaks(ev, announce, kind) {
    const leveled = [...this.byGuid.values()].filter(
      (p) => p.character && this.#onRoster(p) && p.seen.level && p.level != null
    );
    if (leveled.length < 2) return;

    const sorted = [...leveled].sort((a, b) => b.level - a.level || String(a.character).localeCompare(String(b.character)));
    const leader = sorted[0];
    const second = sorted[1];
    const gap = leader.level - second.level;
    if (gap >= 2 && gap > this.peakLead.gap) {
      const was = this.peakLead.gap;
      this.peakLead = { gap, character: leader.character, vs: second.character };
      if (announce && gap >= 3 && gap > was) {
        this.#activity(
          ev,
          "MOMENT",
          `${leader.character} leads by ${gap} — biggest gap so far.`,
          kind
        );
      }
    }

    for (const p of leveled) {
      const deficit = leader.level - p.level;
      const prevWorst = this.worstDeficit.get(p.character) || 0;
      if (deficit > prevWorst) this.worstDeficit.set(p.character, deficit);
      const recovered = (this.worstDeficit.get(p.character) || 0) - deficit;
      if (recovered >= 2 && recovered > this.peakComeback.levels) {
        const was = this.peakComeback.levels;
        this.peakComeback = { levels: recovered, character: p.character };
        if (announce && recovered > was) {
          this.#activity(
            ev,
            "MOMENT",
            `${p.character} clawed back ${recovered} levels — biggest catch-up so far.`,
            kind
          );
        }
      }
    }
  }

  #awardDingFlavor(p, ev, announce, kind) {
    const times = p.ding_times || [];
    if (times.length >= 2) {
      const a = new Date(times[times.length - 1]).getTime();
      const b = new Date(times[times.length - 2]).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && a - b <= 30 * 60 * 1000) {
        if (this.#claimRecord(
          "first_double_ding",
          p,
          ev,
          `${p.character} — two dings in 30 minutes`,
          "DING! DING! DING!",
          p.character
        )) {
          if (announce) {
            this.#activity(ev, "MOMENT", `${p.character} double-dings — two levels in half an hour.`, kind);
          }
        }
      }
    }
    const iso = times[times.length - 1];
    if (iso) {
      const h = new Date(iso).getHours();
      if (h >= 0 && h < 5) {
        if (this.#claimRecord(
          "first_night_owl",
          p,
          ev,
          `${p.character} — dinged in the dead of night`,
          "NIGHT OWL",
          p.character
        )) {
          if (announce) {
            this.#activity(ev, "MOMENT", `${p.character} is night-owling the race to ${this.levelCap}.`, kind);
          }
        }
      }
    }
  }

  #awardDeathless(p, ev, announce, kind) {
    const n = p.levels_since_death || 0;
    for (const milestone of [5, 10, 15]) {
      if (
        n === milestone &&
        this.#claimRecord(
          `deathless_${milestone}_${p.character}`,
          p,
          ev,
          `${p.character} — ${milestone} levels without dying`,
          `${milestone} CLEAN`,
          `${p.character} · ${milestone} levels`
        )
      ) {
        if (announce) {
          this.#activity(
            ev,
            "MOMENT",
            `${p.character} just dinged ${milestone} levels without dying.`,
            kind
          );
        }
      }
    }
  }

  #noteSharedZone(ev, announce, kind, p) {
    if (!announce || !p?.zone || p.zone_kind === "INFERRED") return;
    const players = [...this.byGuid.values()].filter(
      (x) =>
        x.character &&
        this.#onRoster(x) &&
        x.seen.zone &&
        x.zone === p.zone &&
        x.zone_kind !== "INFERRED"
    );
    // One character can sit under several GUID rows (self telemetry + seen-in-party).
    const names = [...new Set(players.map((x) => x.character))];
    if (names.length < 2) return;
    const evMs = isoFromTs(ev.ts) ? new Date(isoFromTs(ev.ts)).getTime() : Date.now();
    const hour = Math.floor(evMs / (60 * 60 * 1000));
    const key = `together_${p.zone}_${names.length}_${hour}`;
    if (
      this.#claimRecord(
        key,
        p,
        ev,
        `${names.length} in ${p.zone}`,
        "SAME ZONE",
        `${names.join(" · ")} · ${p.zone}`
      )
    ) {
      this.#activity(
        ev,
        "MOMENT",
        `${names.length} levelers in ${p.zone} — ${names.join(", ")}.`,
        kind
      );
    }
  }

  #noteDingDrought(ev, announce, kind) {
    if (!announce) return;
    const now = isoFromTs(ev.ts) ? new Date(isoFromTs(ev.ts)).getTime() : Date.now();
    const droughtMs = 90 * 60 * 1000;
    for (const p of this.byGuid.values()) {
      if (!p.character || !this.#onRoster(p)) continue;
      if (!p.seen.level || p.level == null || p.level >= 60) continue;
      if (!p.last_ding_at) continue;
      const last = new Date(p.last_ding_at).getTime();
      if (!Number.isFinite(last)) continue;
      const gap = now - last;
      if (gap < droughtMs) continue;
      const hours = Math.floor(gap / (60 * 60 * 1000));
      if (hours < 2) continue;
      const key = `drought_${p.character}_${hours}`;
      if (
        this.#claimRecord(
          key,
          p,
          ev,
          `${p.character} — ${hours}h since last ding`,
          "DING DROUGHT",
          `${p.character} · ${hours}h`
        )
      ) {
        this.#activity(
          ev,
          "MOMENT",
          `${p.character} hasn't dinged in ${hours} hours — still ${p.level}.`,
          kind
        );
      }
    }
  }

  #awardPvp(p, ev, announce, kind) {
    const n = p.pvp_kills || 0;
    if (n === 1 && this.#claimRecord(
      "first_pvp_kill",
      p,
      ev,
      `${p.character} — first PvP kill`,
      "FIRST BLOOD",
      p.character
    )) {
      if (announce) this.#activity(ev, "MOMENT", `FIRST BLOOD — ${p.character}.`, kind);
    }
    if (n === 5 && this.#claimRecord(
      "pvp_kills_5",
      p,
      ev,
      `${p.character} — 5 PvP kills`,
      "BLOODTHIRSTY",
      p.character
    )) {
      if (announce) this.#activity(ev, "MOMENT", `${p.character} is bloodthirsty — 5 PvP kills.`, kind);
    }
    if (n === 10 && this.#claimRecord(
      "pvp_kills_10",
      p,
      ev,
      `${p.character} — 10 PvP kills`,
      "WORLD PVP ACE",
      p.character
    )) {
      if (announce) this.#activity(ev, "MOMENT", `${p.character} hits 10 PvP kills.`, kind);
    }
    if (n === 25 && this.#claimRecord(
      "pvp_kills_25",
      p,
      ev,
      `${p.character} — 25 PvP kills`,
      "SCOURGE OF THE HORDE",
      p.character
    )) {
      if (announce) {
        this.#activity(ev, "MOMENT", `${p.character} is a scourge — 25 PvP kills.`, kind);
      }
    }
  }

  #awardDeaths(p, ev, kind, announce) {
    if (this.#claimRecord("first_death", p, ev, `${p.character} — first death`, "FIRST DEATH", p.character)) {
      if (announce) this.#activity(ev, "MOMENT", `${p.character} dies first.`, kind);
    }
    for (const n of [5, 10, 15, 20]) {
      if (p.deaths === n && this.#claimRecord(
        `deaths_${n}_${p.character}`,
        p,
        ev,
        `${p.character} — ${n} deaths`,
        `${n} DEATHS`,
        p.character
      )) {
        if (announce) this.#activity(ev, "MOMENT", `${p.character} has died ${n} times.`, kind);
      }
    }
    const nowMs = Date.now();
    const tsMs = (() => {
      const iso = isoFromTs(ev.ts);
      const t = iso ? new Date(iso).getTime() : nowMs;
      return Number.isFinite(t) ? t : nowMs;
    })();
    const list = this.recentDeathMs.get(p.character) || [];
    list.push(tsMs);
    const windowMs = 20 * 60 * 1000;
    const recent = list.filter((t) => tsMs - t <= windowMs);
    this.recentDeathMs.set(p.character, recent);
    if (recent.length >= 3) {
      const key = `death_spree_${p.character}_${recent.length}_${Math.floor(tsMs / windowMs)}`;
      if (this.#claimRecord(
        key,
        p,
        ev,
        `${p.character} — ${recent.length} deaths in 20 minutes`,
        "DEATH SPREE",
        `${p.character} · ${recent.length} in 20m`
      )) {
        if (announce) {
          this.#activity(
            ev,
            "MOMENT",
            `${p.character} is on a death spree — ${recent.length} deaths in 20 minutes.`,
            kind
          );
        }
      }
    }
  }

  #noteLeadTrade(prev, next) {
    if (!prev || !next || prev === next) return;
    const key = [prev, next].sort((a, b) => a.localeCompare(b)).join("|");
    this.leadTrades.set(key, (this.leadTrades.get(key) || 0) + 1);
  }

  #noteTightRace(ev, announce, kind, p) {
    const leveled = [...this.byGuid.values()].filter(
      (x) => x.character && this.#onRoster(x) && x.seen.level && x.level != null
    );
    if (leveled.length < 2) return;
    const max = Math.max(...leveled.map((x) => x.level));
    const atMax = leveled.filter((x) => x.level === max);
    if (atMax.length >= 2) {
      const names = atMax.map((x) => x.character).sort((a, b) => a.localeCompare(b));
      const key = `tie_at_${max}_${names.join("_")}`;
      if (this.#claimRecord(
        key,
        p,
        ev,
        `${names.join(" & ")} tied at ${max}`,
        "DEAD HEAT",
        `${names.join(" & ")} · ${max}`
      )) {
        if (announce) {
          this.#activity(
            ev,
            "MOMENT",
            `${names.join(" and ")} are tied at ${max} — the race is tight.`,
            kind
          );
        }
      }
      return;
    }
    const sorted = [...leveled].sort((a, b) => b.level - a.level);
    const leader = sorted[0];
    const second = sorted[1];
    if (leader.level - second.level === 1) {
      const key = `gap_one_${leader.level}_${leader.character}_${second.character}`;
      if (this.#claimRecord(
        key,
        leader,
        ev,
        `${leader.character} leads ${second.character} by 1`,
        "ONE LEVEL",
        `${leader.character} · 1 on ${second.character}`
      )) {
        if (announce) {
          this.#activity(
            ev,
            "MOMENT",
            `${leader.character} leads ${second.character} by one level.`,
            kind
          );
        }
      }
    }
  }

  #noteStuckBehind(ev, announce, kind, p) {
    if (!p?.character || p.level == null) return;
    const others = [...this.byGuid.values()].filter(
      (x) =>
        x.character &&
        this.#onRoster(x) &&
        x.seen.level &&
        x.level != null &&
        x.character !== p.character
    );
    const dingMs = p.last_ding_at ? new Date(p.last_ding_at).getTime() : Date.now();
    for (const q of others) {
      if (q.level !== p.level - 1) continue;
      if (!q.last_ding_at) continue;
      const stuckMs = new Date(q.last_ding_at).getTime();
      if (!Number.isFinite(stuckMs) || !Number.isFinite(dingMs)) continue;
      if (dingMs - stuckMs < 90 * 60 * 1000) continue;
      const key = `stuck_${p.character}_${q.character}_${p.level}`;
      if (this.#claimRecord(
        key,
        p,
        ev,
        `${p.character} dinged while ${q.character} sits at ${q.level}`,
        "LEFT IN THE DUST",
        `${q.character} still ${q.level}`
      )) {
        if (announce) {
          this.#activity(
            ev,
            "MOMENT",
            `${p.character} dinged — ${q.character} is still stuck at ${q.level}.`,
            kind
          );
        }
      }
    }
  }

  #claimRecord(key, player, ev, label, title, detail) {
    if (this.milestones.has(key)) return false;
    this.milestones.set(key, true);
    this.state.records.push({
      key,
      title: title || null,
      detail: detail || label,
      label,
      character: player?.character || null,
      guid: player?.guid || null,
      ts: isoFromTs(ev.ts) || new Date().toISOString(),
    });
    if (player) this.recordOwners.set(key, player);
    return true;
  }

  /**
   * Records keep the name the player had when they claimed it ("Alex"); the board later
   * learns "Alex River". Re-resolve so awards always name a board row.
   */
  #canonicalizeRecordOwners() {
    const live = new Set(this.byGuid.values());
    this.state.records = this.state.records.filter((r) => {
      const owner = this.recordOwners.get(r.key);
      if (!owner) return true;
      if (!live.has(owner)) {
        // Owner was an ambiguous name stub the board dropped — cannot say which character.
        this.recordOwners.delete(r.key);
        return false;
      }
      const next = owner.character;
      if (next && r.character && next !== r.character) {
        for (const field of ["label", "detail"]) {
          const text = r[field];
          if (typeof text === "string" && !text.includes(next)) r[field] = text.split(r.character).join(next);
        }
      }
      if (next) r.character = next;
      r.guid = owner.guid || null;
      return true;
    });
    const byGuid = new Map([...live].filter((p) => p.guid).map((p) => [p.guid, p.character]));
    for (const a of this.state.activity) {
      if (a?.guid && byGuid.has(a.guid)) a.character = byGuid.get(a.guid);
    }
  }

  #finalize() {
    this.#reconcileIdentities();
    this.#canonicalizeRecordOwners();
    // One board row per GUID (or exact full name if no GUID yet).
    const players = [...this.byGuid.values()].filter((p) => p.character && this.#onRoster(p));

    // Derived presence for the Live board.
    // Self: host ingest recency wins. Push LAN LOGOUT must not strand Offline while
    // the player is still in-world waiting for the next LOGIN flush.
    // Friends: event-based online, then soft-stale if ingest goes quiet (Alt-F4).
    const STALE_MS = 90 * 60 * 1000;
    const nowMs = Date.now();
    for (const p of players) {
      const seen = p.last_host_seen_at;
      if (!seen) continue;
      const age = nowMs - new Date(seen).getTime();
      if (!Number.isFinite(age)) continue;
      if (p.is_self) {
        p.online = age <= STALE_MS;
        if (!p.online && !p.offline_started_at) p.offline_started_at = seen;
        if (p.online) p.offline_started_at = null;
      } else if (p.online && age > STALE_MS) {
        p.online = false;
        if (!p.offline_started_at) p.offline_started_at = seen;
      }
    }

    players.sort((a, b) => {
      const la = a.level ?? -1;
      const lb = b.level ?? -1;
      if (lb !== la) return lb - la;
      return String(a.character).localeCompare(String(b.character));
    });

    // Derived race records (recomputed each time)
    const derived = [];
    if (players.length) {
      const byLevel = [...players].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
      if (byLevel?.seen.level) {
        derived.push({
          key: "highest_level",
          title: "RACE LEADER",
          detail: `${byLevel.character} · ${byLevel.level} / 60`,
          label: `Race leader — ${byLevel.character} (${byLevel.level})`,
          character: byLevel.character,
        });
      }
      const byGained = [...players].sort((a, b) => (b.levels_gained || 0) - (a.levels_gained || 0))[0];
      if (byGained && byGained.levels_gained > 0) {
        derived.push({
          key: "most_levels_gained",
          title: "GRIND KING",
          detail: `${byGained.character} · +${byGained.levels_gained} this weekend`,
          label: `Most levels gained — ${byGained.character} (+${byGained.levels_gained})`,
          character: byGained.character,
        });
      }
      const anyDeaths = players.some((p) => p.seen.death);
      if (anyDeaths) {
        const byDeaths = [...players].sort((a, b) => (b.deaths || 0) - (a.deaths || 0))[0];
        if (byDeaths.deaths > 0) {
          derived.push({
            key: "most_deaths",
            title: "HOGGER'S FAVORITE",
            detail: `${byDeaths.character} · ${byDeaths.deaths} deaths`,
            label: `Most deaths — ${byDeaths.character} (${byDeaths.deaths})`,
            character: byDeaths.character,
          });
        }
      }
      const anyPvp = players.some((p) => p.seen.pvp_kill);
      if (anyPvp) {
        const byKills = [...players].sort((a, b) => (b.pvp_kills || 0) - (a.pvp_kills || 0))[0];
        if (byKills.pvp_kills > 0) {
          derived.push({
            key: "most_pvp_kills",
            title: "PVP CHAMPION",
            detail: `${byKills.character} · ${byKills.pvp_kills}`,
            label: `Most PvP kills — ${byKills.character} (${byKills.pvp_kills})`,
            character: byKills.character,
          });
        }
      }
      const anyPvpDeath = players.some((p) => p.seen.pvp_death);
      if (anyPvpDeath) {
        const byPd = [...players].sort((a, b) => (b.deaths_pvp || 0) - (a.deaths_pvp || 0))[0];
        if (byPd.deaths_pvp > 0) {
          derived.push({
            key: "most_pvp_deaths",
            title: "PVP VICTIM",
            detail: `${byPd.character} · ${byPd.deaths_pvp}`,
            label: `Most PvP deaths — ${byPd.character} (${byPd.deaths_pvp})`,
            character: byPd.character,
          });
        }
      }
      if (this.peakLead.gap >= 2 && this.peakLead.character) {
        derived.push({
          key: "biggest_lead",
          title: "FOR THE GLORY OF THE RACE",
          detail: `${this.peakLead.character} · peak lead of ${this.peakLead.gap}${
            this.peakLead.vs ? ` over ${this.peakLead.vs}` : ""
          }`,
          label: `Biggest level gap — ${this.peakLead.character} (+${this.peakLead.gap})`,
          character: this.peakLead.character,
        });
      }
      if (this.peakComeback.levels >= 2 && this.peakComeback.character) {
        derived.push({
          key: "biggest_comeback",
          title: "SECOND WIND",
          detail: `${this.peakComeback.character} · clawed back ${this.peakComeback.levels} levels`,
          label: `Biggest catch-up — ${this.peakComeback.character} (recovered ${this.peakComeback.levels})`,
          character: this.peakComeback.character,
        });
      }
      const byCorpse = [...players]
        .filter((p) => (p.longest_corpse_run_seconds || 0) > 0 || (p.corpse_run_seconds || 0) > 0)
        .sort(
          (a, b) =>
            (b.longest_corpse_run_seconds || b.corpse_run_seconds || 0) -
            (a.longest_corpse_run_seconds || a.corpse_run_seconds || 0)
        )[0];
      if (byCorpse && (byCorpse.longest_corpse_run_seconds || byCorpse.corpse_run_seconds) >= 60) {
        const secs = byCorpse.longest_corpse_run_seconds || byCorpse.corpse_run_seconds;
        derived.push({
          key: "longest_corpse_run",
          title: "CORPSE TOURIST",
          detail: `${byCorpse.character} · ${formatDuration(secs)} longest walk`,
          label: `Longest corpse run — ${byCorpse.character} (${formatDuration(secs)})`,
          character: byCorpse.character,
        });
      }
      const byDeathless = [...players]
        .filter((p) => (p.best_levels_since_death || 0) >= 5)
        .sort((a, b) => (b.best_levels_since_death || 0) - (a.best_levels_since_death || 0))[0];
      if (byDeathless) {
        derived.push({
          key: "deathless_streak",
          title: "CLEAN STREAK",
          detail: `${byDeathless.character} · ${byDeathless.best_levels_since_death} levels without dying`,
          label: `Best deathless streak — ${byDeathless.character} (${byDeathless.best_levels_since_death})`,
          character: byDeathless.character,
        });
      }
      let bestTrade = null;
      for (const [key, count] of this.leadTrades.entries()) {
        if (count < 3) continue;
        const [a, b] = key.split("|");
        if (!bestTrade || count > bestTrade.count) {
          bestTrade = { a, b, count };
        }
      }
      if (bestTrade) {
        derived.push({
          key: "most_lead_changes",
          title: "HOT POTATO",
          detail: `${bestTrade.a} vs ${bestTrade.b} · ${bestTrade.count} lead changes`,
          label: `Most lead changes — ${bestTrade.a} / ${bestTrade.b} (${bestTrade.count})`,
          character: bestTrade.a,
        });
      }
      const byDistance = [...players]
        .filter((p) => (p.distance_yards || 0) >= 500)
        .sort((a, b) => (b.distance_yards || 0) - (a.distance_yards || 0))[0];
      if (byDistance) {
        derived.push({
          key: "most_distance",
          title: "LOST IN AZEROTH",
          detail: `${byDistance.character} · ${formatDistance(byDistance.distance_yards)} sampled`,
          label: `Most sampled distance — ${byDistance.character} (${formatDistance(byDistance.distance_yards)})`,
          character: byDistance.character,
          honesty: "observed",
        });
      }
      const byJumps = [...players]
        .filter((p) => (p.jumps || 0) >= 20)
        .sort((a, b) => (b.jumps || 0) - (a.jumps || 0))[0];
      if (byJumps) {
        derived.push({
          key: "most_jumps",
          title: "BUNNY HOPPER",
          detail: `${byJumps.character} · ${byJumps.jumps} jumps`,
          label: `Most jumps — ${byJumps.character} (${byJumps.jumps})`,
          character: byJumps.character,
        });
      }
      const byCombat = [...players]
        .filter((p) => (p.combat_seconds || 0) >= 120)
        .sort((a, b) => (b.combat_seconds || 0) - (a.combat_seconds || 0))[0];
      if (byCombat) {
        derived.push({
          key: "most_combat",
          title: "MORE DOTS!",
          detail: `${byCombat.character} · ${formatDuration(byCombat.combat_seconds)} in combat`,
          label: `Most time in combat — ${byCombat.character} (${formatDuration(byCombat.combat_seconds)})`,
          character: byCombat.character,
          shame: true,
        });
      }
      const byRepair = [...players]
        .filter((p) => (p.repair_copper || 0) >= 100)
        .sort((a, b) => (b.repair_copper || 0) - (a.repair_copper || 0))[0];
      if (byRepair) {
        derived.push({
          key: "most_repairs",
          title: "YOU ARE NOT REPAIRED",
          detail: `${byRepair.character} · ~${formatGold(byRepair.repair_copper)} while at a repair vendor`,
          label: `Most repair-vendor spend (inferred) — ${byRepair.character} (~${formatGold(byRepair.repair_copper)})`,
          character: byRepair.character,
          shame: true,
          honesty: "inferred",
        });
      }
      const byPoor = [...players]
        .filter((p) => p.seen.money && p.copper != null)
        .sort((a, b) => (a.copper || 0) - (b.copper || 0))[0];
      if (byPoor && players.filter((p) => p.seen.money).length >= 2) {
        derived.push({
          key: "poorest",
          title: "BROKE AS A KOBOLD",
          detail: `${byPoor.character} · ${formatGold(byPoor.copper)} left`,
          label: `Poorest — ${byPoor.character}`,
          character: byPoor.character,
          shame: true,
        });
      }
      const byFalls = [...players]
        .filter((p) => (p.deaths_fall || 0) >= 2)
        .sort((a, b) => (b.deaths_fall || 0) - (a.deaths_fall || 0))[0];
      if (byFalls) {
        derived.push({
          key: "most_falls",
          title: "THE FLOOR IS LAVA",
          detail: `${byFalls.character} · ${byFalls.deaths_fall} fall deaths`,
          label: `Most fall deaths — ${byFalls.character} (${byFalls.deaths_fall})`,
          character: byFalls.character,
          shame: true,
        });
      }
      const byEpic = [...players]
        .filter((p) => (p.loot_epic || 0) >= 1)
        .sort((a, b) => (b.loot_epic || 0) - (a.loot_epic || 0) || (b.loot_rare || 0) - (a.loot_rare || 0))[0];
      if (byEpic) {
        derived.push({
          key: "loot_epic",
          title: "PURPLE RAIN",
          detail: `${byEpic.character} · ${byEpic.loot_epic} epic loot${(byEpic.loot_rare || 0) ? ` · ${byEpic.loot_rare} blue` : ""}`,
          label: `Most epic loot — ${byEpic.character}`,
          character: byEpic.character,
          shame: false,
        });
      } else {
        const byRare = [...players]
          .filter((p) => (p.loot_rare || 0) >= 1)
          .sort((a, b) => (b.loot_rare || 0) - (a.loot_rare || 0))[0];
        if (byRare) {
          derived.push({
            key: "loot_rare",
            title: "BLUE FINDER",
            detail: `${byRare.character} · ${byRare.loot_rare} blue loot`,
            label: `Most blue loot — ${byRare.character}`,
            character: byRare.character,
            shame: false,
          });
        }
      }
      const byQuests = [...players]
        .filter((p) => (p.quests_completed || 0) >= 5)
        .sort((a, b) => (b.quests_completed || 0) - (a.quests_completed || 0))[0];
      if (byQuests) {
        derived.push({
          key: "most_quests",
          title: "QUEST GRIND: COMPLETE",
          detail: `${byQuests.character} · ${byQuests.quests_completed} completed`,
          label: `Most quests — ${byQuests.character} (${byQuests.quests_completed})`,
          character: byQuests.character,
        });
      }
      const byGold = [...players]
        .filter((p) => (p.copper || 0) > 0)
        .sort((a, b) => (b.copper || 0) - (a.copper || 0))[0];
      if (byGold && (byGold.copper || 0) >= 10000) {
        derived.push({
          key: "richest",
          title: "DEEP POCKETS",
          detail: `${byGold.character} · ${formatGold(byGold.copper)}`,
          label: `Richest — ${byGold.character} (${formatGold(byGold.copper)})`,
          character: byGold.character,
        });
      }
      const byMap = [...players]
        .filter((p) => (p.world_map_opens || 0) + (p.minimap_opens || 0) >= 5)
        .sort(
          (a, b) =>
            (b.world_map_opens || 0) + (b.minimap_opens || 0) -
            ((a.world_map_opens || 0) + (a.minimap_opens || 0))
        )[0];
      if (byMap) {
        const total = (byMap.world_map_opens || 0) + (byMap.minimap_opens || 0);
        derived.push({
          key: "map_addict",
          title: "WHO NEEDS A MAP?",
          detail: `${byMap.character} · ${total} map checks`,
          label: `Most map checks — ${byMap.character} (${total})`,
          character: byMap.character,
        });
      }
      const totalDeaths = players.reduce((a, p) => a + (p.deaths || 0), 0);
      if (totalDeaths >= 3) {
        const survivors = players.filter((p) => p.seen.level && (p.deaths || 0) === 0);
        if (survivors.length === 1) {
          derived.push({
            key: "still_standing",
            title: "STILL STANDING",
            detail: `${survivors[0].character} · 0 deaths`,
            label: `Still standing — ${survivors[0].character}`,
            character: survivors[0].character,
          });
        }
      }
      const maxGained = players.reduce((m, p) => Math.max(m, p.levels_gained || 0), 0);
      if (maxGained >= 3) {
        const turtles = [...players]
          .filter((p) => p.seen.level)
          .sort((a, b) => (a.levels_gained || 0) - (b.levels_gained || 0));
        const turtle = turtles[0];
        const tied = turtles.filter((p) => (p.levels_gained || 0) === (turtle.levels_gained || 0));
        if (turtle && tied.length === 1 && (turtle.levels_gained || 0) < maxGained) {
          derived.push({
            key: "the_turtle",
            title: "THE TURTLE",
            detail: `${turtle.character} · +${turtle.levels_gained || 0} while others grind`,
            label: `The turtle — ${turtle.character}`,
            character: turtle.character,
          });
        }
      }
    }

    this.state.weekend = weekendInfo(this.weekendStart);

    const milestoneRecords = this.state.records.filter(
      (r) =>
        String(r.key || "").startsWith("first_level_") ||
        String(r.key || "").startsWith("deaths_") ||
        String(r.key || "").startsWith("pvp_kills_") ||
        r.key === "first_ding" ||
        r.key === "first_double_ding" ||
        r.key === "first_night_owl" ||
        r.key === "first_death" ||
        String(r.key || "").startsWith("death_spree_") ||
        String(r.key || "").startsWith("corpse_run_long_") ||
        String(r.key || "").startsWith("deathless_") ||
        String(r.key || "").startsWith("drought_") ||
        r.key === "first_pvp_kill" ||
        r.key === "first_dungeon"
    );

    this.state.players = players.map((p) => this.#publicPlayer(p, players));
    this.state.death_log = enrichDeathLog(this.state.death_log || []);
    this.state.records = sortLevelingAwards([...milestoneRecords, ...derived]);
    this.state.totals.player_count = players.length;
    this.state.totals.online_count = players.filter((p) => p.online).length;
    const levels = players.filter((p) => p.seen.level).map((p) => p.level);
    this.state.totals.highest_level = levels.length ? Math.max(...levels) : null;
    this.state.totals.average_level = levels.length
      ? Math.round((levels.reduce((a, n) => a + n, 0) / levels.length) * 10) / 10
      : null;
    this.state.totals.total_levels_gained = players.reduce((a, p) => a + (p.levels_gained || 0), 0);
    this.state.totals.total_deaths = players.reduce((a, p) => a + (p.deaths || 0), 0);
    this.state.totals.total_distance_yards = players.reduce((a, p) => a + (p.distance_yards || 0), 0);
    this.state.totals.total_jumps = players.reduce((a, p) => a + (p.jumps || 0), 0);
    this.state.totals.total_corpse_run_seconds = players.reduce(
      (a, p) => a + (p.corpse_run_seconds || 0),
      0
    );
    this.state.totals.total_pvp_kills = players.reduce((a, p) => a + (p.pvp_kills || 0), 0);
    this.state.totals.in_instance_count = players.filter((p) => p.in_instance).length;
    this.state.totals.party_count = players.filter((p) => p.in_party || (p.is_self && this.state.totals.in_group)).length;
    const zoneCounts = new Map();
    for (const p of players) {
      if (!p.seen.zone || !p.zone || p.zone_kind === "INFERRED") continue;
      zoneCounts.set(p.zone, (zoneCounts.get(p.zone) || 0) + 1);
    }
    this.state.totals.zones = [...zoneCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const recentCut = Date.now() - 15 * 60 * 1000;
    this.state.totals.recent_pvp = this.state.activity.some(
      (a) => a.kind === "PVP" && a.ts && new Date(a.ts).getTime() >= recentCut
    );
    this.state.meta.level_cap = this.levelCap;
    this.state.observations = buildObservations(players, this.state.totals, this.state.activity, this.levelCap);
    this.state.commentary = buildCommentary(players, this.levelCap);
    this.state.rivalry = this.#buildRivalry(players);
    this.state.headline = this.#buildHeadline();
    const intel = buildRaceIntel(players, this.state.records, {
      now: new Date().toISOString(),
      weekendStart: this.weekendStart || null,
      sessionId: this.state.session_id || null,
      watchingSince: this.state.watching_since || null,
    });
    this.state.trajectory = intel.trajectory;
    this.state.hall = attachHallEvidence(intel.hall, players, {
      tooSoon: findTooSoon(players),
      comeback: this.peakComeback?.levels
        ? { levels: this.peakComeback.levels, character: this.peakComeback.character }
        : null,
    });
    this.state.achievements = buildAchievementRaces(players);
    const professionParty = buildProfessionParty(players);
    this.state.professions = professionParty;
    // Tasteful Hall chips only — open-seat list stays on the Professions board.
    for (const a of professionParty.awards || []) {
      if (!a?.title || !a?.detail || a.board_only) continue;
      if (this.state.hall.some((h) => h.title === a.title && h.detail === a.detail)) continue;
      this.state.hall.push(
        decorateAward({
          title: a.title,
          detail: a.detail,
          character: a.character || null,
          shame: !!a.shame,
          honesty: a.honesty || "derived",
        })
      );
    }
    const legacyBoard = buildLegacyMilestones(players);
    this.state.legacy = legacyBoard;
    for (const a of legacyBoard.awards || []) {
      if (!a?.title || !a?.detail) continue;
      if (this.state.hall.some((h) => h.title === a.title && h.detail === a.detail)) continue;
      this.state.hall.push(
        decorateAward({
          title: a.title,
          detail: a.detail,
          character: a.character || null,
          shame: !!a.shame,
          honesty: a.honesty || "derived",
        })
      );
    }
    this.state.race_pulse = announceRacePulse(buildRacePulse(players, this.state.trajectory));
    this.state.activity = decorateActivityAnnouncements(this.state.activity);
    this.state.lookback_moments = buildLookbackMoments({
      activity: this.state.activity,
      trajectory: this.state.trajectory,
      racePulse: this.state.race_pulse,
      players,
      sinceIso: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      limit: 5,
    });
    // Scaffold only — not shown on Live yet; ready for a future moment detector.
    this.state.moment_clusters = scaffoldMomentClusters(this.state.activity);
    this.state.wrap = buildWrap(this.state);
  }

  #closeOffline(p, endIso) {
    if (!p?.offline_started_at || !endIso) return;
    const ms = new Date(endIso) - new Date(p.offline_started_at);
    if (Number.isFinite(ms) && ms > 0 && ms < 6 * 24 * 60 * 60 * 1000) {
      const seconds = Math.round(ms / 1000);
      p.offline_seconds = (p.offline_seconds || 0) + seconds;
      p.longest_offline_seconds = Math.max(p.longest_offline_seconds || 0, seconds);
    }
    p.offline_started_at = null;
  }

  /** Monotonic level samples for the race chart — never record a drop. */
  #pushLevelHistory(p, tsIso, level, zone) {
    if (!p || !tsIso || level == null || level <= 0) return;
    if (!Array.isArray(p.level_history)) p.level_history = [];
    const last = p.level_history[p.level_history.length - 1];
    if (last) {
      if (level < last.level) return;
      if (level === last.level) return;
    }
    p.level_history.push({ ts: tsIso, level, zone: zone || null });
  }

  #buildRivalry(players) {
    let best = null;
    for (const [key, count] of this.leadTrades.entries()) {
      if (count < 3) continue;
      const [a, b] = key.split("|");
      const pa = players.find((p) => p.character === a);
      const pb = players.find((p) => p.character === b);
      if (!pa?.seen.level || !pb?.seen.level) continue;
      const gap = Math.abs((pa.level || 0) - (pb.level || 0));
      if (gap > 2) continue;
      if (!best || count > best.lead_changes) {
        best = {
          a,
          b,
          lead_changes: count,
          gap,
          label: `${a.toUpperCase()} vs ${b.toUpperCase()}`,
          detail: `${count} lead changes · gap ${gap}`,
        };
      }
    }
    return best;
  }

  #buildHeadline() {
    const now = Date.now();
    const candidates = (this.state.activity || []).slice(0, 30).map((a) => {
      const age = a.ts ? now - new Date(a.ts).getTime() : 1e12;
      const fresh = age < 10 * 60 * 1000 ? 1 : age < 60 * 60 * 1000 ? 0.55 : 0.25;
      const text = String(a.text || "");
      let base = 20;
      if (a.kind === "MOMENT") {
        if (/levelers in /i.test(text)) base = 32;
        else if (/death spree|FIRST BLOOD|LEGACY DING|LEGACY MILESTONE|tied at|by one level|still stuck|takes the lead|FIRST TO|corpse run|without dying|SAME ZONE|hasn't dinged/i.test(text))
          base = 100;
        else if (/FIRST DING|double-ding|died|deaths|clawed back|leads by|CLEAN/i.test(text)) base = 75;
        else base = 55;
      } else if (a.kind === "PVP") base = 70;
      else if (a.kind === "DUNGEON") base = 50;
      else if (a.kind === "DING") base = 45;
      else if (a.kind === "DEATH") base = 40;
      else if (a.kind === "ZONE" || a.kind === "PARTY" || a.kind === "BUFF" || a.kind === "POWER") base = 6;
      return {
        sourceText: text,
        text,
        score: base * fresh,
        ts: a.ts,
        kind: a.kind,
        character: a.character || null,
      };
    });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    if (!best) {
      return announceHeadline(null, {
        fallback: this.state.commentary || `THE RACE TO ${this.levelCap}`,
        ts: this.state.updated_at || new Date().toISOString(),
      });
    }
    const voiced = announceHeadline(best, { levelCap: this.levelCap });
    const sticky = this.stickyHeadline;
    const stickyAge = sticky?.ts ? now - new Date(sticky.ts).getTime() : 1e12;
    const plumbing = best.kind === "ZONE" || best.kind === "PARTY" || best.kind === "BUFF" || best.kind === "POWER";
    // A zone walk or party ping must not evict a death, ding, or gathering just because it is newer.
    if (!sticky || (!plumbing && (best.score > (sticky.score || 0) + 8 || stickyAge > 20 * 60 * 1000))) {
      this.stickyHeadline = voiced;
    }
    return this.stickyHeadline;
  }

  #publicPlayer(p, allPlayers) {
    const out = {
      guid: p.guid,
      character: p.character,
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      realm: p.realm || null,
      is_self: p.is_self,
      online: p.online,
      dead: p.dead,
      in_party: p.in_party,
    };
    if (p.seen.class && p.class) out.class = p.class;
    if (p.seen.race && p.race) out.race = p.race;
    if (p.seen.level && p.level != null) {
      out.level = p.level;
      out.start_level = p.start_level;
      out.levels_gained = p.levels_gained;
      const leaderLvl = allPlayers
        .filter((x) => x.seen.level && x.level != null)
        .reduce((m, x) => Math.max(m, x.level), 0);
      if (leaderLvl > 0 && p.level < leaderLvl) out.gap_to_leader = leaderLvl - p.level;
      else if (leaderLvl > 0 && p.level === leaderLvl) out.gap_to_leader = 0;
    }
    // Zone: only DIRECT/HOST — hide pure INFERRED on the TV board
    if (p.seen.zone && p.zone && p.zone_kind !== "INFERRED") {
      out.zone = p.zone;
      out.zone_source = p.zone_source;
    }
    if (p.seen.death || (p.deaths || 0) > 0) {
      out.deaths = p.deaths || 0;
      if (p.deaths_pve > 0) out.deaths_pve = p.deaths_pve;
      if (p.deaths_pvp > 0) out.deaths_pvp = p.deaths_pvp;
    } else if (p.seen.level) {
      out.deaths = 0;
    }
    if (Array.isArray(p.zones_seen) && p.zones_seen.length) {
      out.zones_seen = [...p.zones_seen];
      out.zones = p.zones_seen.length;
    }
    if (p.zone_visits && Object.keys(p.zone_visits).length) {
      out.zone_visits = { ...p.zone_visits };
    }
    if (p.seen.corpse_run) {
      out.corpse_run_seconds = p.corpse_run_seconds || 0;
      out.longest_corpse_run_seconds = p.longest_corpse_run_seconds || 0;
    }
    if (p.dead && p.corpse_run_started_at) {
      out.corpse_run_started_at = p.corpse_run_started_at;
    }
    if ((p.levels_since_death || 0) > 0 || (p.best_levels_since_death || 0) > 0) {
      out.levels_since_death = p.levels_since_death || 0;
      out.best_levels_since_death = p.best_levels_since_death || 0;
    }
    if (p.seen.professions && Array.isArray(p.professions) && p.professions.length) {
      out.professions = p.professions;
      if ((p.profession_skill_ups || 0) > 0) {
        out.profession_skill_ups = p.profession_skill_ups;
      }
    }
    const legacy = buildPlayerLegacy(p);
    if (legacy) out.legacy = legacy;
    if ((p.crafts || 0) > 0) {
      out.crafts = p.crafts;
      const names = Object.keys(p.craft_items || {});
      if (names.length) out.craft_distinct = names.length;
    }
    if (p.seen.quests) {
      if (p.quests_completed != null) out.quests_completed = p.quests_completed;
      if (p.quests_in_log != null) out.quests_in_log = p.quests_in_log;
      if (p.quests_ready != null) out.quests_ready = p.quests_ready;
    }
    if (p.seen.food_buff && p.food_buff) {
      out.food_buff = { ...p.food_buff };
    }
    if (p.seen.distance && (p.distance_yards || 0) > 0) {
      out.distance_yards = p.distance_yards;
      out.distance_m = Math.round((p.distance_yards || 0) * 0.9144);
    }
    if (p.seen.jumps && (p.jumps || 0) > 0) {
      out.jumps = p.jumps;
    }
    if (p.seen.combat && (p.combat_seconds || 0) > 0) {
      out.combat_seconds = p.combat_seconds;
    }
    if (p.seen.loot) {
      if (p.loot_rare) out.loot_rare = p.loot_rare;
      if (p.loot_epic) out.loot_epic = p.loot_epic;
      if (Array.isArray(p.recent_loots) && p.recent_loots.length) {
        out.recent_loots = p.recent_loots.slice(0, 5);
      }
    }
    if (p.seen.repair && (p.repair_copper || 0) > 0) {
      out.repair_copper = p.repair_copper;
      out.repair_text = formatGold(p.repair_copper);
    }
    if (p.last_death_summary) out.last_death_summary = p.last_death_summary;
    if (p.last_killer_name) out.last_killer_name = p.last_killer_name;
    if ((p.deaths_fall || 0) > 0) out.deaths_fall = p.deaths_fall;
    if (p.seen.power) {
      const pow = relevantPowerStats({ ...p, class: p.class || null });
      if (pow.attack_power != null) out.attack_power = pow.attack_power;
      if (pow.ranged_attack_power != null) out.ranged_attack_power = pow.ranged_attack_power;
      if (pow.spell_power != null) out.spell_power = pow.spell_power;
      if (pow.spell_healing != null) out.spell_healing = pow.spell_healing;
    }
    if (p.seen.money && p.copper != null) {
      out.copper = p.copper;
      out.gold = p.gold;
      out.money_text = formatGold(p.copper);
    }
    if (p.seen.map_opens) {
      if (p.world_map_opens) out.world_map_opens = p.world_map_opens;
      if (p.minimap_opens) out.minimap_opens = p.minimap_opens;
    }
    if (p.seen.pvp_kill || p.seen.pvp_death) {
      out.pvp_kills = p.pvp_kills;
      out.pvp_deaths = p.deaths_pvp;
      if (p.pvp_kills > 0 || p.deaths_pvp > 0) {
        out.kd =
          p.deaths_pvp > 0
            ? Math.round((p.pvp_kills / p.deaths_pvp) * 10) / 10
            : p.pvp_kills;
      }
    }
    if (p.seen.instance && p.in_instance && p.instance_name) {
      out.in_instance = true;
      out.instance_name = p.instance_name;
    }
    if (p.seen.position && p.position) {
      out.position = { ...p.position };
    }
    if (p.last_seen_at) out.last_seen_at = p.last_seen_at;
    if (p.first_seen_at) out.first_seen_at = p.first_seen_at;
    if (p.last_ding_at) out.last_ding_at = p.last_ding_at;
    if (Array.isArray(p.ding_times) && p.ding_times.length) out.ding_times = [...p.ding_times];
    if (p.last_host_seen_at) out.last_host_seen_at = p.last_host_seen_at;
    if (p.last_event_kind) {
      out.last_event_kind = p.last_event_kind;
      out.last_event_text = p.last_event_text;
      let eventAt = p.last_event_at;
      if (!eventAt && p.last_event_text) {
        const hit = (this.state.activity || []).find(
          (a) =>
            a.text === p.last_event_text &&
            a.kind === p.last_event_kind &&
            (!a.character || a.character === p.character)
        );
        if (hit?.ts) eventAt = hit.ts;
      }
      if (eventAt) out.last_event_at = eventAt;
    }
    out.tags = playerTags(p, allPlayers);
    out.career = buildCareerMilestones(p);
    // Placeholder status — decorateLanState refreshes with catch-up flag from the host.
    out.client_status = {
      status: p.online ? "REPORTING" : "OFFLINE",
      label: p.online ? "Reporting" : "Offline",
      host_ingest_at: p.last_host_seen_at || null,
      game_event_at: out.last_event_at || p.last_seen_at || null,
      honesty: "derived",
    };
    return out;
  }
}

function playerTags(p, allPlayers) {
  const tags = [];
  const leveled = allPlayers.filter((x) => x.seen.level && x.level != null);
  const maxLevel = leveled.reduce((m, x) => Math.max(m, x.level), 0);
  const leaders = leveled.filter((x) => x.level === maxLevel);
  if (maxLevel > 0 && leaders.length === 1 && p.level === maxLevel) tags.push("RACE LEADER");
  const dying = allPlayers.filter((x) => x.seen.death && x.deaths > 0);
  const maxDeaths = dying.reduce((m, x) => Math.max(m, x.deaths), 0);
  if (p.seen.death && p.deaths >= 3 && p.deaths === maxDeaths) tags.push("HOGGER'S FAVORITE");
  const corpseWalkers = allPlayers.filter((x) => (x.longest_corpse_run_seconds || 0) > 0);
  const maxCorpse = corpseWalkers.reduce((m, x) => Math.max(m, x.longest_corpse_run_seconds || 0), 0);
  if (
    maxCorpse >= 120 &&
    p.longest_corpse_run_seconds === maxCorpse &&
    corpseWalkers.filter((x) => x.longest_corpse_run_seconds === maxCorpse).length === 1
  ) {
    tags.push("CORPSE TOURIST");
  }
  if ((p.levels_since_death || 0) >= 5) tags.push("CLEAN");
  const gaining = allPlayers.filter((x) => (x.levels_gained || 0) > 0);
  const maxGained = gaining.reduce((m, x) => Math.max(m, x.levels_gained || 0), 0);
  const climbers = gaining.filter((x) => x.levels_gained === maxGained);
  if (maxGained >= 2 && climbers.length === 1 && p.levels_gained === maxGained) tags.push("GRINDING");
  return tags.slice(0, 2);
}

function buildCommentary(players, levelCap = 60) {
  const cap = Math.max(1, Math.min(60, Number(levelCap) || 60));
  const leveled = players.filter((p) => p.seen.level && p.level != null);
  if (!leveled.length) return `THE RACE TO ${cap} AWAITS`;
  const dying = [...players].filter((p) => p.seen.death && p.deaths >= 5).sort((a, b) => b.deaths - a.deaths);
  if (dying.length && dying[0].deaths >= 5) {
    return `${dying[0].character.toUpperCase()} HAS DIED ${dying[0].deaths} TIMES`;
  }
  const walkers = [...players]
    .filter((p) => (p.longest_corpse_run_seconds || 0) >= 180)
    .sort((a, b) => (b.longest_corpse_run_seconds || 0) - (a.longest_corpse_run_seconds || 0));
  if (walkers.length) {
    return `${walkers[0].character.toUpperCase()} SPENT ${formatDuration(walkers[0].longest_corpse_run_seconds).toUpperCase()} ON A CORPSE RUN`;
  }
  const max = Math.max(...leveled.map((p) => p.level));
  const leaders = leveled.filter((p) => p.level === max);
  if (leaders.length > 1) return `THE RACE TO ${cap} IS ON`;
  const rest = leveled.filter((p) => p.level < max).map((p) => p.level);
  const gap = rest.length ? max - Math.max(...rest) : 0;
  if (max >= cap) return `${leaders[0].character.toUpperCase()} HIT ${cap}`;
  if (gap >= 3) return `${leaders[0].character.toUpperCase()} IS ${gap} LEVELS AHEAD`;
  if (cap >= 40 && max >= 40) return `${leaders[0].character.toUpperCase()} LEADS AT ${max} — DEEP INTO THE GRIND`;
  if (max >= Math.min(20, Math.floor(cap * 0.75))) return `${leaders[0].character.toUpperCase()} LEADS AT ${max}`;
  return `THE RACE TO ${cap}`;
}

function buildObservations(players, totals, activity, levelCap = 60) {
  const cap = Math.max(1, Math.min(60, Number(levelCap) || 60));
  const obs = [];
  const leveled = players.filter((p) => p.seen.level && p.level != null);
  if (leveled.length) {
    const leader = [...leveled].sort((a, b) => b.level - a.level)[0];
    const tied = leveled.filter((p) => p.level === leader.level);
    const left = Math.max(0, cap - leader.level);
    if (tied.length === 1) {
      obs.push(
        left > 0
          ? `${leader.character} leads the race to ${cap} at ${leader.level} (${left} to go).`
          : `${leader.character} has reached ${cap}.`
      );
    } else if (tied.length > 1) {
      obs.push(`${tied.map((p) => p.character).join(" & ")} are tied at ${leader.level} in the race to ${cap}.`);
    }
  }
  const gainer = [...players]
    .filter((p) => (p.levels_gained || 0) > 0)
    .sort((a, b) => b.levels_gained - a.levels_gained)[0];
  if (gainer && gainer.levels_gained >= 2) {
    obs.push(`${gainer.character} has dinged ${gainer.levels_gained} times this weekend.`);
  }
  const fallen = [...players]
    .filter((p) => p.seen.death && p.deaths > 0)
    .sort((a, b) => b.deaths - a.deaths)[0];
  if (fallen && fallen.deaths >= 2) {
    obs.push(`${fallen.character} is on corpse run duty — ${fallen.deaths} deaths.`);
  }
  const inInst = players.filter((p) => p.in_instance && p.instance_name);
  if (inInst.length >= 2) {
    const byName = new Map();
    for (const p of inInst) {
      if (!byName.has(p.instance_name)) byName.set(p.instance_name, []);
      byName.get(p.instance_name).push(p.character);
    }
    for (const [name, chars] of byName) {
      if (chars.length >= 2) {
        obs.push(`${chars.length} levelers are in ${name}.`);
        break;
      }
    }
  } else if (totals.in_dungeon && totals.dungeon_name) {
    obs.push(`Dungeon XP run — ${totals.dungeon_name}.`);
  }
  const zoneGroups = new Map();
  for (const p of players) {
    if (!p.seen.zone || !p.zone || p.zone_kind === "INFERRED" || p.in_instance) continue;
    if (!zoneGroups.has(p.zone)) zoneGroups.set(p.zone, []);
    zoneGroups.get(p.zone).push(p.character);
  }
  for (const [zone, chars] of zoneGroups) {
    if (chars.length >= 2) {
      obs.push(`${chars.length} of the LAN are leveling in ${zone}.`);
      break;
    }
  }
  if (totals.recent_pvp) {
    obs.push("World PvP flared up while leveling.");
  }
  const recentDing = (activity || []).find((a) => a.kind === "DING");
  if (recentDing?.character && recentDing.text) {
    if (!obs.some((o) => o.includes("leads the race") && o.includes(recentDing.character))) {
      obs.push(recentDing.text.trim());
    }
  }
  const seen = new Set();
  const out = [];
  for (const line of obs) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 4) break;
  }
  return out;
}

/** Order the ding board: levels first, then race drama, then deaths, then PvP. */
function sortLevelingAwards(records) {
  const rank = (r) => {
    const k = String(r.key || "");
    if (k === "first_level_60") return 10;
    if (k === "first_level_50") return 20;
    if (k === "first_level_40") return 30;
    if (k === "first_level_30") return 40;
    if (k === "first_level_20") return 50;
    if (k === "first_level_10") return 60;
    if (k === "first_ding") return 70;
    if (k === "first_double_ding") return 75;
    if (k === "highest_level") return 80;
    if (k === "most_levels_gained") return 90;
    if (k === "biggest_lead") return 100;
    if (k === "biggest_comeback") return 110;
    if (k === "the_turtle") return 120;
    if (k === "still_standing") return 130;
    if (k === "first_night_owl") return 140;
    if (k === "first_death") return 150;
    if (k.startsWith("death_spree_")) return 155;
    if (k.startsWith("deaths_")) return 160;
    if (k === "most_deaths") return 170;
    if (k === "longest_corpse_run" || k.startsWith("corpse_run_long_")) return 172;
    if (k === "deathless_streak" || k.startsWith("deathless_")) return 173;
    if (k === "most_lead_changes") return 174;
    if (k === "most_distance") return 177;
    if (k === "most_jumps") return 176;
    if (k === "most_combat") return 175;
    if (k === "most_repairs") return 172;
    if (k === "poorest") return 173;
    if (k === "most_falls") return 171;
    if (k === "loot_epic" || k === "loot_rare") return 178;
    if (k === "most_quests") return 179;
    if (k.startsWith("drought_")) return 176;
    if (k.startsWith("together_")) return 178;
    if (k.startsWith("tie_at_") || k.startsWith("gap_one_")) return 175;
    if (k.startsWith("stuck_")) return 178;
    if (k === "first_pvp_kill") return 180;
    if (k === "pvp_kills_5") return 190;
    if (k === "pvp_kills_10") return 200;
    if (k === "pvp_kills_25") return 210;
    if (k === "most_pvp_kills") return 220;
    if (k === "most_pvp_deaths") return 230;
    if (k === "first_dungeon") return 240;
    return 300;
  };
  return [...records].sort((a, b) => rank(a) - rank(b) || String(a.title).localeCompare(String(b.title)));
}

/** Classic primary profession seats used for party coverage / open seats. */
const CLASSIC_PRIMARIES = [
  "Alchemy",
  "Blacksmithing",
  "Enchanting",
  "Engineering",
  "Herbalism",
  "Leatherworking",
  "Mining",
  "Skinning",
  "Tailoring",
];

function isClassicPrimaryName(name, kind) {
  if (String(kind || "").toLowerCase() === "primary") return true;
  const n = String(name || "").trim().toLowerCase();
  return CLASSIC_PRIMARIES.some((p) => p.toLowerCase() === n);
}

/**
 * Party professions board from PLAYER_PROFESSIONS snapshots only.
 * Observed ranks · counted skill-ups / coverage · no recipes/crafts/gathers.
 */
function buildProfessionParty(players) {
  const roster = (players || []).filter((p) => p?.character);
  const reporters = roster.filter(
    (p) => p.seen?.professions && Array.isArray(p.professions) && p.professions.length
  );

  /** @type {Map<string, object[]>} */
  const byProf = new Map();
  for (const p of reporters) {
    for (const pr of p.professions) {
      if (!pr?.name) continue;
      const key = String(pr.name);
      if (!byProf.has(key)) byProf.set(key, []);
      const rank = Number(pr.rank) || 0;
      const max = Number(pr.max_rank) || 0;
      byProf.get(key).push({
        character: p.character,
        guid: p.guid || null,
        class: p.class || null,
        rank,
        max_rank: max,
        kind: pr.kind || null,
        progress_pct: max > 0 ? Math.min(100, Math.round((rank / max) * 100)) : 0,
        remaining: max > 0 ? Math.max(0, max - rank) : null,
      });
    }
  }

  const ownedCoverage = [...byProf.entries()]
    .map(([name, owners]) => {
      const sorted = [...owners].sort(
        (a, b) => b.rank - a.rank || String(a.character).localeCompare(String(b.character))
      );
      const lead = sorted[0];
      const journey = professionJourney(lead);
      let legacy_milestone = null;
      if (journey) {
        const next = journey.milestones.find((m) => m.status === "in_progress");
        const lastVerified = [...journey.milestones].reverse().find((m) => m.status === "verified");
        legacy_milestone = {
          eligible: true,
          thresholds: LEGACY_PROF_THRESHOLDS.slice(),
          next: next
            ? { threshold: next.threshold, remaining: next.remaining, honesty: "derived" }
            : null,
          last_verified: lastVerified ? lastVerified.threshold : null,
          honesty: "observed",
        };
      } else if (isLegacyProfessionName(name) === false && name) {
        legacy_milestone = {
          eligible: false,
          note: "Gathering / secondary — not an official Legacy tradeskill challenge",
          honesty: "observed",
        };
      }
      return {
        name,
        kind: lead?.kind || null,
        owners: sorted,
        owner_count: sorted.length,
        lead_rank: lead?.rank ?? 0,
        max_rank: lead?.max_rank ?? 0,
        leader: lead || null,
        contested: sorted.length > 1,
        fragile: sorted.length === 1,
        open_seat: false,
        honesty: "observed",
        legacy_milestone,
      };
    })
    .sort(
      (a, b) =>
        Number(isClassicPrimaryName(b.name, b.kind)) - Number(isClassicPrimaryName(a.name, a.kind)) ||
        b.lead_rank - a.lead_rank ||
        String(a.name).localeCompare(String(b.name))
    );

  const ownedPrimaryNames = new Set(
    ownedCoverage
      .filter((c) => isClassicPrimaryName(c.name, c.kind))
      .map((c) => c.name.toLowerCase())
  );
  const openSeats = CLASSIC_PRIMARIES.filter((n) => !ownedPrimaryNames.has(n.toLowerCase()));
  const openCoverage = openSeats.map((name) => ({
    name,
    kind: "primary",
    owners: [],
    owner_count: 0,
    lead_rank: 0,
    max_rank: 0,
    leader: null,
    contested: false,
    fragile: false,
    open_seat: true,
    honesty: "derived",
  }));
  const coverage = [...ownedCoverage, ...openCoverage];

  const stream = [];
  for (const p of roster) {
    for (const e of p.profession_feed || []) {
      const isCraft = e.kind === "craft" || e.action === "create" || e.item_name;
      const itemName = e.item_name || e.name;
      const qty = e.quantity > 1 ? `${e.quantity}× ` : "";
      stream.push({
        ts: e.ts,
        event_id: e.event_id || null,
        character: e.character || p.character,
        guid: e.guid || p.guid || null,
        name: e.name,
        from: e.from,
        to: e.to,
        max_rank: e.max_rank,
        kind: e.kind || null,
        learned: !!e.learned,
        action: e.action || null,
        quantity: e.quantity || null,
        item_name: itemName || null,
        text: isCraft
          ? `created ${qty}${itemName}`
          : e.learned
            ? `learned ${e.name} (${e.to}/${e.max_rank || "?"})`
            : `${e.name} ${e.from} → ${e.to}`,
        honesty: isCraft ? "observed" : "derived",
      });
    }
  }
  stream.sort(
    (a, b) =>
      new Date(b.ts) - new Date(a.ts) || String(a.character).localeCompare(String(b.character))
  );

  const climb = [];
  for (const p of reporters) {
    const baseline = p.profession_baseline || {};
    for (const pr of p.professions || []) {
      if (!pr?.name) continue;
      const base = baseline[pr.name];
      const from = base != null ? Number(base) || 0 : Number(pr.rank) || 0;
      const to = Number(pr.rank) || 0;
      const gained = Math.max(0, to - from);
      if (gained <= 0) continue;
      climb.push({
        character: p.character,
        guid: p.guid || null,
        name: pr.name,
        from,
        to,
        gained,
        max_rank: Number(pr.max_rank) || 0,
        kind: pr.kind || null,
        honesty: "derived",
      });
    }
  }
  climb.sort(
    (a, b) =>
      b.gained - a.gained || b.to - a.to || String(a.character).localeCompare(String(b.character))
  );

  const playersOut = roster.map((p) => {
    const professions = (p.seen?.professions ? p.professions || [] : []).map((pr) => {
      const max = Number(pr.max_rank) || 0;
      const rank = Number(pr.rank) || 0;
      return {
        name: pr.name,
        rank,
        max_rank: max,
        kind: pr.kind || null,
        progress_pct: max > 0 ? Math.min(100, Math.round((rank / max) * 100)) : 0,
        remaining: max > 0 ? Math.max(0, max - rank) : null,
      };
    });
    return {
      character: p.character,
      guid: p.guid || null,
      class: p.class || null,
      online: !!p.online,
      professions,
      profession_count: professions.length,
      profession_skill_ups: p.profession_skill_ups || 0,
      crafts: p.crafts || 0,
      craft_distinct: Object.keys(p.craft_items || {}).length,
      total_rank: professions.reduce((a, pr) => a + (pr.rank || 0), 0),
      seen: !!p.seen?.professions,
    };
  });

  const awards = [];

  // Open seats stay on coverage tiles only — no duplicate OPEN SEAT award chip.

  for (const p of reporters) {
    const primaries = (p.professions || []).filter((pr) => isClassicPrimaryName(pr.name, pr.kind));
    if (primaries.length >= 2) {
      awards.push({
        key: "double_dip",
        title: "DOUBLE DIP",
        detail: `${p.character} · ${primaries.map((pr) => pr.name).join(" + ")}`,
        character: p.character,
        honesty: "observed",
        board_only: true,
      });
    }
  }

  // JACK OF ALL TRADES — most trained profession lines (Counted from logged snapshots).
  {
    const jack = [...reporters]
      .filter((p) => (p.professions || []).length >= 2)
      .sort(
        (a, b) =>
          (b.professions || []).length - (a.professions || []).length ||
          (b.total_rank || 0) - (a.total_rank || 0) ||
          String(a.character).localeCompare(String(b.character))
      )[0];
    if (jack && (jack.professions || []).length >= 2) {
      const names = (jack.professions || []).map((pr) => pr.name).join(", ");
      awards.push({
        key: "jack_of_all_trades",
        title: "JACK OF ALL TRADES",
        detail: `${jack.character} · ${(jack.professions || []).length} lines (${names})`,
        character: jack.character,
        honesty: "derived",
      });
    }
  }

  // THE SPECIALIST — highest single profession rank (Counted).
  {
    let best = null;
    for (const p of reporters) {
      for (const pr of p.professions || []) {
        const rank = Number(pr.rank) || 0;
        if (rank <= 0) continue;
        if (
          !best ||
          rank > best.rank ||
          (rank === best.rank && String(p.character).localeCompare(best.character) < 0)
        ) {
          best = {
            character: p.character,
            name: pr.name,
            rank,
            max_rank: Number(pr.max_rank) || 0,
          };
        }
      }
    }
    if (best) {
      awards.push({
        key: "the_specialist",
        title: "THE SPECIALIST",
        detail: `${best.character} · ${best.name} ${best.rank}${best.max_rank ? `/${best.max_rank}` : ""}`,
        character: best.character,
        honesty: "derived",
      });
    }
  }

  const learnedChrono = [...stream]
    .filter((e) => e.learned)
    .sort(
      (a, b) =>
        new Date(a.ts) - new Date(b.ts) || String(a.character).localeCompare(String(b.character))
    );
  if (learnedChrono.length) {
    const first = learnedChrono[0];
    awards.push({
      key: "first_claim",
      title: "FIRST CLAIM",
      detail: `${first.character} · ${first.name}`,
      character: first.character,
      honesty: "derived",
    });
  }

  if (climb.length) {
    const streak = climb[0];
    awards.push({
      key: "skill_streak",
      title: "SKILL STREAK",
      detail: `${streak.character} · ${streak.name} +${streak.gained} (${streak.from}→${streak.to})`,
      character: streak.character,
      honesty: "derived",
    });
  }

  if (reporters.length === 1) {
    awards.push({
      key: "one_man_industry",
      title: "ONE-MAN INDUSTRY",
      detail: `${reporters[0].character} · only reporter with professions`,
      character: reporters[0].character,
      honesty: "derived",
      shame: true,
      board_only: true,
    });
  }

  let capWatch = null;
  for (const p of reporters) {
    for (const pr of p.professions || []) {
      const max = Number(pr.max_rank) || 0;
      const rank = Number(pr.rank) || 0;
      if (max <= 0 || rank <= 0) continue;
      const remaining = Math.max(0, max - rank);
      if (remaining <= 0 || remaining > 5) continue;
      if (
        !capWatch ||
        remaining < capWatch.remaining ||
        (remaining === capWatch.remaining && rank > capWatch.rank)
      ) {
        capWatch = {
          character: p.character,
          name: pr.name,
          rank,
          max_rank: max,
          remaining,
        };
      }
    }
  }
  if (capWatch) {
    awards.push({
      key: "cap_watch",
      title: "CAP WATCH",
      detail: `${capWatch.character} · ${capWatch.name} ${capWatch.rank}/${capWatch.max_rank} (${capWatch.remaining} to cap)`,
      character: capWatch.character,
      honesty: "derived",
    });
  }

  const crafters = roster.filter((p) => (p.crafts || 0) > 0);
  if (crafters.length) {
    const factory = [...crafters].sort(
      (a, b) =>
        (b.crafts || 0) - (a.crafts || 0) || String(a.character).localeCompare(String(b.character))
    )[0];
    awards.push({
      key: "factory",
      title: "THE FACTORY",
      detail: `${factory.character} · ${factory.crafts} craft${factory.crafts === 1 ? "" : "s"}`,
      character: factory.character,
      honesty: "observed",
    });
    const craftsman = [...crafters].sort((a, b) => {
      const da = Object.keys(a.craft_items || {}).length;
      const db = Object.keys(b.craft_items || {}).length;
      return db - da || (b.crafts || 0) - (a.crafts || 0) || String(a.character).localeCompare(String(b.character));
    })[0];
    const distinct = Object.keys(craftsman.craft_items || {}).length;
    if (distinct > 0) {
      awards.push({
        key: "craftsman",
        title: "CRAFTSMAN",
        detail: `${craftsman.character} · ${distinct} distinct output${distinct === 1 ? "" : "s"}`,
        character: craftsman.character,
        honesty: "observed",
      });
    }
  }

  const claimedPrimaries = ownedCoverage.filter((c) => isClassicPrimaryName(c.name, c.kind)).length;
  const skillUps = reporters.reduce((a, p) => a + (p.profession_skill_ups || 0), 0);
  const leadLine = ownedCoverage.find((c) => isClassicPrimaryName(c.name, c.kind)) || ownedCoverage[0];
  const bits = [];
  if (reporters.length) {
    bits.push(
      `${claimedPrimaries} ${claimedPrimaries === 1 ? "profession" : "professions"} trained`
    );
    bits.push(`${openSeats.length} unrepresented`);
    if (leadLine) bits.push(`${leadLine.name} leads the party`);
  }

  return {
    title: "PROFESSIONS",
    headline: bits.length ? bits.join(" · ") : "Waiting for the first profession skill-up…",
    coverage,
    open_seats: openSeats,
    players: playersOut,
    climb: climb.slice(0, 3),
    stream: stream.slice(0, 8),
    feed: stream.slice(0, 8),
    awards,
    stats: {
      reporters: reporters.length,
      claimed_primaries: claimedPrimaries,
      open_seats: openSeats.length,
    },
    totals: {
      profession_lines: ownedCoverage.length,
      players_with_professions: reporters.length,
      skill_ups: skillUps,
      crafts: roster.reduce((a, p) => a + (p.crafts || 0), 0),
      fragile_lines: ownedCoverage.filter((c) => c.fragile).length,
      claimed_primaries: claimedPrimaries,
      open_seats: openSeats.length,
    },
    honesty: {
      ranks: "observed",
      coverage: "observed",
      open_seats: "derived",
      skill_ups: "derived",
      crafts: "observed",
      climb: "derived",
      stream: "mixed",
      awards: "mixed",
    },
  };
}


function buildAchievementRaces(players) {
  const roster = (players || []).filter((p) => p.character && p.seen?.level);
  if (!roster.length) return [];

  // Full character name on the board — first-token only confuses Alex vs Alex River.
  const short = (p) => String(p.character || "").trim();

  function race({ key, title, blurb, honesty, metricLabel, getValue, formatValue, minShow = 0 }) {
    const rows = roster
      .map((p) => {
        const value = getValue(p) || 0;
        return {
          character: p.character,
          short: short(p),
          value,
          value_text: formatValue(value),
        };
      })
      .sort((a, b) => b.value - a.value || a.short.localeCompare(b.short));
    const best = rows[0]?.value || 0;
    const standings = rows.map((r, i) => ({
      place: i + 1,
      character: r.character,
      short: r.short,
      value: r.value,
      value_text: r.value_text,
      leading: r.value > 0 && r.value === best,
      gap_to_leader: best > 0 ? Math.max(0, best - r.value) : 0,
    }));
    const hasLeader = best > 0 && best >= minShow;
    const leaderRow = hasLeader ? standings.find((s) => s.leading) || standings[0] : null;
    const contested = standings.filter((s) => s.value > 0).length;
    return {
      key,
      title,
      blurb,
      honesty,
      metric_label: metricLabel,
      open: !hasLeader,
      leader: leaderRow
        ? {
            character: leaderRow.character,
            short: leaderRow.short,
            value: leaderRow.value,
            value_text: leaderRow.value_text,
          }
        : null,
      standings,
      contested,
    };
  }

  return [
    race({
      key: "most_repairs",
      title: "YOU ARE NOT REPAIRED",
      blurb: "Most gold spent at repair merchants (Illidan would be proud).",
      honesty: "inferred",
      metricLabel: "repairs",
      getValue: (p) => p.repair_copper || 0,
      formatValue: (v) => formatGold(v),
      minShow: 100,
    }),
    race({
      key: "most_combat",
      title: "MORE DOTS!",
      blurb: "Most time spent in combat this weekend.",
      honesty: "observed",
      metricLabel: "combat",
      getValue: (p) => p.combat_seconds || 0,
      formatValue: (v) => formatDuration(v),
      minShow: 60,
    }),
    race({
      key: "most_deaths",
      title: "HOGGER'S FAVORITE",
      blurb: "Most verified deaths. Hogger is taking notes.",
      honesty: "observed",
      metricLabel: "deaths",
      getValue: (p) => p.deaths || 0,
      formatValue: (v) => String(v),
      minShow: 1,
    }),
    race({
      key: "most_falls",
      title: "THE FLOOR IS LAVA",
      blurb: "Most fall deaths (combat-log enrichment).",
      honesty: "derived",
      metricLabel: "falls",
      getValue: (p) => p.deaths_fall || 0,
      formatValue: (v) => String(v),
      minShow: 1,
    }),
    race({
      key: "longest_corpse",
      title: "CORPSE TOURIST",
      blurb: "Longest single corpse run.",
      honesty: "derived",
      metricLabel: "corpse run",
      getValue: (p) => p.longest_corpse_run_seconds || 0,
      formatValue: (v) => formatDuration(v),
      minShow: 60,
    }),
    race({
      key: "most_jumps",
      title: "BUNNY HOPPER",
      blurb: "Most jumps observed.",
      honesty: "observed",
      metricLabel: "jumps",
      getValue: (p) => p.jumps || 0,
      formatValue: (v) => String(v),
      minShow: 5,
    }),
    race({
      key: "most_distance",
      title: "LOST IN AZEROTH",
      blurb: "Most sampled path distance (UnitPosition steps). Mounted stretches can still undercount vs true yards — Logged samples only, not a GPS odometer.",
      honesty: "observed",
      metricLabel: "sampled",
      getValue: (p) => p.distance_yards || 0,
      formatValue: (v) => {
        const m = Math.round(v * 0.9144);
        return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
      },
      minShow: 100,
    }),
    race({
      key: "most_quests",
      title: "QUEST GRIND: COMPLETE",
      blurb: "Most quests completed.",
      honesty: "observed",
      metricLabel: "quests",
      getValue: (p) => p.quests_completed || 0,
      formatValue: (v) => String(v),
      minShow: 1,
    }),
    race({
      key: "loot_epic",
      title: "PURPLE RAIN",
      blurb: "Most epic loot drops.",
      honesty: "observed",
      metricLabel: "epics",
      getValue: (p) => p.loot_epic || 0,
      formatValue: (v) => String(v),
      minShow: 1,
    }),
    race({
      key: "loot_rare",
      title: "BLUE FINDER",
      blurb: "Most blue loot drops.",
      honesty: "observed",
      metricLabel: "blues",
      getValue: (p) => p.loot_rare || 0,
      formatValue: (v) => String(v),
      minShow: 1,
    }),
    race({
      key: "levels_gained",
      title: "GRIND KING",
      blurb: "Most levels gained this weekend.",
      honesty: "observed",
      metricLabel: "dings",
      getValue: (p) => p.levels_gained || 0,
      formatValue: (v) => `+${v}`,
      minShow: 1,
    }),
    race({
      key: "poorest",
      title: "BROKE AS A KOBOLD",
      blurb: "Lowest wallet among people with observed gold (shame trophy).",
      honesty: "observed",
      metricLabel: "gold",
      // Invert: lowest copper wins — score = maxCopper - copper so higher is "winning" the shame race
      getValue: (p) => {
        if (!p.seen?.money || p.copper == null) return 0;
        const maxC = Math.max(0, ...roster.filter((x) => x.seen?.money).map((x) => x.copper || 0));
        return maxC - (p.copper || 0) + 1;
      },
      formatValue: (v, p) => {
        // find matching standing character copper for display — handled below via custom
        return String(v);
      },
      minShow: 1,
    }),
  ].map((a) => {
    // Fix BROKE AS A KOBOLD display to show actual gold left
    if (a.key === "poorest") {
      const byName = new Map(roster.map((p) => [p.character, p]));
      a.standings = a.standings.map((s) => {
        const p = byName.get(s.character);
        const copper = p?.copper ?? 0;
        return {
          ...s,
          value_text: p?.seen?.money ? formatGold(copper) : "—",
          value: copper,
        };
      });
      // Re-sort ascending for poorest
      a.standings.sort((x, y) => {
        const px = byName.get(x.character);
        const py = byName.get(y.character);
        const cx = px?.seen?.money ? px.copper ?? Infinity : Infinity;
        const cy = py?.seen?.money ? py.copper ?? Infinity : Infinity;
        return cx - cy || x.short.localeCompare(y.short);
      });
      a.standings = a.standings.map((s, i) => ({
        ...s,
        place: i + 1,
        leading: i === 0 && byName.get(s.character)?.seen?.money,
      }));
      const lead = a.standings.find((s) => s.leading);
      a.leader = lead
        ? { character: lead.character, short: lead.short, value: lead.value, value_text: lead.value_text }
        : null;
    }
    return a;
  });
}

function buildWrap(state) {
  const players = state.players || [];
  const records = (state.records || []).filter((r) => r.title);
  const moments = (state.activity || [])
    .filter((a) => a.kind === "MOMENT" || a.kind === "DING" || a.kind === "DEATH" || a.kind === "PVP" || a.kind === "LOOT")
    .slice(0, 24);
  const leader = records.find((r) => r.key === "highest_level");
  const cap = Math.max(1, Math.min(60, Number(state.meta?.level_cap) || 60));
  const headline =
    state.commentary || (leader?.detail ? `RACE LEADER · ${leader.detail}` : `THE RACE TO ${cap}`);

  const dayBuckets = { FRI: [], SAT: [], SUN: [], OTHER: [] };
  for (const a of state.activity || []) {
    if (!a?.ts) continue;
    if (!(a.kind === "MOMENT" || a.kind === "DING" || a.kind === "DEATH" || a.kind === "PVP" || a.kind === "LOOT")) continue;
    const d = new Date(a.ts);
    if (!Number.isFinite(d.getTime())) continue;
    const wd = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    const bucket = wd === "FRI" || wd === "SAT" || wd === "SUN" ? wd : "OTHER";
    dayBuckets[bucket].push({
      kind: a.kind,
      text: a.text,
      ts: a.ts,
      character: a.character || null,
      item_name: a.item_name || null,
      item_id: a.item_id || null,
      item_quality: a.item_quality || null,
      wowhead_url: a.wowhead_url || null,
    });
  }
  const timeline = ["FRI", "SAT", "SUN"]
    .map((day) => ({
      day,
      moments: dayBuckets[day].slice(0, 12),
    }))
    .filter((d) => d.moments.length > 0);
  if (!timeline.length && dayBuckets.OTHER.length) {
    timeline.push({ day: "SESSION", moments: dayBuckets.OTHER.slice(0, 12) });
  }

  return {
    title: state.lan_name || "Forever Leveling",
    session_id: state.session_id,
    weekend: state.weekend,
    watching_since: state.watching_since,
    updated_at: state.updated_at,
    headline,
    rivalry: state.rivalry || null,
    awards: records,
    hall: curateWrapHall(state.hall || [], 16),
    trajectory: state.trajectory || null,
    race: players
      .filter((p) => p.level != null)
      .map((p, i) => ({
        place: i + 1,
        character: p.character,
        class: p.class || null,
        level: p.level,
        levels_gained: p.levels_gained || 0,
        deaths: p.deaths || 0,
        distance_yards: p.distance_yards || 0,
        distance_m: p.distance_m || Math.round((p.distance_yards || 0) * 0.9144) || 0,
        jumps: p.jumps || 0,
        longest_corpse_run_seconds: p.longest_corpse_run_seconds || 0,
        corpse_run_seconds: p.corpse_run_seconds || 0,
        levels_since_death: p.levels_since_death || 0,
        best_levels_since_death: p.best_levels_since_death || 0,
        pvp_kills: p.pvp_kills || 0,
        zone: p.zone || null,
        tags: p.tags || [],
        to_60: Math.max(0, (Number(state.meta?.level_cap) || 60) - p.level),
        to_cap: Math.max(0, (Number(state.meta?.level_cap) || 60) - p.level),
      })),
    moments,
    timeline,
    totals: {
      players: state.totals.player_count,
      levels_gained: state.totals.total_levels_gained,
      deaths: state.totals.total_deaths,
      corpse_run_seconds: state.totals.total_corpse_run_seconds || 0,
      pvp_kills: state.totals.total_pvp_kills,
      distance_yards: state.totals.total_distance_yards || 0,
      distance_m: Math.round((state.totals.total_distance_yards || 0) * 0.9144),
      jumps: state.totals.total_jumps || 0,
      highest_level: state.totals.highest_level,
      average_level: state.totals.average_level,
      zones: state.totals.zones || [],
    },
  };
}

/**
 * Finalize death_log rows with order, gap, spree, narrative — same fold as Live counts.
 */
function enrichDeathLog(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id).localeCompare(String(b.id)));
  const byChar = new Map();
  for (const row of list) {
    const key = row.guid || row.character || "?";
    if (!byChar.has(key)) byChar.set(key, []);
    byChar.get(key).push(row);
  }
  const out = [];
  for (const deaths of byChar.values()) {
    deaths.forEach((ev, i) => {
      const prev = i > 0 ? deaths[i - 1] : null;
      const gap = prev?.ts != null && ev.ts != null ? ev.ts - prev.ts : null;
      const windowStart = (ev.ts || 0) - 20 * 60;
      const spree = deaths.filter((d) => d.ts <= ev.ts && d.ts >= windowStart).length;
      const parts = [`${ev.character} died`];
      if (ev.level) parts.push(`at level ${ev.level}`);
      if (ev.zone) parts.push(`in ${ev.zone}`);
      if (ev.death_summary) {
        parts[0] = `${ev.character} ${ev.death_summary}`;
      } else if (ev.killer_name) {
        parts.push(`to ${ev.killer_name}`);
      } else if (ev.environmental_type) {
        parts.push(`(${String(ev.environmental_type).toLowerCase()})`);
      }
      if (gap != null) parts.push(`${formatDuration(gap)} after the previous death`);
      if (spree >= 3) parts.push(`a ${spree}-death streak within 20 minutes`);
      out.push({
        ...ev,
        n: i + 1,
        seconds_since_previous: gap,
        spree_20m: spree,
        narrative: parts.join(" ") + ".",
      });
    });
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/** Unix seconds from ev.ts (tolerates ms and numeric strings); 0 when unusable. */
function unixSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n / 1000 : n;
}

/** Replay order: original event time, then id — independent of arrival order. */
function chronological(events) {
  const list = [...(events || [])].filter((e) => e && e.id && e.type);
  list.sort((a, b) => unixSeconds(a.ts) - unixSeconds(b.ts) || String(a.id).localeCompare(String(b.id)));
  return list;
}

function isoFromTs(ts) {
  if (ts == null) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  // Forever/WoW time() is unix seconds
  const ms = n > 1e12 ? n : n * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/** Human clock for corpse-run / duration stats. */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Convert WoW UnitPosition yards → metric for NL / EU display. */
function formatDistance(yards) {
  const m = Math.max(0, Number(yards) || 0) * 0.9144;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatYards(yards) {
  return formatDistance(yards);
}

function formatGold(copper) {
  const c = Math.max(0, Math.round(Number(copper) || 0));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const r = c % 100;
  if (g > 0) return `${g}g ${s}s`;
  if (s > 0) return `${s}s ${r}c`;
  return `${r}c`;
}

/**
 * Level-over-time series plus weekend trophies.
 * Markers: biggest lead, biggest comeback, fastest climb, lead changes.
 */
function buildRaceIntel(players, records, opts = {}) {
  const nowIso = opts.now || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const roster = (players || []).filter((p) => p.character && p.seen?.level);
  const events = [];
  for (const p of roster) {
    const hist = monotonicLevelHistory(p.level_history);
    // Seed start if history only captured mid-climb dings.
    if (
      hist.length &&
      p.start_level > 0 &&
      hist[0].level > p.start_level &&
      p.first_seen_at
    ) {
      const firstDingMs = new Date(hist[0].ts).getTime();
      const seedMs = new Date(p.first_seen_at).getTime();
      // Never place the seed after the first ding (that draws the line left).
      const ts =
        Number.isFinite(seedMs) && Number.isFinite(firstDingMs) && seedMs <= firstDingMs
          ? p.first_seen_at
          : Number.isFinite(firstDingMs)
            ? new Date(firstDingMs - 1000).toISOString()
            : p.first_seen_at;
      hist.unshift({
        ts,
        level: p.start_level,
        zone: null,
      });
    }
    if (!hist.length && p.level > 0) {
      const startTs = p.first_seen_at || p.last_seen_at || nowIso;
      const startLvl = p.start_level > 0 ? p.start_level : p.level;
      hist.push({ ts: startTs, level: startLvl, zone: null });
      if (p.level !== startLvl && (p.last_ding_at || p.last_seen_at)) {
        hist.push({
          ts: p.last_ding_at || p.last_seen_at || nowIso,
          level: p.level,
          zone: p.zone || null,
        });
      }
    }
    for (const h of hist) {
      if (!h?.ts || h.level == null) continue;
      events.push({
        ts: h.ts,
        level: h.level,
        zone: h.zone || null,
        character: p.character,
        class: p.class || null,
      });
    }
  }
  events.sort((a, b) => new Date(a.ts) - new Date(b.ts) || a.level - b.level);

  const seriesMap = new Map();
  for (const ev of events) {
    if (!seriesMap.has(ev.character)) {
      seriesMap.set(ev.character, {
        character: ev.character,
        class: ev.class,
        points: [],
      });
    }
    const s = seriesMap.get(ev.character);
    const prev = s.points[s.points.length - 1];
    if (prev && prev.level === ev.level && prev.ts === ev.ts) continue;
    if (prev && ev.level < prev.level) continue;
    if (prev && new Date(ev.ts).getTime() < new Date(prev.ts).getTime()) continue;
    s.points.push({ ts: ev.ts, level: ev.level, zone: ev.zone });
  }

  // Hold each line to "now" so the chart spans the full race window.
  for (const p of roster) {
    let s = seriesMap.get(p.character);
    if (!s) {
      if (!(p.level > 0)) continue;
      s = { character: p.character, class: p.class || null, points: [] };
      seriesMap.set(p.character, s);
      const startTs = p.first_seen_at || nowIso;
      const startLvl = p.start_level > 0 ? p.start_level : p.level;
      s.points.push({ ts: startTs, level: startLvl, zone: null });
    }
    const last = s.points[s.points.length - 1];
    if (!last) continue;
    let tipLevel = last.level;
    if (p.level > tipLevel) {
      const rawCatch = p.last_ding_at || p.last_seen_at || nowIso;
      const catchMs = new Date(rawCatch).getTime();
      const lastMs = new Date(last.ts).getTime();
      const catchTs =
        Number.isFinite(catchMs) && Number.isFinite(lastMs) && catchMs >= lastMs
          ? rawCatch
          : nowIso;
      if (catchTs !== last.ts || p.level !== last.level) {
        s.points.push({ ts: catchTs, level: p.level, zone: p.zone || null });
        tipLevel = p.level;
      }
    }
    const tip = s.points[s.points.length - 1];
    if (tip && new Date(tip.ts).getTime() < nowMs - 1000) {
      s.points.push({ ts: nowIso, level: tip.level, zone: tip.zone || null });
    }
  }

  // Final sanitize — chron order, no leftward / level-drop segments.
  for (const s of seriesMap.values()) {
    s.points = sanitizeTrajectoryPoints(s.points);
  }

  const markers = [];
  const levels = new Map();
  let soleLeader = null;
  let bestGap = null;
  let bestComeback = null;
  const worstGap = new Map();

  for (const ev of events) {
    const prevLevel = levels.has(ev.character) ? levels.get(ev.character) : null;
    const others = [...levels.entries()].filter(([name]) => name !== ev.character);
    const othersMax = others.reduce((m, [, lvl]) => Math.max(m, lvl), 0);
    const gapBefore =
      prevLevel != null && othersMax > 0 ? Math.max(0, othersMax - prevLevel) : 0;

    levels.set(ev.character, ev.level);
    const ranked = [...levels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked[0]?.[1] ?? 0;
    const leaders = ranked.filter(([, lvl]) => lvl === top);
    const second = ranked.find(([, lvl]) => lvl < top);
    const gap = second ? top - second[1] : 0;

    if (leaders.length === 1) {
      const name = leaders[0][0];
      if (soleLeader && name !== soleLeader) {
        markers.push({
          ts: ev.ts,
          level: ev.level,
          character: name,
          kind: "lead_change",
          label: `${name} takes the lead`,
        });
      }
      soleLeader = name;
      if (gap >= 2 && (!bestGap || gap > bestGap.gap)) {
        bestGap = {
          gap,
          ts: ev.ts,
          level: top,
          character: name,
          vs: second?.[0] || null,
        };
      }
    }

    const gapAfter = Math.max(0, top - ev.level);
    const worst = Math.max(worstGap.get(ev.character) || 0, gapBefore);
    const recovered = worst - gapAfter;
    if (recovered >= 2 && (!bestComeback || recovered > bestComeback.recovered)) {
      bestComeback = {
        recovered,
        ts: ev.ts,
        level: ev.level,
        character: ev.character,
        zone: ev.zone,
      };
    }
    worstGap.set(ev.character, Math.max(worst, gapAfter));
  }

  if (bestGap) {
    markers.push({
      ts: bestGap.ts,
      level: bestGap.level,
      character: bestGap.character,
      kind: "biggest_lead",
      label: `Biggest lead — ${bestGap.character} by ${bestGap.gap}`,
    });
  }
  if (bestComeback) {
    markers.push({
      ts: bestComeback.ts,
      level: bestComeback.level,
      character: bestComeback.character,
      kind: "comeback",
      label: `Comeback — ${bestComeback.character} recovered ${bestComeback.recovered}`,
    });
  }

  let fastest = null;
  for (const s of seriesMap.values()) {
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const gained = pts[j].level - pts[i].level;
        if (gained < 2) continue;
        const secs = (new Date(pts[j].ts) - new Date(pts[i].ts)) / 1000;
        if (!Number.isFinite(secs) || secs < 60) continue;
        // Ignore the synthetic "hold to now" flat segment for sprint scoring.
        if (pts[j].level === pts[i].level) continue;
        const per = secs / gained;
        if (!fastest || per < fastest.per) {
          fastest = {
            per,
            secs,
            gained,
            ts: pts[j].ts,
            level: pts[j].level,
            zone: pts[j].zone,
            character: s.character,
            from: pts[i].level,
            to: pts[j].level,
          };
        }
      }
    }
  }
  if (fastest) {
    markers.push({
      ts: fastest.ts,
      level: fastest.level,
      character: fastest.character,
      kind: "sprint",
      label: `Fastest climb — ${fastest.character} +${fastest.gained} in ${formatDuration(fastest.secs)}`,
    });
  }

  // Everyone starts at 1 — first-to-level only counts real dings (2+).
  const firstByLevel = new Map();
  for (const ev of events) {
    const lvl = Number(ev.level);
    if (!Number.isFinite(lvl) || lvl <= 1) continue;
    if (!firstByLevel.has(lvl)) firstByLevel.set(lvl, ev);
  }
  const firstLevels = [...firstByLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, ev]) => ({
      level,
      character: ev.character,
      ts: ev.ts,
    }));

  const hall = [];
  const push = (item) => {
    if (!item?.title || !item?.detail) return;
    hall.push(item);
  };

  if (bestGap && bestGap.gap >= 2) {
    push({
      title: "FOR THE GLORY OF THE RACE",
      detail: `${bestGap.character} · ${bestGap.gap} ahead${bestGap.vs ? ` of ${bestGap.vs}` : ""}`,
      character: bestGap.character,
      shame: false,
    });
  }
  if (bestComeback) {
    push({
      title: "SECOND WIND",
      detail: `${bestComeback.character} · clawed back ${bestComeback.recovered}`,
      character: bestComeback.character,
      shame: false,
    });
  }
  if (fastest) {
    push({
      title: "LEEROY JENKINS!",
      detail: `${fastest.character} · ${fastest.from}→${fastest.to} in ${formatDuration(fastest.secs)}`,
      character: fastest.character,
      shame: false,
    });
  }

  const byCorpse = [...roster].sort(
    (a, b) => (b.longest_corpse_run_seconds || 0) - (a.longest_corpse_run_seconds || 0)
  )[0];
  if (byCorpse && (byCorpse.longest_corpse_run_seconds || 0) >= 60) {
    push({
      title: "CORPSE TOURIST",
      detail: `${byCorpse.character} · ${formatDuration(byCorpse.longest_corpse_run_seconds)}`,
      character: byCorpse.character,
      shame: true,
    });
  }

  let deathBurst = null;
  for (const p of roster) {
    const times = (p.death_times || [])
      .map((t) => new Date(t).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (let i = 0; i < times.length; i++) {
      let j = i;
      while (j < times.length && times[j] - times[i] <= 10 * 60 * 1000) j++;
      const n = j - i;
      if (n >= 3 && (!deathBurst || n > deathBurst.n)) {
        deathBurst = { n, character: p.character };
      }
    }
  }
  if (deathBurst) {
    push({
      title: "MANY WHELPS! HANDLE IT!",
      detail: `${deathBurst.character} · ${deathBurst.n} deaths in 10 minutes`,
      character: deathBurst.character,
      shame: true,
    });
  }

  const byZones = [...roster].sort((a, b) => (b.zones_seen?.length || 0) - (a.zones_seen?.length || 0))[0];
  if (byZones && (byZones.zones_seen?.length || 0) >= 3) {
    push({
      title: "WHO NEEDS A MAP?",
      detail: `${byZones.character} · ${byZones.zones_seen.length} zones`,
      character: byZones.character,
      shame: false,
    });
  }

  const byOffline = [...roster].sort(
    (a, b) => (b.longest_offline_seconds || 0) - (a.longest_offline_seconds || 0)
  )[0];
  if (byOffline && (byOffline.longest_offline_seconds || 0) >= 15 * 60) {
    push({
      title: "MISSING IN ACTION",
      detail: `${byOffline.character} · ${formatDuration(byOffline.longest_offline_seconds)} offline`,
      character: byOffline.character,
      shame: true,
    });
  }

  const byCombat = [...roster]
    .filter((p) => (p.combat_seconds || 0) >= 120)
    .sort((a, b) => (b.combat_seconds || 0) - (a.combat_seconds || 0))[0];
  if (byCombat) {
    push({
      title: "MORE DOTS!",
      detail: `${byCombat.character} · ${formatDuration(byCombat.combat_seconds)} in combat`,
      character: byCombat.character,
      shame: true,
    });
  }

  const byRepair = [...roster]
    .filter((p) => (p.repair_copper || 0) >= 100)
    .sort((a, b) => (b.repair_copper || 0) - (a.repair_copper || 0))[0];
  if (byRepair) {
    push({
      title: "YOU ARE NOT REPAIRED",
      detail: `${byRepair.character} · ~${formatGold(byRepair.repair_copper)} while at a repair vendor`,
      character: byRepair.character,
      shame: true,
      honesty: "inferred",
    });
  }

  const byPoor = [...roster]
    .filter((p) => p.seen?.money && p.copper != null)
    .sort((a, b) => (a.copper || 0) - (b.copper || 0))[0];
  if (byPoor && roster.filter((p) => p.seen?.money).length >= 2) {
    push({
      title: "BROKE AS A KOBOLD",
      detail: `${byPoor.character} · ${formatGold(byPoor.copper)} left`,
      character: byPoor.character,
      shame: true,
    });
  }

  const byFalls = [...roster]
    .filter((p) => (p.deaths_fall || 0) >= 2)
    .sort((a, b) => (b.deaths_fall || 0) - (a.deaths_fall || 0))[0];
  if (byFalls) {
    push({
      title: "THE FLOOR IS LAVA",
      detail: `${byFalls.character} · ${byFalls.deaths_fall} fall deaths`,
      character: byFalls.character,
      shame: true,
    });
  }

  const byEpic = [...roster]
    .filter((p) => (p.loot_epic || 0) >= 1)
    .sort((a, b) => (b.loot_epic || 0) - (a.loot_epic || 0))[0];
  if (byEpic) {
    push({
      title: "PURPLE RAIN",
      detail: `${byEpic.character} · ${byEpic.loot_epic} epic${(byEpic.loot_rare || 0) ? ` · ${byEpic.loot_rare} blue` : ""}`,
      character: byEpic.character,
      shame: false,
    });
  } else {
    const byRare = [...roster]
      .filter((p) => (p.loot_rare || 0) >= 1)
      .sort((a, b) => (b.loot_rare || 0) - (a.loot_rare || 0))[0];
    if (byRare) {
      push({
        title: "BLUE FINDER",
        detail: `${byRare.character} · ${byRare.loot_rare} blue loot`,
        character: byRare.character,
        shame: false,
      });
    }
  }

  if (firstLevels.length) {
    push({
      title: "FIRST TO EACH LEVEL",
      detail: "Who reached it first",
      character: firstLevels[firstLevels.length - 1]?.character || null,
      shame: false,
      levels: firstLevels,
    });
  }

  const tooSoon = findTooSoon(roster);
  if (tooSoon) {
    push({
      title: "TOO SOON!",
      detail: `${tooSoon.character} · ${formatDuration(tooSoon.seconds)} from ding → death`,
      character: tooSoon.character,
      shame: true,
      honesty: "derived",
    });
  }

  const wipe = findOnyxiaWipe(roster, 3, 90 * 1000);
  if (wipe) {
    push({
      title: "ONYXIA WIPE",
      detail: `${wipe.characters.length} players down within ${wipe.windowSeconds}s · ${wipe.characters.join(", ")}`,
      character: wipe.characters[0] || null,
      shame: true,
      honesty: "derived",
    });
  }

  for (const r of records || []) {
    if (!r?.title) continue;
    if (
      /^FIRST TO \d+$/.test(r.title) ||
      r.title === "DING! GRATS!" ||
      r.title === "DING! DING! DING!" ||
      r.title === "HOGGER'S FAVORITE" ||
      r.title === "STILL STANDING" ||
      r.title === "THE TURTLE" ||
      r.title === "HOT POTATO" ||
      r.title === "ALWAYS FIGHTING" ||
      r.title === "MORE DOTS!" ||
      r.title === "YOU ARE NOT REPAIRED" ||
      r.title === "BROKE AS A KOBOLD" ||
      r.title === "MANY WHELPS! HANDLE IT!" ||
      r.title === "QUEST GRIND: COMPLETE" ||
      r.title === "TEN-MINUTE DISASTER" ||
      r.title === "THE FLOOR IS LAVA" ||
      r.title === "PURPLE RAIN" ||
      r.title === "BLUE FINDER" ||
      r.title === "BUNNY HOPPER" ||
      r.title === "LOST IN AZEROTH" ||
      r.title === "FOR THE GLORY OF THE RACE" ||
      r.title === "SECOND WIND" ||
      r.title === "LEEROY JENKINS!" ||
      r.title === "CORPSE TOURIST" ||
      // Legacy titles if any stale records remain mid-session
      r.title === "FIRST DING" ||
      r.title === "DOUBLE DING" ||
      r.title === "DEATH MAGNET" ||
      r.title === "NEEDS MORE GOLD" ||
      r.title === "LEEROY JENKINS" ||
      r.title === "WORK COMPLETE" ||
      r.title === "GRAVITY'S FAVORITE" ||
      r.title === "JUMP HAPPY" ||
      r.title === "WANDERER"
    ) {
      const titleMap = {
        "FIRST DING": "DING! GRATS!",
        "DOUBLE DING": "DING! DING! DING!",
        "DEATH MAGNET": "HOGGER'S FAVORITE",
        "NEEDS MORE GOLD": "BROKE AS A KOBOLD",
        "LEEROY JENKINS": "MANY WHELPS! HANDLE IT!",
        "WORK COMPLETE": "QUEST GRIND: COMPLETE",
        "GRAVITY'S FAVORITE": "THE FLOOR IS LAVA",
        "JUMP HAPPY": "BUNNY HOPPER",
        "WANDERER": "LOST IN AZEROTH",
        "BIGGEST GAP": "FOR THE GLORY OF THE RACE",
        "COMEBACK": "SECOND WIND",
        "SPEEDRUN": "LEEROY JENKINS!",
      };
      const title = titleMap[r.title] || r.title;
      push({
        title,
        detail: r.detail || r.label,
        character: r.character || null,
        shame:
          title === "HOGGER'S FAVORITE" ||
          title === "THE TURTLE" ||
          title === "ALWAYS FIGHTING" ||
          title === "MORE DOTS!" ||
          title === "YOU ARE NOT REPAIRED" ||
          title === "BROKE AS A KOBOLD" ||
          title === "MANY WHELPS! HANDLE IT!" ||
          title === "THE FLOOR IS LAVA" ||
          r.shame === true,
        honesty: r.honesty || undefined,
      });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const item of hall) {
    const key = `${item.title}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(decorateAward(item));
  }

  let minPoint = Infinity;
  let maxPoint = -Infinity;
  for (const s of seriesMap.values()) {
    for (const pt of s.points) {
      const t = new Date(pt.ts).getTime();
      if (!Number.isFinite(t)) continue;
      minPoint = Math.min(minPoint, t);
      maxPoint = Math.max(maxPoint, t);
    }
  }

  // Prefer the LAN calendar day (config weekend, else session id lan-YYYY-MM-DD).
  const sessionDay =
    opts.weekendStart ||
    (String(opts.sessionId || "").match(/lan-(\d{4}-\d{2}-\d{2})/) || [])[1] ||
    null;
  let configuredWeekendMs = null;
  if (sessionDay) {
    const wk = new Date(`${sessionDay}T00:00:00`).getTime();
    if (Number.isFinite(wk)) configuredWeekendMs = wk;
  }
  let watchMs = null;
  if (opts.watchingSince) {
    const w = new Date(opts.watchingSince).getTime();
    if (Number.isFinite(w)) watchMs = w;
  }

  // Clip to the weekend start only once that day has arrived. Before then (beta /
  // pre-LAN), keep the full observed climb — clipping to a future Friday collapses
  // every series onto one seed and inverts domain.from > domain.to.
  const raceHasStarted =
    Number.isFinite(configuredWeekendMs) && configuredWeekendMs <= nowMs;
  const raceStartMs = raceHasStarted
    ? configuredWeekendMs
    : !Number.isFinite(configuredWeekendMs) && Number.isFinite(watchMs)
      ? watchMs
      : null;

  if (Number.isFinite(raceStartMs) && raceStartMs <= nowMs) {
    for (const s of seriesMap.values()) {
      const before = [];
      const after = [];
      for (const pt of s.points) {
        const t = new Date(pt.ts).getTime();
        if (!Number.isFinite(t)) continue;
        if (t < raceStartMs) before.push(pt);
        else after.push(pt);
      }
      const seed = before.length ? before[before.length - 1] : null;
      const clipped = [];
      if (seed) {
        clipped.push({
          ts: new Date(raceStartMs).toISOString(),
          level: seed.level,
          zone: seed.zone || null,
        });
      }
      for (const pt of after) clipped.push(pt);
      s.points = sanitizeTrajectoryPoints(clipped);
    }
    minPoint = Infinity;
    maxPoint = -Infinity;
    for (const s of seriesMap.values()) {
      for (const pt of s.points) {
        const t = new Date(pt.ts).getTime();
        if (!Number.isFinite(t)) continue;
        minPoint = Math.min(minPoint, t);
        maxPoint = Math.max(maxPoint, t);
      }
    }
  }

  let domainFrom = Number.isFinite(minPoint) ? new Date(minPoint).toISOString() : null;
  if (Number.isFinite(raceStartMs) && raceStartMs <= nowMs && Number.isFinite(minPoint)) {
    domainFrom = new Date(Math.min(raceStartMs, minPoint)).toISOString();
  }
  let domainTo = nowIso;
  // Never ship an inverted window (future race start vs wall-clock now).
  if (domainFrom) {
    const fromMs = new Date(domainFrom).getTime();
    const toMs = new Date(domainTo).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs > toMs) {
      domainFrom = Number.isFinite(minPoint) ? new Date(minPoint).toISOString() : domainTo;
      if (new Date(domainFrom).getTime() > toMs) {
        domainFrom = domainTo;
        if (Number.isFinite(maxPoint) && maxPoint >= toMs) {
          domainTo = new Date(maxPoint).toISOString();
        }
      }
    }
  }

  return {
    trajectory: {
      series: [...seriesMap.values()],
      markers,
      domain: {
        from: domainFrom,
        to: domainTo,
      },
    },
    hall: unique.slice(0, 18),
  };
}

/**
 * Chron-ordered, non-decreasing level samples. Drops anything that would draw left.
 */
function sanitizeTrajectoryPoints(raw) {
  const sorted = [...(raw || [])]
    .filter((p) => p?.ts && p.level > 0 && Number.isFinite(new Date(p.ts).getTime()))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts) || a.level - b.level);
  const out = [];
  for (const p of sorted) {
    const t = new Date(p.ts).getTime();
    const last = out[out.length - 1];
    if (last) {
      const lastT = new Date(last.ts).getTime();
      if (t < lastT) continue;
      if (p.level < last.level) continue;
      if (p.level === last.level) {
        last.ts = p.ts;
        if (p.zone) last.zone = p.zone;
        continue;
      }
    }
    out.push({ ts: p.ts, level: p.level, zone: p.zone || null });
  }
  return out;
}

/** Keep only non-decreasing level samples (drops are party-scan noise). */
function monotonicLevelHistory(raw) {
  const sorted = [...(raw || [])]
    .filter((h) => h?.ts && h.level > 0)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts) || a.level - b.level);
  const out = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && h.level < last.level) continue;
    if (last && h.level === last.level) continue;
    out.push({ ts: h.ts, level: h.level, zone: h.zone || null });
  }
  return out;
}

