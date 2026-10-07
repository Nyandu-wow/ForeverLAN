/**
 * Generic demo roster for tests / simulator.
 * Weekend identity stays in local config.json + ForeverLAN_Party.local.lua.
 */
export const FIXTURE_LAN_ROSTER = [
  "Alex River",
  "Sam Hill",
  "Jordan Vale",
  "Casey Brook",
];

/** Bare first name → Forever full name (keys lower-case). */
export const FIXTURE_LAN_ROSTER_ALIASES = {
  sam: "Sam Hill",
  jordan: "Jordan Vale",
  casey: "Casey Brook",
  // No "alex" alias — multiple Alex alts (River / Brook / Vale / Ford).
};

/** Optional board excludes for tests (empty unless a test sets its own). */
export const FIXTURE_BOARD_EXCLUDE = [];

/** Convenient demo identities used by smokes (multi-alt + bank). */
export const DEMO = {
  alex: "Alex River",
  alexAlt: "Alex Brook",
  alexAlt2: "Alex Vale",
  alexAlt3: "Alex Ford",
  alexBare: "Alex",
  sam: "Sam Hill",
  samBare: "Sam",
  jordan: "Jordan Vale",
  jordanBare: "Jordan",
  casey: "Casey Brook",
  caseyBare: "Casey",
  bank: "Bank Alt",
};
