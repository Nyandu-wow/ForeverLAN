/**
 * Explore catalog from the LanSession board — one fold, one death count.
 * Do not re-walk host-events here for characters / deaths / zones.
 */

import { relevantPowerStats } from "./class-power.js";

function spanSeconds(firstAt, lastAt) {
  if (!firstAt || !lastAt) return 0;
  const a = new Date(firstAt).getTime();
  const b = new Date(lastAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 1000);
}

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

/**
 * @param {object[]} players LanSession public players
 */
export function charactersFromBoard(players) {
  return (players || [])
    .filter((p) => p?.character)
    .map((p) => {
      const firstAt = p.first_seen_at || null;
      const lastAt = p.last_seen_at || p.last_event_at || null;
      const spanSec = spanSeconds(firstAt, lastAt);
      const hours = spanSec > 0 ? spanSec / 3600 : 0;
      const levelsGained =
        p.levels_gained != null
          ? p.levels_gained
          : p.level != null && p.start_level != null
            ? Math.max(0, p.level - p.start_level)
            : 0;
      const deaths = p.deaths || 0;
      const levelsPerHour =
        hours >= 0.05 && levelsGained > 0 ? Math.round((levelsGained / hours) * 100) / 100 : null;
      const deathsPerHour =
        hours >= 0.05 && deaths > 0 ? Math.round((deaths / hours) * 100) / 100 : null;
      const zonesSeen = Array.isArray(p.zones_seen) ? p.zones_seen : [];
      const pow = relevantPowerStats(p);
      return {
        character: p.character,
        guid: p.guid || null,
        realm: p.realm || null,
        class: p.class || null,
        race: p.race || null,
        level: p.level ?? null,
        start_level: p.start_level ?? null,
        levels_gained: levelsGained,
        deaths,
        dings: levelsGained,
        zones: p.zones != null ? p.zones : zonesSeen.length,
        zones_seen: zonesSeen,
        quests_completed: p.quests_completed ?? null,
        copper: p.copper ?? null,
        professions: p.professions || null,
        distance_yards: p.distance_yards ?? null,
        distance_m: p.distance_m ?? null,
        jumps: p.jumps ?? null,
        attack_power: pow.attack_power,
        ranged_attack_power: pow.ranged_attack_power,
        spell_power: pow.spell_power,
        spell_healing: pow.spell_healing,
        world_map_opens: p.world_map_opens ?? null,
        minimap_opens: p.minimap_opens ?? null,
        first_at: firstAt,
        last_at: lastAt,
        observed_span_seconds: spanSec || null,
        levels_per_hour: levelsPerHour,
        deaths_per_hour: deathsPerHour,
        online: !!p.online,
        dead: !!p.dead,
        zone: p.zone || null,
        legacy: p.legacy || null,
      };
    })
    .sort((a, b) => (b.level || 0) - (a.level || 0) || a.character.localeCompare(b.character));
}

/**
 * @param {object} state LanSession public state
 */
export function zonesFromBoard(state) {
  const players = state?.players || [];
  const deaths = state?.death_log || [];
  const map = new Map();

  function bump(zone, who) {
    if (!zone) return;
    let z = map.get(zone);
    if (!z) {
      z = { zone, who: new Set(), dings: 0, deaths: 0, events: 0 };
      map.set(zone, z);
    }
    z.events += 1;
    if (who) z.who.add(who);
    return z;
  }

  for (const p of players) {
    for (const zone of p.zones_seen || []) {
      bump(zone, p.character);
    }
    if (p.zone) bump(p.zone, p.character);
    for (const h of p.level_history || []) {
      if (h?.zone && h.level != null) {
        const z = bump(h.zone, p.character);
        if (z) z.dings += 1;
      }
    }
  }

  for (const d of deaths) {
    const z = bump(d.zone, d.character);
    if (z) z.deaths += 1;
  }

  // Prefer totals.zones event-ish ranking when present, but keep board who/deaths.
  return [...map.values()]
    .map((z) => ({
      zone: z.zone,
      characters: z.who.size,
      who: [...z.who].sort((a, b) => a.localeCompare(b)),
      dings: z.dings,
      deaths: z.deaths,
      events: Math.max(z.events, z.deaths + z.dings + z.who.size),
    }))
    .sort((a, b) => b.events - a.events || a.zone.localeCompare(b.zone));
}

/**
 * @param {object} state
 */
export function insightsFromBoard(state) {
  const insights = [];
  const deaths = state?.death_log || [];
  const chars = charactersFromBoard(state?.players || []);
  if (deaths[0]) {
    const d = deaths[0];
    insights.push({
      kind: "DEATH",
      title: "LATEST DEATH",
      detail: d.narrative,
      character: d.character,
      ts: d.ts,
    });
  }
  const longestGap = [...deaths]
    .filter((d) => d.seconds_since_previous != null)
    .sort((a, b) => b.seconds_since_previous - a.seconds_since_previous)[0];
  if (longestGap && longestGap.seconds_since_previous >= 60) {
    insights.push({
      kind: "LONGEST_SURVIVAL",
      title: "LONGEST GAP BETWEEN DEATHS",
      detail: `${longestGap.character} · ${formatDuration(longestGap.seconds_since_previous)} between deaths`,
      character: longestGap.character,
      ts: longestGap.ts,
    });
  }
  const spree = [...deaths].sort((a, b) => (b.spree_20m || 0) - (a.spree_20m || 0))[0];
  if (spree && spree.spree_20m >= 3) {
    insights.push({
      kind: "DEATH_SPREE",
      title: "DEATH SPREE",
      detail: `${spree.character} · ${spree.spree_20m} deaths in 20 minutes`,
      character: spree.character,
      ts: spree.ts,
    });
  }
  const leader = chars.find((c) => c.level);
  if (leader) {
    insights.push({
      kind: "RACE_POSITION",
      title: "HIGHEST LEVEL LOGGED",
      detail: `${leader.character} · level ${leader.level}`,
      character: leader.character,
      ts: null,
    });
  }
  return insights;
}

/**
 * Full Explore catalog from one LanSession board.
 * @param {object} state decorateLanState output / session.getPublicState()
 */
export function catalogFromLanState(state) {
  const characters = charactersFromBoard(state?.players || []);
  const deaths = Array.isArray(state?.death_log) ? state.death_log : [];
  return {
    characters,
    zones: zonesFromBoard(state),
    deaths,
    insights: insightsFromBoard(state),
    source: "lan-session",
    honesty: "derived",
    note: "Characters, deaths, and zones come from the same LanSession fold as Live — not a second event walk.",
  };
}
