/**
 * Forever LAN — deterministic announcer voice for What Just Happened / Recent.
 * Attitude only. Every number and name must come from the event/state payload.
 * No AI, no external APIs, no new telemetry.
 */

import { shortName } from "./control-room.js";

/**
 * Stable 32-bit hash for template picking.
 * @param {string} s
 */
export function announcerHash(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(templates, seed) {
  const list = templates || [];
  if (!list.length) return null;
  return list[announcerHash(seed) % list.length];
}

function fill(template, vars = {}) {
  if (template == null) return null;
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v == null || v === "" ? "" : String(v);
  });
}

function whoOf(character) {
  const parts = String(character || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return shortName(character);
  // Multi-word Forever names (Alex Vale) — surname reads better on the board.
  if (parts.length >= 2) return parts[parts.length - 1];
  return parts[0];
}

function upperWho(character) {
  return whoOf(character).toUpperCase();
}

/** Parse common factual bits already present in activity text — never invent. */
export function parseActivityFacts(activity = {}) {
  const text = String(activity.text || "");
  const who = activity.character || null;
  const facts = {
    character: who,
    who: whoOf(who),
    WHO: upperWho(who),
    kind: activity.kind || null,
    text,
  };

  let m;
  if ((m = text.match(/^(.+?) hasn't dinged in (\d+)\s*hours?\s*[—\-–]\s*still\s*(\d+)/i))) {
    // Subject is in the sentence — prefer over triggering-event character.
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.hours = Number(m[2]);
    facts.level = Number(m[3]);
    facts.category = "LEVEL_STALL";
  } else if ((m = text.match(/hasn't dinged in (\d+)\s*hours?\s*[—\-–]\s*still\s*(\d+)/i))) {
    facts.hours = Number(m[1]);
    facts.level = Number(m[2]);
    facts.category = "LEVEL_STALL";
  } else if ((m = text.match(/^(.+?) reached level\s+(\d+)/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.level = Number(m[2]);
    facts.category = "DING";
  } else if ((m = text.match(/reached level\s+(\d+)/i))) {
    facts.level = Number(m[1]);
    facts.category = "DING";
  } else if ((m = text.match(/^(.+?) is first to\s+(\d+)/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.level = Number(m[2]);
    facts.category = "MILESTONE";
  } else if ((m = text.match(/is first to\s+(\d+)/i))) {
    facts.level = Number(m[1]);
    facts.category = "MILESTONE";
  } else if (/takes the lead/i.test(text)) {
    facts.category = "LEAD_CHANGE";
  } else if ((m = text.match(/^(.+?) clawed back\s+(\d+)\s*levels/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.levels = Number(m[2]);
    facts.category = "COMEBACK";
  } else if ((m = text.match(/clawed back\s+(\d+)\s*levels/i))) {
    facts.levels = Number(m[1]);
    facts.category = "COMEBACK";
  } else if ((m = text.match(/^(.+?) finished a\s+(.+?)\s+corpse run/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.duration = m[2].trim();
    facts.category = "CORPSE_RUN";
  } else if ((m = text.match(/finished a\s+(.+?)\s+corpse run/i))) {
    facts.duration = m[1].trim();
    facts.category = "CORPSE_RUN";
  } else if ((m = text.match(/corpse run\s*\(([^)]+)\)/i))) {
    facts.duration = m[1].trim();
    facts.category = "CORPSE_RUN";
  } else if ((m = text.match(/^(.+?) is on a death spree\s*[—\-–]\s*(\d+)\s*deaths/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.deaths = Number(m[2]);
    facts.category = "MULTI_DEATH";
  } else if ((m = text.match(/death spree\s*[—\-–]\s*(\d+)\s*deaths/i))) {
    facts.deaths = Number(m[1]);
    facts.category = "MULTI_DEATH";
  } else if ((m = text.match(/^(.+?) has died\s+(\d+)\s*times/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.deaths = Number(m[2]);
    facts.category = "DEATH";
  } else if ((m = text.match(/has died\s+(\d+)\s*times/i))) {
    facts.deaths = Number(m[1]);
    facts.category = "DEATH";
  } else if (/^LEGACY DING/i.test(text) || /reached Legacy Level/i.test(text)) {
    facts.category = "LEGACY_DING";
    if ((m = text.match(/Legacy Level\s+(\d+)/i))) facts.level = Number(m[1]);
    if ((m = text.match(/^LEGACY DING\s*[—\-–]\s*(.+?) reached/i))) {
      facts.character = m[1].trim();
      facts.who = whoOf(facts.character);
      facts.WHO = upperWho(facts.character);
    }
  } else if (/^LEGACY MILESTONE/i.test(text)) {
    facts.category = "LEGACY_PROF";
    if ((m = text.match(/reached\s+(.+?)\s+(\d+)\s*\./i))) {
      facts.profession = m[1].trim();
      facts.level = Number(m[2]);
    }
    if ((m = text.match(/^LEGACY MILESTONE\s*[—\-–]\s*(.+?) reached/i))) {
      facts.character = m[1].trim();
      facts.who = whoOf(facts.character);
      facts.WHO = upperWho(facts.character);
    }
  } else if ((m = text.match(/^(.+?) dies first\.?$/i))) {
    facts.character = m[1].trim();
    facts.who = whoOf(facts.character);
    facts.WHO = upperWho(facts.character);
    facts.category = "DEATH";
  } else if (/FIRST BLOOD/i.test(text)) {
    facts.category = "PVP";
  } else if ((m = text.match(/still stuck at\s+(\d+)/i))) {
    facts.level = Number(m[1]);
    facts.category = "LEVEL_STUCK";
  } else if (/double-ding/i.test(text)) {
    facts.category = "DING";
    facts.double = true;
  } else if (/FIRST DING|first ding of the weekend/i.test(text)) {
    facts.category = "DING";
    facts.first = true;
  } else if (/night-owl/i.test(text)) {
    facts.category = "DING";
  } else if (/levelers in /i.test(text)) {
    facts.category = "GATHERING";
  } else if (activity.kind === "PROFESSION") {
    facts.category = "PROFESSION";
  } else if (activity.kind === "LOOT") {
    facts.category = "LOOT";
  } else if (activity.kind === "DEATH") {
    facts.category = "DEATH";
  } else if (activity.kind === "DING") {
    facts.category = "DING";
    if ((m = text.match(/level\s+(\d+)/i))) facts.level = Number(m[1]);
  } else if (activity.kind === "PVP") {
    facts.category = "PVP";
  } else if (activity.kind === "PARTY" && /offline/i.test(text)) {
    facts.category = "OFFLINE";
  } else if (activity.kind === "PARTY" && /joined|watch/i.test(text)) {
    facts.category = "CATCH_UP";
  } else if (activity.kind === "DUNGEON" || activity.kind === "ZONE") {
    facts.category = "EXPLORATION";
  } else if (activity.kind === "MOMENT") {
    facts.category = "AWARD";
  } else {
    facts.category = activity.kind || "STATUS";
  }

  return facts;
}

const TEMPLATES = {
  DING: [
    {
      mode: "HYPE",
      headline: "DING.",
      subline: "{WHO} would like everyone to know — level {level}.",
      compact: "{WHO} dings to {level}.",
    },
    {
      mode: "DRY",
      headline: "{WHO} HAS DISCOVERED ANOTHER LEVEL.",
      subline: "Level {level}. The rest of the party may now pretend not to care.",
      compact: "{WHO} → {level}. Noted.",
    },
    {
      mode: "MARIO",
      headline: "ANOTHER LEVEL FOR {WHO}.",
      subline: "Level {level}. Someone check the XP water supply.",
      compact: "{WHO} takes level {level}.",
    },
    {
      mode: "DEADPAN",
      headline: "LEVEL {level}.",
      subline: "{WHO} again. The board updates. Life continues.",
      compact: "{WHO} hits {level}.",
    },
  ],
  DING_FIRST: [
    {
      mode: "HYPE",
      headline: "FIRST DING OF THE WEEKEND.",
      subline: "{WHO} opens the scoring. Everyone else: noted.",
      compact: "First ding — {WHO}.",
    },
    {
      mode: "MOCK",
      headline: "THE RACE HAS BEGUN.",
      subline: "{WHO} scored the opening ding. Form an orderly queue for excuses.",
      compact: "Opening ding: {WHO}.",
    },
  ],
  DING_DOUBLE: [
    {
      mode: "HYPE",
      headline: "DOUBLE DING.",
      subline: "{WHO} took two levels in half an hour. Rude.",
      compact: "{WHO} double-dings.",
    },
    {
      mode: "MARIO",
      headline: "{WHO} IS ON A TEAR.",
      subline: "Two levels. Half an hour. The board noticed.",
      compact: "{WHO} — two levels fast.",
    },
  ],
  MILESTONE: [
    {
      mode: "HYPE",
      headline: "FIRST TO {level}.",
      subline: "{WHO} hits the milestone. The pack can keep staring.",
      compact: "{WHO} first to {level}.",
    },
    {
      mode: "MOCK",
      headline: "{WHO} — FIRST TO {level}.",
      subline: "A checkpoint. A statement. A problem for everyone else.",
      compact: "First to {level}: {WHO}.",
    },
  ],
  LEGACY_DING: [
    {
      mode: "MOCK",
      headline: "A LEGACY HAS BEEN FORGED.",
      subline: "{WHO} hit Legacy Level {level}. Apparently we're doing this properly now.",
      compact: "Legacy L{level} — {WHO}.",
    },
    {
      mode: "HYPE",
      headline: "LEGACY LEVEL {level}.",
      subline: "{WHO} crosses an official Forever Legacy threshold.",
      compact: "{WHO} · Legacy L{level}.",
    },
    {
      mode: "WOW",
      headline: "LEVEL {level}.",
      subline: "The Legacy has begun — {WHO}.",
      compact: "Legacy ding · {WHO} · {level}.",
    },
  ],
  LEGACY_PROF: [
    {
      mode: "DRY",
      headline: "THE LONG GAME.",
      subline: "{WHO} reached {profession} {level}. Official Legacy tradeskill milestone.",
      compact: "Legacy · {WHO} · {profession} {level}.",
    },
    {
      mode: "MARIO",
      headline: "LEGACY MILESTONE.",
      subline: "{WHO} · {profession} {level}. The craft bar just became lore.",
      compact: "{profession} {level} — {WHO}.",
    },
  ],
  LEAD_CHANGE: [
    {
      mode: "HYPE",
      headline: "NEW LEADER.",
      subline: "{WHO} takes the lead. Please form an orderly queue for the excuses.",
      compact: "{WHO} takes the lead.",
    },
    {
      mode: "MARIO",
      headline: "{WHO} HAS ESCAPED.",
      subline: "The lead changes hands. Eyes on the board.",
      compact: "{WHO} steals the lead.",
    },
    {
      mode: "MOCK",
      headline: "{WHO} TAKES THE LEAD.",
      subline: "A dangerous new chapter. Or a brief misunderstanding. Time will tell.",
      compact: "Lead → {WHO}.",
    },
  ],
  COMEBACK: [
    {
      mode: "HYPE",
      headline: "COMEBACK ENERGY.",
      subline: "{WHO} clawed back {levels} levels. The chase is real.",
      compact: "{WHO} claws back +{levels}.",
    },
    {
      mode: "MARIO",
      headline: "{WHO} IS CLIMBING.",
      subline: "+{levels} recovered. Someone's weekend just got interesting.",
      compact: "{WHO} +{levels} catch-up.",
    },
  ],
  DEATH: [
    {
      mode: "DEADPAN",
      headline: "DEATH.",
      subline: "{WHO} has left this world. Briefly.",
      compact: "{WHO} died.",
    },
    {
      mode: "WOW",
      headline: "THE SPIRITS CLAIM ANOTHER.",
      subline: "{WHO} discovered Release Spirit. Again.",
      compact: "{WHO} — Release Spirit.",
    },
    {
      mode: "DRY",
      headline: "{WHO} HAS FALLEN.",
      subline: "A traditional part of the leveling experience.",
      compact: "{WHO} fell.",
    },
  ],
  DEATH_STACK: [
    {
      mode: "DRY",
      headline: "{WHO} HAS DIED {deaths} TIMES.",
      subline: "Someone ask what happened. Or don't. The number speaks.",
      compact: "{WHO} ×{deaths} deaths.",
    },
    {
      mode: "MOCK",
      headline: "{deaths} DEATHS FOR {WHO}.",
      subline: "The graveyard has a frequent flyer.",
      compact: "{WHO} — {deaths} deaths.",
    },
  ],
  MULTI_DEATH: [
    {
      mode: "CHAOS",
      headline: "OH.",
      subline: "{WHO} is on a death spree — {deaths} in 20 minutes.",
      compact: "{WHO} death spree ×{deaths}.",
    },
    {
      mode: "DEADPAN",
      headline: "DEATH SPREE.",
      subline: "{WHO}: {deaths} deaths in twenty minutes. Handle it!",
      compact: "{WHO} — {deaths} deaths / 20m.",
    },
    {
      mode: "WOW",
      headline: "MANY WHELPS! HANDLE IT!",
      subline: "…except {WHO} did not. {deaths} deaths.",
      compact: "{WHO} ×{deaths} — many whelps.",
    },
  ],
  CORPSE_RUN: [
    {
      mode: "DRY",
      headline: "{WHO} TAKES THE SCENIC ROUTE.",
      subline: "Corpse run: {duration}.",
      compact: "{WHO} corpse run {duration}.",
    },
    {
      mode: "DEADPAN",
      headline: "THE LONG WALK CONTINUES.",
      subline: "{WHO} · {duration}. Someone should probably tell them.",
      compact: "Corpse · {WHO} · {duration}.",
    },
    {
      mode: "WOW",
      headline: "SPIRIT HEALER CAN WAIT.",
      subline: "{WHO} walked it — {duration}.",
      compact: "{WHO} walked {duration}.",
    },
  ],
  LEVEL_STUCK: [
    {
      mode: "DRY",
      headline: "STILL LEVEL {level}.",
      subline: "{WHO} remains committed to the bit.",
      compact: "{WHO} still {level}.",
    },
    {
      mode: "DEADPAN",
      headline: "{WHO} IS STUCK AT {level}.",
      subline: "The board has questions. The ding has not arrived.",
      compact: "{WHO} stuck at {level}.",
    },
  ],
  LEVEL_STALL: [
    {
      mode: "DRY",
      headline: "{hours} HOURS. STILL LEVEL {level}.",
      subline: "{WHO} has officially entered performance art.",
      compact: "{hours}h. Still {level}. {who}.",
    },
    {
      mode: "DEADPAN",
      headline: "{WHO} IS STILL LEVEL {level}.",
      subline: "{level}. A very committed number. {hours} hours without a ding.",
      compact: "{WHO} still {level} · {hours}h dry.",
    },
    {
      mode: "MOCK",
      headline: "LEVEL {level}: THE {WHO} ERA CONTINUES.",
      subline: "{hours} hours without a ding. Respectfully: how?",
      compact: "{WHO} · L{level} · {hours}h stall.",
    },
    {
      mode: "DRY",
      headline: "{WHO} HAS NOT MOVED.",
      subline: "Still {level}. The world has. ({hours}h)",
      compact: "{WHO} parked at {level} ({hours}h).",
    },
  ],
  TIED_RACE: [
    {
      mode: "DEADPAN",
      headline: "DEAD EVEN.",
      subline: "{names} at {level}. Nobody say anything.",
      compact: "Tied at {level} — {names}.",
    },
    {
      mode: "MOCK",
      headline: "THE RACE IS TIED.",
      subline: "{names} · level {level}. This is now uncomfortable.",
      compact: "Tie · L{level} · {names}.",
    },
  ],
  BIG_SWING: [
    {
      mode: "HYPE",
      headline: "{WHO} +{gap} LEVELS AHEAD.",
      subline: "Leads {second} {leadLevel}–{secondLevel}. This is getting rude.",
      compact: "{WHO} +{gap} · {leadLevel}–{secondLevel}.",
    },
    {
      mode: "MARIO",
      headline: "{WHO} EXTENDS THE LEAD.",
      subline: "+{gap} on {second}. Anyone planning a comeback, or should we go home?",
      compact: "{WHO} +{gap} on {second}.",
    },
    {
      mode: "DRY",
      headline: "{WHO} IS +{gap}.",
      subline: "{leadLevel}–{secondLevel} vs {second}. The gap has opinions.",
      compact: "{WHO} leads by {gap}.",
    },
  ],
  NEW_LEADER: [
    {
      mode: "DRY",
      headline: "{WHO} LEADS.",
      subline: "{detail}",
      compact: "{WHO} leads.",
    },
    {
      mode: "HYPE",
      headline: "{WHO} IS AHEAD.",
      subline: "{detail}",
      compact: "Lead: {WHO}.",
    },
  ],
  PROFESSION: [
    {
      mode: "MARIO",
      headline: "CRAFTING CHAOS.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "DRY",
      headline: "PROFESSION UPDATE.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  LOOT: [
    {
      mode: "HYPE",
      headline: "OOOH. SHINY.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "MARIO",
      headline: "LOOT DROP.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  PVP: [
    {
      mode: "HYPE",
      headline: "WORLD PVP.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "WOW",
      headline: "BLOOD ON THE MAP.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  OFFLINE: [
    {
      mode: "DRY",
      headline: "{WHO} WENT OFFLINE.",
      subline: "The board will wait. It always does.",
      compact: "{WHO} offline.",
    },
  ],
  CATCH_UP: [
    {
      mode: "HYPE",
      headline: "BACK ON THE BOARD.",
      subline: "{WHO} joined the watch.",
      compact: "{WHO} joined watch.",
    },
  ],
  GATHERING: [
    {
      mode: "HYPE",
      headline: "SAME ZONE.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "WOW",
      headline: "THE PARTY PILES IN.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "DRY",
      headline: "TOGETHER.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  EXPLORATION: [
    {
      mode: "DRY",
      headline: "ZONE CHANGE.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "WOW",
      headline: "THE MAP EXPANDS.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  AWARD: [
    {
      mode: "MOCK",
      headline: "MOMENT.",
      subline: "{text}",
      compact: "{text}",
    },
    {
      mode: "DRY",
      headline: "NOTED.",
      subline: "{text}",
      compact: "{text}",
    },
  ],
  STATUS: [
    {
      mode: "DRY",
      headline: "{text}",
      subline: null,
      compact: "{text}",
    },
  ],
};

/**
 * @param {object} activity
 * @param {{ compact?: boolean }} [opts]
 * @returns {{ headline: string, subline: string|null, compact: string, category: string, mode: string, honesty: string }}
 */
export function announceFromActivity(activity, opts = {}) {
  const facts = parseActivityFacts(activity);
  let bucket = facts.category || "STATUS";
  if (bucket === "DING" && facts.first) bucket = "DING_FIRST";
  if (bucket === "DING" && facts.double) bucket = "DING_DOUBLE";
  if (bucket === "DEATH" && facts.deaths != null && facts.deaths >= 5) bucket = "DEATH_STACK";

  const templates = TEMPLATES[bucket] || TEMPLATES.STATUS;
  const seed = `${activity.kind || ""}|${activity.ts || ""}|${activity.character || ""}|${activity.text || ""}|${bucket}`;
  const t = pick(templates, seed) || TEMPLATES.STATUS[0];

  const vars = {
    who: facts.who || "Someone",
    WHO: facts.WHO || "SOMEONE",
    level: facts.level != null ? facts.level : "",
    hours: facts.hours != null ? facts.hours : "",
    deaths: facts.deaths != null ? facts.deaths : "",
    levels: facts.levels != null ? facts.levels : "",
    duration: facts.duration || "",
    profession: facts.profession || "",
    text: facts.text || "",
  };

  const blob = `${t.headline || ""}${t.subline || ""}${t.compact || ""}`;
  const needs = {
    level: /\{level\}/.test(blob),
    hours: /\{hours\}/.test(blob),
    deaths: /\{deaths\}/.test(blob),
    levels: /\{levels\}/.test(blob),
    duration: /\{duration\}/.test(blob),
    profession: /\{profession\}/.test(blob),
  };
  for (const [key, required] of Object.entries(needs)) {
    if (required && (vars[key] === "" || vars[key] == null)) {
      const raw = String(activity.text || "Something happened.").trim();
      return {
        headline: opts.compact ? raw : raw.toUpperCase(),
        subline: null,
        compact: raw,
        category: bucket,
        mode: "DRY",
        honesty: "observed",
      };
    }
  }

  const headline = fill(t.headline, vars);
  const subline = t.subline ? fill(t.subline, vars) : null;
  const compact = fill(t.compact || t.headline, vars);

  return {
    headline: String(headline || facts.text || "").trim(),
    subline: subline ? String(subline).trim() : null,
    compact: String(compact || headline || facts.text || "").trim(),
    category: bucket,
    mode: t.mode || "DRY",
    honesty: activity.kind === "MOMENT" ? "derived" : "observed",
  };
}

/**
 * Voice a race_pulse payload using the same template system.
 * @param {object} pulse from buildRacePulse
 */
export function announceRacePulse(pulse) {
  if (!pulse || pulse.kind === "WAITING" || !pulse.headline) {
    return pulse;
  }
  const seed = `${pulse.kind}|${pulse.leader || ""}|${pulse.gap ?? ""}|${pulse.detail || ""}`;
  const who = pulse.leader ? upperWho(pulse.leader) : "SOMEONE";
  const whoShort = pulse.leader ? whoOf(pulse.leader) : "Someone";

  if (pulse.kind === "TIED_RACE") {
    const t = pick(TEMPLATES.TIED_RACE, seed);
    const detail = String(pulse.detail || "");
    const m = detail.match(/^(.*?)\s+at\s+(\d+)\s*$/i);
    const names = m ? m[1] : detail;
    const level = m ? m[2] : "";
    return {
      ...pulse,
      headline: fill(t.headline, {}),
      detail: fill(t.subline, { names, level }),
      announce: { category: "TIED_RACE", mode: t.mode, honesty: "derived" },
    };
  }

  if (pulse.kind === "BIG_SWING") {
    const t = pick(TEMPLATES.BIG_SWING, seed);
    const detail = String(pulse.detail || "");
    const m = detail.match(/Leads\s+(\S+)\s+(\d+)[–\-](\d+)/i);
    const second = m ? m[1] : "the pack";
    const leadLevel = m ? m[2] : "";
    const secondLevel = m ? m[3] : "";
    const gap = pulse.gap;
    if (gap == null || leadLevel === "" || secondLevel === "") return pulse;
    return {
      ...pulse,
      headline: fill(t.headline, { WHO: who, gap }),
      detail: fill(t.subline, {
        WHO: who,
        who: whoShort,
        gap,
        second,
        leadLevel,
        secondLevel,
      }),
      announce: { category: "BIG_SWING", mode: t.mode, honesty: "derived" },
    };
  }

  if (pulse.kind === "LEAD_CHANGED") {
    const t = pick(TEMPLATES.LEAD_CHANGE, seed);
    return {
      ...pulse,
      headline: fill(t.headline, { WHO: who }),
      detail: fill(t.subline, { WHO: who, who: whoShort }) || pulse.detail,
      announce: { category: "LEAD_CHANGE", mode: t.mode, honesty: "derived" },
    };
  }

  if (pulse.kind === "NEW_LEADER") {
    const gap = pulse.gap;
    const detail =
      gap > 0
        ? `${whoShort} +${gap} level${gap > 1 ? "s" : ""} ahead. Eyes up.`
        : `Level watch continues.`;
    const t = pick(TEMPLATES.NEW_LEADER, seed);
    return {
      ...pulse,
      headline: fill(t.headline, { WHO: who }),
      detail: fill(t.subline, { WHO: who, detail }) || detail,
      announce: { category: "NEW_LEADER", mode: t.mode || "DRY", honesty: "derived" },
    };
  }

  return pulse;
}

/**
 * Attach announce { headline, subline, compact, category } onto activity rows.
 */
export function decorateActivityAnnouncements(activity = []) {
  return (activity || []).map((a) => {
    const voiced = announceFromActivity(a, { compact: true });
    return {
      ...a,
      announce: {
        headline: voiced.headline,
        subline: voiced.subline,
        compact: voiced.compact,
        category: voiced.category,
        mode: voiced.mode,
        honesty: voiced.honesty,
      },
    };
  });
}

/**
 * Build sticky hero payload from a scored activity candidate.
 */
export function announceHeadline(candidate, opts = {}) {
  if (!candidate?.text && !candidate?.kind) {
    const fallback = opts.fallback || "THE RACE CONTINUES";
    return {
      text: fallback,
      subline: "Vanilla leveling weekend. The board is watching.",
      score: 10,
      ts: opts.ts || new Date().toISOString(),
      kind: "STATUS",
      category: "STATUS",
      mode: "DRY",
    };
  }
  const voiced = announceFromActivity(
    {
      kind: candidate.kind,
      text: candidate.sourceText || candidate.text,
      character: candidate.character,
      ts: candidate.ts,
    },
    opts
  );
  return {
    text: voiced.headline,
    subline: voiced.subline,
    score: candidate.score ?? 0,
    ts: candidate.ts,
    kind: candidate.kind,
    category: voiced.category,
    mode: voiced.mode,
    character: candidate.character || null,
  };
}
