/**
 * Forever LAN — weekend pace projection (not a hard level ceiling).
 * Primary: Counted from observed ding rate → ETA / Sunday level.
 * Fallback reference only: Classic hour bands (Guessed) when nobody has pace yet.
 *
 * Product calendar (Icy Veins / Blizzard):
 *   Beta Sep 17–Oct 22 2026 (cap 30) — practice only for this tool
 *   Launch Nov 4 2026 23:00 UTC (cap 60) — real race; wipe practice data before then
 */

/** Classic-era efficient /played hours to reach each bracket top (planning table — Guessed fallback). */
const HOURS_TO_BRACKET = [
  { level: 10, hours: 4 },
  { level: 20, hours: 12 },
  { level: 30, hours: 28 },
  { level: 40, hours: 52 },
  { level: 50, hours: 85 },
  { level: 60, hours: 120 },
];

/**
 * @param {number} playedHours
 * @returns {number} estimated level 1–60
 */
export function levelFromPlayedHours(playedHours) {
  const h = Math.max(0, Number(playedHours) || 0);
  if (h <= 0) return 1;
  let prev = { level: 1, hours: 0 };
  for (const b of HOURS_TO_BRACKET) {
    if (h <= b.hours) {
      const span = b.hours - prev.hours;
      const frac = span > 0 ? (h - prev.hours) / span : 1;
      return Math.min(60, Math.max(1, Math.round(prev.level + (b.level - prev.level) * frac)));
    }
    prev = b;
  }
  return 60;
}

/**
 * Sunday on/after weekendStart (YYYY-MM-DD). If start is already Sunday, that day.
 * @param {string|null} weekendStart
 * @param {string|null} [fallbackIso]
 */
export function lanSundayDate(weekendStart, fallbackIso = null) {
  const seed = weekendStart || (fallbackIso ? String(fallbackIso).slice(0, 10) : null);
  if (!seed || !/^\d{4}-\d{2}-\d{2}$/.test(seed)) return null;
  const d = new Date(`${seed}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const day = d.getDay(); // 0 Sun
  const add = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

/**
 * Observed levels/hour for one climber (Counted).
 * @param {object} p
 * @param {number} nowMs
 * @returns {{ character: string, level: number, levels_gained: number, levels_per_hour: number, hours_observed: number }|null}
 */
export function playerPace(p, nowMs) {
  if (!p || p.level == null) return null;
  const gained = Math.max(0, Number(p.levels_gained) || 0);
  if (gained < 1) return null;
  const startIso = p.first_seen_at || p.start_seen_at || null;
  const endIso = p.last_ding_at || p.last_seen_at || null;
  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs = endIso ? new Date(endIso).getTime() : nowMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const spanMs = Math.max(0, Math.min(nowMs, endMs) - startMs);
  // Need a real window — ignore sub-10m flashes.
  if (spanMs < 10 * 60 * 1000) return null;
  const hours = spanMs / 3600000;
  if (hours <= 0) return null;
  const rate = gained / hours;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    character: p.character || "?",
    level: p.level,
    levels_gained: gained,
    levels_per_hour: Math.round(rate * 100) / 100,
    hours_observed: Math.round(hours * 10) / 10,
  };
}

/**
 * Project level by Sunday from observed pace.
 * Uses estimated *play* hours left in the LAN weekend (Fri→Sun), not 24/7 wall clock —
 * so a 90-minute burst does not get multiplied by every hour until November.
 * Does not invent a weekend hard level cap; only the game levelCap stops the climb.
 *
 * @param {object} pace playerPace result
 * @param {number} nowMs
 * @param {number} weekendStartMs Friday 00:00 local-ish (date noon UTC-safe)
 * @param {number} sundayEndMs
 * @param {number} levelCap
 */
export function projectLevelAtSunday(pace, nowMs, weekendStartMs, sundayEndMs, levelCap) {
  if (!pace) return null;
  const obsDays = Math.max(1 / 24, pace.hours_observed / 24);
  // Short burst same calendar day → that session length is the daily play sample.
  const dailyPlayHours =
    pace.hours_observed <= 24
      ? Math.min(16, pace.hours_observed)
      : Math.min(16, pace.hours_observed / obsDays);

  const windowStart = Math.max(nowMs, weekendStartMs || nowMs);
  const windowEnd = Math.max(windowStart, sundayEndMs);
  const weekendDaysLeft = Math.max(0, (windowEnd - windowStart) / (24 * 3600 * 1000));
  // At least the remaining fraction of today counts when already on the weekend.
  const playHoursLeft = dailyPlayHours * Math.max(weekendDaysLeft, weekendDaysLeft > 0 ? 0.25 : 0);

  const raw = pace.level + pace.levels_per_hour * playHoursLeft;
  const projected = Math.max(pace.level, Math.round(raw));
  return {
    sunday_level: Math.min(levelCap, projected),
    play_hours_left: Math.round(playHoursLeft * 10) / 10,
    daily_play_hours: Math.round(dailyPlayHours * 10) / 10,
  };
}

/**
 * @param {object} opts
 * @param {number} [opts.levelCap] game/product level cap (launch 60)
 * @param {string} [opts.betaLaunch] Forever launch day YYYY-MM-DD
 * @param {string|null} [opts.weekendStart]
 * @param {string|null} [opts.watchingSince]
 * @param {string|null} [opts.nowIso]
 * @param {object[]} [opts.players] public /lan players
 */
export function buildRaceCeiling(opts = {}) {
  const levelCap = Math.max(1, Math.min(60, Number(opts.levelCap) || 60));
  const betaLaunch = opts.betaLaunch || "2026-11-04";
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const sunday =
    lanSundayDate(opts.weekendStart, opts.watchingSince || nowIso) ||
    lanSundayDate(null, nowIso);
  const sundayEndMs = sunday
    ? new Date(`${sunday}T23:59:59`).getTime()
    : nowMs + 3 * 24 * 3600 * 1000;
  const weekendStartIso = opts.weekendStart || (sunday ? sunday : null);
  // Friday of LAN: weekendStart config, else Sunday − 2 days.
  let weekendStartMs = weekendStartIso
    ? new Date(`${String(weekendStartIso).slice(0, 10)}T00:00:00`).getTime()
    : NaN;
  if (!Number.isFinite(weekendStartMs) && sunday) {
    const d = new Date(`${sunday}T00:00:00`);
    d.setDate(d.getDate() - 2);
    weekendStartMs = d.getTime();
  }
  if (!Number.isFinite(weekendStartMs)) weekendStartMs = nowMs;

  // Forever launch is listed as Nov 4, 2026 23:00 UTC (Icy Veins).
  const launchMs = new Date(`${betaLaunch}T23:00:00Z`).getTime();
  const calendarDays =
    Number.isFinite(launchMs) && Number.isFinite(sundayEndMs) && sundayEndMs >= launchMs
      ? Math.max(1, Math.round((sundayEndMs - launchMs) / (24 * 3600 * 1000)))
      : null;

  // Guessed Classic bands — reference only, never the weekend hard stop.
  const referenceBands = calendarDays
    ? {
        evenings_3h: levelFromPlayedHours(calendarDays * 3),
        serious_6h: levelFromPlayedHours(calendarDays * 6),
        hardcore_12h: levelFromPlayedHours(calendarDays * 12),
      }
    : null;

  const paces = (opts.players || [])
    .map((p) => playerPace(p, nowMs))
    .filter(Boolean)
    .sort((a, b) => b.levels_per_hour - a.levels_per_hour);

  const projections = paces
    .map((pace) => {
      const proj = projectLevelAtSunday(pace, nowMs, weekendStartMs, sundayEndMs, levelCap);
      const hoursToCap =
        pace.levels_per_hour > 0
          ? Math.max(0, (levelCap - pace.level) / pace.levels_per_hour)
          : null;
      const playLeft = proj?.play_hours_left ?? 0;
      return {
        character: pace.character,
        level: pace.level,
        levels_per_hour: pace.levels_per_hour,
        hours_observed: pace.hours_observed,
        sunday_level: proj?.sunday_level ?? pace.level,
        play_hours_left: proj?.play_hours_left ?? null,
        daily_play_hours: proj?.daily_play_hours ?? null,
        hours_to_cap: hoursToCap != null ? Math.round(hoursToCap * 10) / 10 : null,
        hits_cap: hoursToCap != null && playLeft > 0 && hoursToCap <= playLeft,
      };
    })
    .sort(
      (a, b) =>
        (b.sunday_level || 0) - (a.sunday_level || 0) ||
        b.levels_per_hour - a.levels_per_hour
    );

  const leaderPace = projections[0] || null;
  const paceSundayMax = leaderPace?.sunday_level ?? null;
  const hasPace = projections.length > 0;

  // Live strip / meta: pace projection when we have dings; else no invented weekend cap.
  const theoreticalMax = hasPace
    ? paceSundayMax
    : null;

  return {
    level_cap: levelCap,
    theoretical_max_level: theoreticalMax,
    pace_sunday_level: paceSundayMax,
    pace_leader: leaderPace
      ? {
          character: leaderPace.character,
          levels_per_hour: leaderPace.levels_per_hour,
          sunday_level: leaderPace.sunday_level,
          hours_to_cap: leaderPace.hours_to_cap,
          hits_cap: leaderPace.hits_cap,
        }
      : null,
    pace_board: projections.slice(0, 8),
    beta_launch: betaLaunch,
    lan_sunday: sunday,
    calendar_days: calendarDays,
    hours_to_reach_cap_guessed: HOURS_TO_BRACKET.find((b) => b.level >= levelCap)?.hours ?? null,
    scenarios_uncapped_guessed: referenceBands,
    race_label: levelCap < 60 ? `race to ${levelCap}` : "race to 60",
    honesty: {
      level_cap: "observed",
      pace: "derived", // Counted from logged dings ÷ observed span
      hour_bands: "inferred", // Classic planning tables — reference only
    },
    blurb: (() => {
      const window = `Launch ${betaLaunch} → Sunday ${sunday || "?"} (~${calendarDays ?? "?"} days)`;
      if (leaderPace) {
        const hit = leaderPace.hits_cap
          ? `${leaderPace.character} is on pace to hit L${levelCap} before Sunday`
          : `${leaderPace.character} on pace for ~L${leaderPace.sunday_level} by Sunday (${leaderPace.levels_per_hour}/h)`;
        return `${window}. ${hit}. No weekend level hard-cap — pace decides.`;
      }
      if (referenceBands) {
        return `${window}. No ding pace yet — Classic reference bands (Guessed): evenings ~L${referenceBands.evenings_3h}, serious ~L${referenceBands.serious_6h}, hardcore ~L${referenceBands.hardcore_12h}. Live pace takes over after the first climbs.`;
      }
      return `${window}. Waiting for leveling pace.`;
    })(),
  };
}
