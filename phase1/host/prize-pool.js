/**
 * Forever LAN — Mario Party prize-pool helpers.
 * Locked three-tier catalog. Rename + flavour + Wrap curation.
 * No new telemetry.
 */

/**
 * Tier A — primary Wrap prize pool (show when earned, up to ~16).
 * Independently eligible; explore awards are NOT mutually exclusive.
 */
export const TIER_A = Object.freeze([
  "LEEROY JENKINS!",
  "FOR THE GLORY OF THE RACE",
  "SECOND WIND",
  "HOGGER'S FAVORITE",
  "MANY WHELPS! HANDLE IT!",
  "ONYXIA WIPE",
  "TOO SOON!",
  "CORPSE TOURIST",
  "MORE DOTS!",
  "THE FLOOR IS LAVA",
  "WHO NEEDS A MAP?",
  "LOST IN AZEROTH",
  "BUNNY HOPPER",
  "PURPLE RAIN",
  "BLUE FINDER",
  "BROKE AS A KOBOLD",
  "QUEST GRIND: COMPLETE",
  "DING! GRATS!",
  "DING! DING! DING!",
  "THE TURTLE",
  "FIRST TO EACH LEVEL",
  "BUILDING A LEGACY",
  "THE LONG GAME",
  "PROFESSIONAL LEGACY",
]);

/**
 * Tier B — extended Live / Profession / overflow hall (not Wrap-first).
 */
export const TIER_B = Object.freeze([
  "GRIND KING",
  "RACE LEADER",
  "MISSING IN ACTION",
  "YOU ARE NOT REPAIRED",
  "HOT POTATO",
  "CLEAN STREAK",
  "DEEP POCKETS",
  "PVP CHAMPION",
  "PVP VICTIM",
  "STILL STANDING",
  "NIGHT OWL",
  "DOUBLE DIP",
  "ONE-MAN INDUSTRY",
  "CAP WATCH",
  "FIRST CLAIM",
  "SKILL STREAK",
  // Supportable profession board adds:
  "THE SPECIALIST",
  "JACK OF ALL TRADES",
  "THE FACTORY",
  "CRAFTSMAN",
  "MULTICLASS MENACE",
]);

/**
 * Tier C — future / unsupported without new telemetry.
 */
export const TIER_C = Object.freeze([
  "AFK CHAMPION OF AZEROTH",
  "YOU ARE NOT PREPARED!",
  "RUN AWAY, LITTLE GIRL!",
  "CORPSE CAMPING",
  "THUNDERFURY, BLESSED BLADE OF THE WINDSEEKER",
  "OOOH, SHINY!",
  "THE LONG WALK",
  "YOU DIED",
  "WTF JUST HAPPENED?",
  "BY FIRE BE PURGED!",
  "NOT THE BEES!",
  "BARON RUN",
  "STAY A WHILE AND LISTEN",
  "LEEEEEROY!",
  "WORKHORSE",
  "RISING STAR",
]);

const TIER_A_SET = new Set(TIER_A);

/** Wrap headline priority within Tier A (lower = sooner). */
const WRAP_PRIORITY = {
  "LEEROY JENKINS!": 10,
  "FOR THE GLORY OF THE RACE": 20,
  "SECOND WIND": 30,
  "HOGGER'S FAVORITE": 40,
  "MANY WHELPS! HANDLE IT!": 50,
  "ONYXIA WIPE": 55,
  "TOO SOON!": 60,
  "CORPSE TOURIST": 70,
  "MORE DOTS!": 80,
  "THE FLOOR IS LAVA": 90,
  "WHO NEEDS A MAP?": 100,
  "LOST IN AZEROTH": 110,
  "BUNNY HOPPER": 120,
  "PURPLE RAIN": 130,
  "BLUE FINDER": 140,
  "BROKE AS A KOBOLD": 150,
  "QUEST GRIND: COMPLETE": 160,
  "DING! GRATS!": 170,
  "DING! DING! DING!": 180,
  "THE TURTLE": 190,
  "FIRST TO EACH LEVEL": 200,
  "BUILDING A LEGACY": 205,
  "THE LONG GAME": 210,
  "PROFESSIONAL LEGACY": 215,
};

/** Explore awards — independently eligible; soft presentation cap only. */
const EXPLORE_AWARDS = new Set(["WHO NEEDS A MAP?", "LOST IN AZEROTH", "BUNNY HOPPER"]);
/** Soft Wrap presentation cap for explore (allows all three when earned). */
const EXPLORE_SOFT_CAP = 3;

/**
 * Short flavour line — joke only; never invent motives or causes.
 * @param {string} title
 * @param {{ detail?: string, character?: string|null }} award
 */
export function flavourLine(title, award = {}) {
  const who = award.character ? String(award.character).trim() : "Someone";
  switch (title) {
    case "LEEROY JENKINS!":
      return "At least somebody charged.";
    case "FOR THE GLORY OF THE RACE":
      return "The rest of the party is just scenery.";
    case "SECOND WIND":
      return "From behind. Still counting.";
    case "HOGGER'S FAVORITE":
      return "Hogger is taking this personally.";
    case "THE FLOOR IS LAVA":
      return "Azeroth's gravity sends its regards.";
    case "CORPSE TOURIST":
      return "Spirit Healer is considering a frequent-walker card.";
    case "MANY WHELPS! HANDLE IT!":
      return "Deaths stacking like whelps.";
    case "ONYXIA WIPE":
      return "Deep breaths, everyone.";
    case "TOO SOON!":
      return "Dinged. Immediately regretted it.";
    case "MORE DOTS!":
      return "Still not enough dots.";
    case "WHO NEEDS A MAP?":
      return "Tourism, Forever edition.";
    case "LOST IN AZEROTH":
      return "Somewhere between here and the next ding.";
    case "BUNNY HOPPER":
      return "Spacebar has left the chat.";
    case "MISSING IN ACTION":
      return "Logged offline. Not the same as AFK.";
    case "PURPLE RAIN":
      return "Purple text. Loud opinions.";
    case "BLUE FINDER":
      return "Blue is the new grey.";
    case "BROKE AS A KOBOLD":
      return "Can't even afford a grey.";
    case "QUEST GRIND: COMPLETE":
      return "Exclamation marks fear them.";
    case "DING! GRATS!":
      return "Grats. Now back to the grind.";
    case "DING! DING! DING!":
      return "The chat is typing grats.";
    case "THE TURTLE":
      return "Slow and steady. Mostly slow.";
    case "YOU ARE NOT REPAIRED":
      return "Illidan would be proud. Probably.";
    case "FIRST CLAIM":
      return "First new skill line of the weekend.";
    case "SKILL STREAK":
      return "The skill bar moved. A lot.";
    case "CAP WATCH":
      return "So close to the yellow.";
    case "DOUBLE DIP":
      return "Two primaries. No shame.";
    case "ONE-MAN INDUSTRY":
      return "The party's entire crafting economy.";
    case "FIRST TO EACH LEVEL":
      return "Who hit each level first — everyone starts at 1.";
    case "BUILDING A LEGACY":
      return "Verified Legacy milestones. Not points — receipts.";
    case "THE LONG GAME":
      return "Closest to the next Legacy threshold.";
    case "PROFESSIONAL LEGACY":
      return "Non-gathering crafts, official thresholds.";
    case "MULTICLASS MENACE":
      return "Class track Legacy levels observed.";
    case "HOT POTATO":
      return "The lead won't sit still.";
    case "CLEAN STREAK":
      return "Deathless. For a while.";
    case "DEEP POCKETS":
      return "Heavy coin purse.";
    case "PVP CHAMPION":
      return "World PvP said hello.";
    case "PVP VICTIM":
      return "World PvP said goodbye.";
    case "GRIND KING":
      return "Most dings. Different from a charge.";
    case "RACE LEADER":
      return "Currently on top. Enjoy it while it lasts.";
    case "STILL STANDING":
      return "Dinged. Didn't die. Yet.";
    case "NIGHT OWL":
      return "The LAN does not sleep.";
    case "THE SPECIALIST":
      return "One craft. Absolute focus.";
    case "JACK OF ALL TRADES":
      return "Skill bars everywhere.";
    case "THE FACTORY":
      return "Assembly line energy.";
    case "CRAFTSMAN":
      return "Hands never idle.";
    default:
      if (/^FIRST TO \d+$/.test(title)) return `${who} got there first.`;
      return "";
  }
}

/**
 * Attach flavour + default honesty for Wrap / Hall chips.
 * @param {object} award
 */
export function decorateAward(award) {
  if (!award?.title) return award;
  const flavour = award.flavour || flavourLine(award.title, award);
  const out = { ...award };
  if (flavour) out.flavour = flavour;
  if (!out.honesty) {
    if (out.title === "YOU ARE NOT REPAIRED") out.honesty = "inferred";
    else if (
      [
        "HOGGER'S FAVORITE",
        "MORE DOTS!",
        "WHO NEEDS A MAP?",
        "LOST IN AZEROTH",
        "BUNNY HOPPER",
        "PURPLE RAIN",
        "BLUE FINDER",
        "BROKE AS A KOBOLD",
        "QUEST GRIND: COMPLETE",
        "DING! GRATS!",
        "DOUBLE DIP",
        "GRIND KING",
      ].includes(out.title) ||
      /^FIRST TO \d+$/.test(out.title)
    ) {
      out.honesty = "observed";
    } else {
      out.honesty = "derived";
    }
  }
  return out;
}

/**
 * Curate Wrap headline awards from Tier A only.
 * Picks strongest earned awards up to `limit` — never pads / fills.
 * Explore awards are independently eligible (soft presentation cap only).
 * @param {object[]} hall
 * @param {number} [limit]
 */
export function curateWrapHall(hall, limit = 16) {
  const list = (hall || []).map(decorateAward);
  const firstLevels = list.find((a) => a.title === "FIRST TO EACH LEVEL");

  // Tier A only. Milestones like FIRST TO 10 stay on records / Live, not Wrap stage.
  const rest = list.filter(
    (a) =>
      a.title !== "FIRST TO EACH LEVEL" &&
      TIER_A_SET.has(a.title) &&
      !/^FIRST TO \d+$/.test(a.title)
  );

  rest.sort((a, b) => {
    const pa = WRAP_PRIORITY[a.title] ?? 500;
    const pb = WRAP_PRIORITY[b.title] ?? 500;
    if (pa !== pb) return pa - pb;
    return String(b.detail || "").length - String(a.detail || "").length;
  });

  const picked = [];
  const seenTitles = new Set();
  let exploreCount = 0;
  const slotBudget = Math.max(0, limit - (firstLevels ? 1 : 0));

  for (const a of rest) {
    if (picked.length >= slotBudget) break;
    if (seenTitles.has(a.title)) continue;
    if (EXPLORE_AWARDS.has(a.title)) {
      if (exploreCount >= EXPLORE_SOFT_CAP) continue;
      exploreCount += 1;
    }
    seenTitles.add(a.title);
    picked.push(a);
  }

  // Only append FIRST TO EACH LEVEL if it was actually earned — never as filler.
  if (firstLevels && picked.length < limit) picked.push(firstLevels);
  return picked;
}

/**
 * Find shortest ding → death interval for TOO SOON!
 * @returns {{ character: string, seconds: number, fromLevel?: number } | null}
 */
export function findTooSoon(players) {
  let best = null;
  for (const p of players || []) {
    if (!p?.character) continue;
    const dings = (p.ding_times || [])
      .map((t) => new Date(t).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const deaths = (p.death_times || [])
      .map((t) => new Date(t).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!dings.length || !deaths.length) continue;
    for (const ding of dings) {
      for (const death of deaths) {
        const delta = death - ding;
        if (delta < 30 * 1000 || delta > 10 * 60 * 1000) continue;
        const seconds = Math.round(delta / 1000);
        if (!best || seconds < best.seconds) {
          best = {
            character: p.character,
            seconds,
            ding_at: new Date(ding).toISOString(),
            death_at: new Date(death).toISOString(),
          };
        }
      }
    }
  }
  return best;
}

/**
 * Multi-player death cluster — ONYXIA WIPE.
 * @returns {{ characters: string[], windowSeconds: number, ts: number } | null}
 */
export function findOnyxiaWipe(players, minChars = 3, windowMs = 90 * 1000) {
  /** @type {{ character: string, ts: number }[]} */
  const events = [];
  for (const p of players || []) {
    if (!p?.character) continue;
    for (const t of p.death_times || []) {
      const ms = new Date(t).getTime();
      if (!Number.isFinite(ms)) continue;
      events.push({ character: p.character, ts: ms });
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  let best = null;
  for (let i = 0; i < events.length; i++) {
    const chars = new Set();
    let j = i;
    while (j < events.length && events[j].ts - events[i].ts <= windowMs) {
      chars.add(events[j].character);
      j++;
    }
    if (chars.size >= minChars) {
      const windowSeconds = Math.round((events[j - 1].ts - events[i].ts) / 1000);
      if (!best || chars.size > best.characters.length || windowSeconds < best.windowSeconds) {
        best = {
          characters: [...chars],
          windowSeconds,
          ts: events[i].ts,
        };
      }
    }
  }
  return best;
}
