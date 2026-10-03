import { baseEvent, partyRosterEvent, memberSnapshot } from "./schema.js";
import { createCast, cloneCast, ZONES, DUNGEONS } from "./cast.js";

/**
 * One continuous Forever LAN weekend simulation.
 * Emits the same normalized events the real host pipeline will consume.
 */
export function createLanWorld() {
  const cast = cloneCast(createCast());
  let tick = 0;
  let inDungeon = false;
  let dungeonName = "";
  let dungeonTicksLeft = 0;

  function partyMembers() {
    return cast
      .filter((p) => p.online)
      .map((p, i) => {
        if (p.is_self) return { ...p, unit: "player", party_index: null };
        return { ...p, unit: `party${i}`, party_index: i };
      });
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function weightedPlayer(preferOnline = true) {
    const pool = cast.filter((p) => (preferOnline ? p.online : true));
    return pick(pool.length ? pool : cast);
  }

  function snapshotEvent(runId, reason = "tick") {
    return partyRosterEvent(runId, partyMembers(), reason);
  }

  function lanStatsEvent(runId) {
    const players = cast.map((p) => ({
      character: p.character,
      class: p.class,
      race: p.race,
      level: p.level,
      zone: p.zone,
      online: p.online,
      dead: p.dead,
      is_self: p.is_self,
      guid: p.guid,
      deaths: p.deaths,
      deaths_pvp: p.deaths_pvp,
      deaths_pve: p.deaths_pve,
      pvp_kills: p.pvp_kills,
      levels_gained: p.levels_gained,
      dungeon_runs: p.dungeon_runs,
    }));
    const online = players.filter((p) => p.online).length;
    const levels = players.map((p) => p.level);
    return baseEvent(runId, "LAN_STATS", {
      players,
      online_count: online,
      highest_level: Math.max(...levels),
      average_level: Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 10) / 10,
      total_deaths: players.reduce((a, p) => a + p.deaths, 0),
      total_pvp_kills: players.reduce((a, p) => a + p.pvp_kills, 0),
      total_levels_gained: players.reduce((a, p) => a + p.levels_gained, 0),
      in_dungeon: inDungeon,
      dungeon_name: dungeonName || null,
    }, `stats-${tick}`);
  }

  /** @returns {object[]} events to emit this tick */
  function step(runId) {
    tick += 1;
    const events = [];

    // Boot sequence
    if (tick === 1) {
      const host = cast[0];
      events.push(baseEvent(runId, "LOGIN", { ...memberSnapshot(host) }));
      for (const p of cast) {
        events.push(
          baseEvent(runId, "PLAYER_DETECTED", {
            ...memberSnapshot(p),
            reason: "lan_start",
          })
        );
      }
      events.push(snapshotEvent(runId, "lan_start"));
      events.push(lanStatsEvent(runId));
      return events;
    }

    // Dungeon leave countdown
    if (inDungeon && dungeonTicksLeft > 0) {
      dungeonTicksLeft -= 1;
      if (dungeonTicksLeft === 0) {
        const host = cast[0];
        inDungeon = false;
        const left = dungeonName;
        dungeonName = "";
        for (const p of cast) {
          if (p.online) {
            p.zone = pick(["Westfall", "The Barrens", "Silverpine Forest", "Ashenvale"]);
            p.dungeon_runs += 1;
          }
        }
        events.push(
          baseEvent(runId, "PLAYER_LEFT_INSTANCE", {
            ...memberSnapshot(host),
            instance_name: left,
          })
        );
        events.push(snapshotEvent(runId, "dungeon_exit"));
      }
    }

    // Random beat
    const roll = Math.random();

    if (!inDungeon && roll < 0.14) {
      // Level up
      const p = weightedPlayer();
      if (p.online && p.level < 60) {
        const old = p.level;
        p.level += 1;
        p.levels_gained += 1;
        events.push(
          baseEvent(runId, "PLAYER_LEVEL_CHANGED", {
            ...memberSnapshot(p),
            old_level: old,
            detection: "simulator",
          })
        );
      }
    } else if (!inDungeon && roll < 0.28) {
      // Zone change
      const p = weightedPlayer();
      if (p.online) {
        const old = p.zone;
        p.zone = pick(ZONES.filter((z) => z !== old));
        events.push(
          baseEvent(runId, "PLAYER_ZONE_CHANGED", {
            ...memberSnapshot(p),
            old_zone: old,
            zone_source: "simulator",
          })
        );
      }
    } else if (roll < 0.42) {
      // PvE death
      const p = weightedPlayer();
      if (p.online && !p.dead) {
        p.dead = true;
        p.deaths += 1;
        p.deaths_pve += 1;
        events.push(
          baseEvent(runId, "PLAYER_DIED", {
            ...memberSnapshot(p),
            detection: "simulator",
            death_cause: "pve",
          })
        );
        // Auto-release next-ish
        setTimeoutRelease(p);
      }
    } else if (roll < 0.55) {
      // PvP kill + maybe victim death
      const killer = weightedPlayer();
      const victim = weightedPlayer();
      if (killer.online && victim.online && killer.guid !== victim.guid) {
        killer.pvp_kills += 1;
        events.push(
          baseEvent(runId, "PLAYER_PVP_KILL", {
            ...memberSnapshot(killer),
            opponent_name: victim.character,
            opponent_guid: victim.guid,
            detection: "simulator",
          })
        );
        if (Math.random() < 0.7) {
          victim.dead = true;
          victim.deaths += 1;
          victim.deaths_pvp += 1;
          events.push(
            baseEvent(runId, "PLAYER_PVP_DEATH", {
              ...memberSnapshot(victim),
              opponent_name: killer.character,
              opponent_guid: killer.guid,
              detection: "simulator",
              death_cause: "pvp",
            })
          );
          events.push(
            baseEvent(runId, "PLAYER_DIED", {
              ...memberSnapshot(victim),
              detection: "simulator",
              death_cause: "pvp",
            })
          );
          setTimeoutRelease(victim);
        }
      }
    } else if (!inDungeon && roll < 0.62) {
      // Enter dungeon together
      const host = cast[0];
      inDungeon = true;
      dungeonName = pick(DUNGEONS);
      dungeonTicksLeft = 3 + Math.floor(Math.random() * 3);
      for (const p of cast) {
        if (p.online) p.zone = dungeonName;
      }
      events.push(
        baseEvent(runId, "PLAYER_ENTERED_INSTANCE", {
          ...memberSnapshot(host),
          instance_name: dungeonName,
          instance_type: "party",
          difficulty_name: "Normal",
        })
      );
      events.push(
        baseEvent(runId, "ENCOUNTER_START", {
          encounter_name: `${dungeonName} Boss`,
          encounter_id: String(1000 + tick),
          group_size: cast.filter((p) => p.online).length,
        })
      );
      events.push(snapshotEvent(runId, "dungeon_enter"));
    } else if (inDungeon && roll < 0.72) {
      events.push(
        baseEvent(runId, "ENCOUNTER_END", {
          encounter_name: `${dungeonName} Boss`,
          success: Math.random() < 0.75 ? "1" : "0",
        })
      );
    } else if (roll < 0.78) {
      // Someone briefly offline / back
      const p = cast.find((c) => !c.is_self) || cast[1];
      if (p.online && Math.random() < 0.4) {
        p.online = false;
        events.push(baseEvent(runId, "PLAYER_OFFLINE", { ...memberSnapshot(p) }));
      } else if (!p.online) {
        p.online = true;
        events.push(baseEvent(runId, "PLAYER_ONLINE", { ...memberSnapshot(p) }));
      }
    }

    // Revive anyone still marked dead after a beat
    for (const p of cast) {
      if (p.dead && Math.random() < 0.45) p.dead = false;
    }

    events.push(snapshotEvent(runId, "tick"));
    events.push(lanStatsEvent(runId));
    return events;

    function setTimeoutRelease(_p) {
      // handled probabilistically above
    }
  }

  return {
    getCast: () => cast,
    step,
    get tick() {
      return tick;
    },
  };
}

export const SCENARIOS = {
  lan_weekend: {
    id: "lan_weekend",
    title: "Forever LAN Weekend",
    description:
      "One continuous sim: levels, zones, deaths, PvP, dungeons — your four-person LAN.",
    continuous: true,
  },
};

export function listScenarios() {
  return Object.values(SCENARIOS).map(({ id, title, description, continuous }) => ({
    id,
    title,
    description,
    continuous: !!continuous,
  }));
}
