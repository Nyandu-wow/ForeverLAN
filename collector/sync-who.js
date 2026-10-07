/** Who a WoW client is allowed to sync to the host. */

import {
  DEFAULT_LAN_ROSTER,
  DEFAULT_LAN_ROSTER_ALIASES,
  DEFAULT_BOARD_EXCLUDE,
} from "./lan-roster.js";
import { fullNameKey, resolveRosterKey, aliasMapFrom } from "../host/character-id.js";

export { DEFAULT_LAN_ROSTER, DEFAULT_LAN_ROSTER_ALIASES, DEFAULT_BOARD_EXCLUDE };

/** Combat lines held until the addon reports whose GUID they are. */
const PENDING_CAP = 300;

/**
 * Sync the characters this client plays, plus remembered LAN characters
 * when they show up in that client's party.
 * Combat-log names carry no surname ("Alex-ClassicBetaPvP-"), so combat lines
 * match through GUIDs the addon reported. A combat line for a GUID not yet known
 * (new character before its first SavedVariables write) waits in `pending` and is
 * released by `takeReleased()` once that GUID shows up.
 *
 * @param {string[]} [rosterNames]
 * @param {Record<string, string>|Map<string, string>} [aliases]
 * @param {{ boardExclude?: string[] }} [opts]
 */
export function createSyncWho(
  rosterNames = DEFAULT_LAN_ROSTER,
  aliases = DEFAULT_LAN_ROSTER_ALIASES,
  opts = {}
) {
  const known = new Set((rosterNames || []).map(fullNameKey).filter(Boolean));
  const aliasMap = aliasMapFrom(aliases);
  const exclude = new Set(
    (opts.boardExclude || DEFAULT_BOARD_EXCLUDE || []).map(fullNameKey).filter(Boolean)
  );
  let playingName = "";
  /** Highest addon `ev.ts` that last set `playingName` (stale SV exports must not win). */
  let playingTs = 0;
  /** GUIDs of characters played on this client (one at a time, any of them). */
  const selfGuids = new Set();
  const selfNames = new Set();
  /** GUIDs of roster party members seen by this client. */
  const knownGuids = new Set();
  /** @type {Map<string, string>} guid → Forever display name (prefer First Last). */
  const displayByGuid = new Map();
  /** @type {{ guid: string, ev: object }[]} */
  let pending = [];
  /** @type {object[]} */
  let released = [];

  function isExcluded(name) {
    const key = fullNameKey(name);
    return !!key && exclude.has(key);
  }

  function guidKnown(guid) {
    return !!guid && (selfGuids.has(guid) || knownGuids.has(guid));
  }

  function rememberDisplay(guid, character) {
    if (!guid || !character) return;
    const name = String(character).split("-")[0].trim();
    if (!name) return;
    const prev = displayByGuid.get(guid);
    // Prefer a surnamed Forever name over a bare combat-log first token.
    if (!prev || (name.includes(" ") && !prev.includes(" "))) {
      displayByGuid.set(guid, name);
    }
  }

  function withDisplayName(ev, guid) {
    if (!ev || !guid) return ev;
    const display = displayByGuid.get(guid);
    if (!display || display === ev.character) return ev;
    return { ...ev, character: display, character_combat: ev.character || null };
  }

  function learnGuid(guid, set) {
    if (!guid || set.has(guid)) return;
    set.add(guid);
    if (!pending.length) return;
    const keep = [];
    for (const item of pending) {
      if (item.guid === guid) released.push(withDisplayName(item.ev, guid));
      else keep.push(item);
    }
    pending = keep;
  }

  function onRosterName(name) {
    return !!resolveRosterKey(name, known, aliasMap);
  }

  /** Canonical Forever display name when an alias/roster hit applies. */
  function canonName(name) {
    const resolved = resolveRosterKey(name, known, aliasMap);
    if (!resolved) return name;
    if (aliasMap.has(fullNameKey(name))) return aliasMap.get(fullNameKey(name));
    for (const n of rosterNames || []) {
      if (fullNameKey(n) === resolved) return String(n).split("-")[0].trim();
    }
    return name;
  }

  /** Learn identities from an addon event without deciding whether to send it. */
  function observe(ev) {
    if (!ev?.type) return;
    if (ev.is_self && ev.character) {
      if (isExcluded(ev.character)) {
        // Bank / board-exclude: never become "playing=" and never unlock combat GUID.
        return;
      }
      const key = fullNameKey(ev.character);
      if (key) {
        selfNames.add(key);
        // Prefer the newest self telemetry. Boot-time SV scans can hit bank alts
        // after the active character and wrongly label combat-log "playing=".
        const ts = Number(ev.ts) || 0;
        if (ts >= playingTs) {
          playingTs = ts;
          playingName = String(ev.character).split("-")[0].trim();
        }
      }
      rememberDisplay(ev.guid, ev.character);
      learnGuid(ev.guid, selfGuids);
    } else if (ev.guid && ev.character && onRosterName(ev.character)) {
      rememberDisplay(ev.guid, ev.character);
      learnGuid(ev.guid, knownGuids);
    }
    if (ev.type === "PARTY_ROSTER" && Array.isArray(ev.members)) {
      for (const m of ev.members) {
        if (!m?.guid) continue;
        if (m.is_self) {
          if (isExcluded(m.character)) continue;
          rememberDisplay(m.guid, m.character);
          learnGuid(m.guid, selfGuids);
        } else if (onRosterName(m.character)) {
          rememberDisplay(m.guid, m.character);
          learnGuid(m.guid, knownGuids);
        }
      }
    }
  }

  function shouldSyncCharacter(name, isSelf, guid) {
    if (isExcluded(name)) return false;
    if (isSelf) return true;
    if (guidKnown(guid)) return true;
    const key = fullNameKey(name);
    if (!key) return false;
    // A GUID that is not ours is a different character, even with the same name.
    if (selfNames.has(key) && !guid) return true;
    return onRosterName(name);
  }

  function holdCombat(ev, guid) {
    if (!String(guid || "").startsWith("Player-")) return null;
    pending.push({ guid, ev });
    if (pending.length > PENDING_CAP) pending = pending.slice(-PENDING_CAP);
    return null;
  }

  function withCanon(ev) {
    if (!ev?.character || ev.is_self) return ev;
    const next = canonName(ev.character);
    if (next === ev.character) return ev;
    return { ...ev, character: next };
  }

  function filterEvent(ev) {
    if (!ev?.type) return null;
    const combat =
      ev.source === "combatlog" ||
      String(ev.type).startsWith("COMBAT_") ||
      ev.type === "PARTY_KILL";
    if (!combat) {
      if (ev.is_self && isExcluded(ev.character)) return null;
      observe(ev);
    }

    if (ev.type === "PARTY_ROSTER" && Array.isArray(ev.members)) {
      const members = ev.members
        .filter((m) => m && shouldSyncCharacter(m.character, !!m.is_self, m.guid))
        .map((m) => (m.is_self ? m : { ...m, character: canonName(m.character) }));
      if (!members.length) return null;
      return { ...ev, members, sync_playing: playingName || null };
    }

    if (combat) {
      if (ev.type === "COMBAT_PLAYER_DEATH") {
        if (!guidKnown(ev.dest_guid)) return holdCombat(ev, ev.dest_guid);
        return withDisplayName(ev, ev.dest_guid);
      }
      if (ev.type === "PARTY_KILL") {
        if (!guidKnown(ev.source_guid)) return holdCombat(ev, ev.source_guid);
        return withDisplayName(ev, ev.source_guid);
      }
      if (
        ev.type === "COMBAT_ZONE" ||
        ev.type === "COMBAT_LOG_VERSION" ||
        ev.type === "ENCOUNTER_START" ||
        ev.type === "ENCOUNTER_END"
      ) {
        if (!playingName) return null;
        return { ...ev, character: playingName, is_self: true, observer: playingName };
      }
      return null;
    }

    if (shouldSyncCharacter(ev.character, !!ev.is_self, ev.guid)) return withCanon(ev);
    if (!ev.character && ev.is_self) return ev;
    return null;
  }

  /** Combat lines whose GUID became known since the last call. */
  function takeReleased() {
    const out = released;
    released = [];
    return out;
  }

  return {
    filterEvent,
    observe,
    takeReleased,
    playingName: () => playingName,
    isExcluded,
  };
}
