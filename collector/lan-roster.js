/**
 * Remembered LAN characters. Forever names are always "First Last".
 * Exact full-name match is the identity rule.
 *
 * Product defaults are empty — weekend names come from:
 *   - host/collector `config.json` → `lanRoster` / `lanRosterAliases` / `lanBoardExclude`
 *   - friend INSTALL packs → `ForeverLAN_Party.lua` (injected at pack build)
 *   - CurseForge addon → empty; players use `/fl remember First Last`
 *
 * Bare first-name aliases are explicit and only for friends whose Forever
 * surname is known but UnitName/party often reports the first token only.
 * Never alias a first name that has multiple Forever alts on the weekend.
 */
export const DEFAULT_LAN_ROSTER = [];

/** Bare first name → canonical Forever full name (keys are lower-case). */
export const DEFAULT_LAN_ROSTER_ALIASES = {};

/** Bank / throwaway alts that must never occupy the race board. */
export const DEFAULT_BOARD_EXCLUDE = [];
