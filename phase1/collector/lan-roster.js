/**
 * Remembered LAN characters. Forever names are always "First Last".
 * Exact full-name match is the identity rule.
 *
 * Bare first-name aliases are explicit and only for friends whose Forever
 * surname is known but UnitName/party often reports the first token only
 * (or older builds misfiled the surname into `realm`).
 * Never alias "Alex" — the host has multiple Alex alts.
 */
export const DEFAULT_LAN_ROSTER = [
  "Alex River",
  "Sam Hill",
  "Jordan Vale",
  "Casey Brook",
];

/** Bare first name → canonical Forever full name (keys are lower-case). */
export const DEFAULT_LAN_ROSTER_ALIASES = {
  casey: "Casey Brook",
  jordan: "Jordan Vale",
  sam: "Sam Hill",
};

/** Bank / throwaway alts that must never occupy the race board. */
export const DEFAULT_BOARD_EXCLUDE = ["Bank Alt"];
