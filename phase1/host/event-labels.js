/**
 * Short human labels for event types (ingest.log, Timeline Type column).
 * Internal type codes stay on the wire and in jsonl.
 */

export function eventTypeLabel(evOrType) {
  const type =
    typeof evOrType === "string" ? evOrType : String(evOrType?.type || "");
  const ev = typeof evOrType === "object" && evOrType ? evOrType : null;
  switch (type) {
    case "LOGIN":
      return "logged in";
    case "LOGOUT":
      return "logged out";
    case "WORLD_ENTER":
      return "entered world";
    case "PLAYER_PLAYING":
      return "now playing";
    case "PLAYER_ONLINE":
      return "came online";
    case "PLAYER_OFFLINE":
      return "went offline";
    case "PLAYER_DETECTED":
      return "seen in party";
    case "PLAYER_LEVEL_CHANGED":
      return "ding";
    case "PLAYER_DIED":
      return "died";
    case "PLAYER_RESURRECTED":
      return "resurrected";
    case "PLAYER_ZONE_CHANGED":
      return "changed zone";
    case "PLAYER_ENTERED_INSTANCE":
      return "entered instance";
    case "PLAYER_LEFT_INSTANCE":
      return "left instance";
    case "PLAYER_PROFESSIONS":
      return "professions update";
    case "PLAYER_CRAFT":
      return "crafted item";
    case "PLAYER_QUESTS":
      return "quest progress";
    case "PLAYER_FOOD_BUFF":
      return "food buff";
    case "PLAYER_DISTANCE":
      return "distance traveled";
    case "PLAYER_POWER_STATS":
      return "power stats";
    case "PLAYER_MONEY":
      return "gold update";
    case "PLAYER_MAP_OPENED":
      return "opened map";
    case "PLAYER_COMBAT_TIME":
      return "combat time";
    case "PLAYER_LOOT_RARE":
      return "rare loot";
    case "PLAYER_LOOT_EPIC":
      return "epic loot";
    case "PLAYER_PVP_KILL":
      return "PvP kill";
    case "PLAYER_REPAIR_SPEND":
      return "repair spend";
    case "PARTY_ROSTER":
      return "party roster updated";
    case "PARTY_KILL": {
      const dest = String(ev?.dest_guid || ev?.victim_guid || ev?.destGUID || "");
      if (/^Player-/i.test(dest)) return "killed a player";
      if (/^Creature-/i.test(dest) || dest) return "killed a mob";
      return "kill (combat log)";
    }
    case "COMBAT_ZONE":
      return "combat-log zone";
    case "COMBAT_LOG_VERSION":
      return "combat log started";
    case "COMBAT_PLAYER_DEATH":
      return "death (combat log)";
    case "PING":
      return "ping";
    default:
      return type || "event";
  }
}

/** Title-case for dashboard Type columns. */
export function eventTypeLabelUi(evOrType) {
  const s = eventTypeLabel(evOrType);
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
