/**
 * Shared normalized event builders for Forever LAN.
 * Real addon/collector and the dev simulator MUST emit this shape.
 *
 * Common fields on every event:
 *   v, id, ts, type, source
 * Character-bearing events also use:
 *   character, realm, class, race, level, guid, unit, is_self, ...
 */

import crypto from "node:crypto";

export const EVENT_TYPES = [
  "LOGIN",
  "LOGOUT",
  "WORLD_ENTER",
  "PING",
  "PLAYER_DETECTED",
  "PARTY_ROSTER",
  "PLAYER_LEVEL_CHANGED",
  "PLAYER_DIED",
  "PLAYER_ZONE_CHANGED",
  "PLAYER_ENTERED_INSTANCE",
  "PLAYER_LEFT_INSTANCE",
  "PLAYER_ONLINE",
  "PLAYER_OFFLINE",
  "PLAYER_PVP_KILL",
  "PLAYER_PVP_DEATH",
  "LAN_STATS",
  "COMBAT_LOG_VERSION",
  "COMBAT_ZONE",
  "COMBAT_PLAYER_DEATH",
  "COMBAT_UNIT_DEATH",
  "PARTY_KILL",
  "ENCOUNTER_START",
  "ENCOUNTER_END",
];

export function makeId(runId, label) {
  return `sim-${runId}-${label}-${crypto.randomBytes(4).toString("hex")}`;
}

export function baseEvent(runId, type, fields = {}, label = type.toLowerCase()) {
  return {
    v: 1,
    id: makeId(runId, label),
    ts: Math.floor(Date.now() / 1000),
    type,
    source: "simulator",
    simulated: true,
    ...fields,
  };
}

export function memberSnapshot(p, extras = {}) {
  return {
    unit: p.unit,
    party_index: p.party_index ?? null,
    raid_index: p.raid_index ?? null,
    character: p.character,
    realm: p.realm,
    class: p.class,
    race: p.race,
    level: p.level,
    guid: p.guid,
    online: p.online !== false,
    dead: !!p.dead,
    role: p.role || "NONE",
    zone: p.zone || "",
    zone_source: p.zone_source || "simulator",
    in_instance: !!p.in_instance,
    instance_type: p.instance_type || "",
    instance_name: p.instance_name || "",
    difficulty_name: p.difficulty_name || "",
    difficulty_id: p.difficulty_id ?? null,
    is_self: !!p.is_self,
    ...extras,
  };
}

export function partyRosterEvent(runId, members, reason = "scenario") {
  const self = members.find((m) => m.is_self) || members[0];
  return baseEvent(
    runId,
    "PARTY_ROSTER",
    {
      reason,
      group_size: members.length,
      in_group: members.length > 1,
      in_raid: false,
      members: members.map((m) => memberSnapshot(m)),
      character: self?.character || "",
      level: self?.level || 0,
    },
    `roster-${reason}`
  );
}
