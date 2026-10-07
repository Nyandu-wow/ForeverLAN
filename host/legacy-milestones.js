/**
 * Forever LAN — shared Legacy milestone layer (Counted / Logged only).
 *
 * Official Forever Legacy (Blizzard):
 *   Classes 27 — per class: L25, L45, L60
 *   Tradeskills 18 — per non-gathering primary: 150, 225, 300
 *   PvP 12 / Adventure 2 / Dungeons 3 / Raids 3 — not verifiable with current telemetry
 *
 * This module never invents completion. Unobserved ≠ incomplete.
 * Source: https://news.blizzard.com/en-us/article/24307383/…
 */

/** Class Legacy thresholds (per class). */
export const LEGACY_LEVEL_THRESHOLDS = Object.freeze([25, 45, 60]);

/**
 * Tradeskill Legacy thresholds — non-gathering primaries only (official).
 * Gathering (Herbalism / Mining / Skinning) does NOT earn Legacy Points.
 */
export const LEGACY_PROF_THRESHOLDS = Object.freeze([150, 225, 300]);

export const LEGACY_NON_GATHERING_PRIMARIES = Object.freeze([
  "Alchemy",
  "Blacksmithing",
  "Enchanting",
  "Engineering",
  "Leatherworking",
  "Tailoring",
]);

const GATHERING = new Set(["herbalism", "mining", "skinning"]);

export function isLegacyProfessionName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || GATHERING.has(n)) return false;
  return LEGACY_NON_GATHERING_PRIMARIES.some((p) => p.toLowerCase() === n);
}

/**
 * @param {number|null|undefined} level
 * @returns {{ threshold: number, status: "verified"|"in_progress"|"locked", remaining: number|null, honesty: string }[]}
 */
export function levelJourney(level) {
  const lvl = level != null && Number.isFinite(Number(level)) ? Number(level) : null;
  return LEGACY_LEVEL_THRESHOLDS.map((threshold) => {
    if (lvl == null) {
      return { threshold, status: "locked", remaining: null, honesty: "untracked" };
    }
    if (lvl >= threshold) {
      return { threshold, status: "verified", remaining: 0, honesty: "observed" };
    }
    return {
      threshold,
      status: "in_progress",
      remaining: threshold - lvl,
      honesty: "derived",
    };
  });
}

/**
 * @param {{ name?: string, rank?: number, max_rank?: number, kind?: string }|null} prof
 */
export function professionJourney(prof) {
  if (!prof?.name || !isLegacyProfessionName(prof.name)) return null;
  const rank = Number(prof.rank);
  const hasRank = Number.isFinite(rank);
  return {
    name: String(prof.name),
    rank: hasRank ? rank : null,
    max_rank: Number(prof.max_rank) || null,
    honesty: hasRank ? "observed" : "untracked",
    milestones: LEGACY_PROF_THRESHOLDS.map((threshold) => {
      if (!hasRank) {
        return { threshold, status: "locked", remaining: null, honesty: "untracked" };
      }
      if (rank >= threshold) {
        return { threshold, status: "verified", remaining: 0, honesty: "observed" };
      }
      return {
        threshold,
        status: "in_progress",
        remaining: threshold - rank,
        honesty: "derived",
      };
    }),
  };
}

/**
 * Detect level threshold crossings (old → new). Only official Legacy levels.
 * @returns {{ threshold: number, character: string, class: string|null }[]}
 */
export function detectLevelLegacyCrossings(oldLevel, newLevel, character, className = null) {
  if (oldLevel == null || oldLevel === "" || newLevel == null || newLevel === "") return [];
  const oldL = Number(oldLevel);
  const newL = Number(newLevel);
  if (!Number.isFinite(oldL) || !Number.isFinite(newL) || !character) return [];
  if (newL <= oldL) return [];
  const out = [];
  for (const t of LEGACY_LEVEL_THRESHOLDS) {
    if (oldL < t && newL >= t) {
      out.push({ threshold: t, character, class: className || null });
    }
  }
  return out;
}

/**
 * Detect profession Legacy crossings for one skill line.
 * @returns {{ threshold: number, character: string, profession: string }[]}
 */
export function detectProfessionLegacyCrossings(prevRank, newRank, professionName, character) {
  if (!character || !isLegacyProfessionName(professionName)) return [];
  const prev = Number(prevRank);
  const next = Number(newRank);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || next <= prev) return [];
  const out = [];
  for (const t of LEGACY_PROF_THRESHOLDS) {
    if (prev < t && next >= t) {
      out.push({ threshold: t, character, profession: String(professionName) });
    }
  }
  return out;
}

/**
 * Per-player Legacy journey from public/internal player fields.
 */
export function buildPlayerLegacy(player) {
  if (!player?.character) return null;
  const levels = levelJourney(player.level);
  const verifiedLevels = levels.filter((m) => m.status === "verified").length;
  const professions = (player.professions || [])
    .map((pr) => professionJourney(pr))
    .filter(Boolean);
  const verifiedProfs = professions.reduce(
    (a, pr) => a + pr.milestones.filter((m) => m.status === "verified").length,
    0
  );
  const verified = verifiedLevels + verifiedProfs;

  /** Next incomplete milestone (level first, then closest profession). */
  let next = null;
  const nextLevel = levels.find((m) => m.status === "in_progress");
  if (nextLevel) {
    next = {
      kind: "level",
      label: `Level ${nextLevel.threshold}`,
      remaining: nextLevel.remaining,
      honesty: "derived",
    };
  } else {
    let best = null;
    for (const pr of professions) {
      for (const m of pr.milestones) {
        if (m.status !== "in_progress") continue;
        if (!best || m.remaining < best.remaining) {
          best = {
            kind: "profession",
            label: `${pr.name} ${m.threshold}`,
            remaining: m.remaining,
            honesty: "derived",
          };
        }
      }
    }
    next = best;
  }

  return {
    character: player.character,
    class: player.class || null,
    honesty: {
      levels: player.level != null ? "observed" : "untracked",
      professions: professions.length ? "observed" : "untracked",
      points: "untracked", // official Legacy Points never fabricated
    },
    levels,
    professions,
    verified_count: verified,
    verified_levels: verifiedLevels,
    verified_professions: verifiedProfs,
    next,
    note:
      "Verified = Forever LAN observed this threshold. Untracked ≠ incomplete.",
  };
}

/**
 * Party-wide Legacy board for /lan + awards.
 * @param {object[]} players
 */
export function buildLegacyBoard(players = []) {
  const rows = (players || [])
    .map((p) => buildPlayerLegacy(p))
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.verified_count - a.verified_count ||
        String(a.character).localeCompare(String(b.character))
    );

  const totals = {
    verified_milestones: rows.reduce((a, r) => a + r.verified_count, 0),
    players_with_any: rows.filter((r) => r.verified_count > 0).length,
    class_milestones: rows.reduce((a, r) => a + r.verified_levels, 0),
    profession_milestones: rows.reduce((a, r) => a + r.verified_professions, 0),
  };

  const awards = [];

  const builder = rows.find((r) => r.verified_count > 0);
  if (builder && rows.filter((r) => r.verified_count === builder.verified_count).length === 1) {
    awards.push({
      title: "BUILDING A LEGACY",
      detail: `${builder.character} · ${builder.verified_count} verified Legacy milestone${builder.verified_count === 1 ? "" : "s"}`,
      character: builder.character,
      shame: false,
      honesty: "derived",
    });
  }

  // Closest to next verified milestone (smallest remaining among in-progress).
  let closest = null;
  for (const r of rows) {
    if (!r.next || r.next.remaining == null) continue;
    if (!closest || r.next.remaining < closest.remaining) {
      closest = {
        character: r.character,
        remaining: r.next.remaining,
        label: r.next.label,
      };
    }
  }
  if (closest && closest.remaining > 0 && closest.remaining <= 30) {
    awards.push({
      title: "THE LONG GAME",
      detail: `${closest.character} · ${closest.remaining} to ${closest.label}`,
      character: closest.character,
      shame: false,
      honesty: "derived",
    });
  }

  const byClass = [...rows].sort((a, b) => b.verified_levels - a.verified_levels);
  if (byClass[0]?.verified_levels >= 1) {
    const top = byClass[0];
    const tied = byClass.filter((r) => r.verified_levels === top.verified_levels);
    if (tied.length === 1) {
      awards.push({
        title: "MULTICLASS MENACE",
        detail: `${top.character} · ${top.verified_levels} class Legacy milestone${top.verified_levels === 1 ? "" : "s"} (${top.class || "class"} track)`,
        character: top.character,
        shame: false,
        honesty: "derived",
      });
    }
  }

  const byProf = [...rows].sort((a, b) => b.verified_professions - a.verified_professions);
  if (byProf[0]?.verified_professions >= 1) {
    const top = byProf[0];
    const tied = byProf.filter((r) => r.verified_professions === top.verified_professions);
    if (tied.length === 1) {
      awards.push({
        title: "PROFESSIONAL LEGACY",
        detail: `${top.character} · ${top.verified_professions} profession Legacy milestone${top.verified_professions === 1 ? "" : "s"}`,
        character: top.character,
        shame: false,
        honesty: "derived",
      });
    }
  }

  return {
    title: "LEGACY JOURNEY",
    honesty: {
      levels: "observed",
      professions: "observed",
      points: "untracked",
      unsupported: "untracked",
    },
    unsupported: [
      "PvP honor ranks / BG exalted / Field of Honor journey",
      "Full world map explore",
      "Lord Valthalak questline",
      "Dungeon final-boss brackets",
      "Raid boss clears (Onyxia / Hyjal / Barrow Deeps)",
      "Official account Legacy Points total",
    ],
    note: "Gathering professions (Herbalism, Mining, Skinning) are not Legacy tradeskill challenges.",
    players: rows,
    totals,
    awards,
  };
}

/** Alias matching the product brief name. */
export function buildLegacyMilestones(players) {
  return buildLegacyBoard(players);
}
