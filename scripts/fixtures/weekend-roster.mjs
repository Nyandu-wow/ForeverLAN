/**
 * Test / simulator fixture roster.
 *
 * Loads from friend-client/ForeverLAN_Party.lua so weekend names stay out of
 * product defaults (collector/lan-roster.js) and example configs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const partyLuaPath = path.join(root, "friend-client", "ForeverLAN_Party.lua");

function parsePartyLua(text) {
  const rosterBlock = text.match(/roster\s*=\s*\{([\s\S]*?)\n\s*\},/);
  const aliasesBlock = text.match(/aliases\s*=\s*\{([\s\S]*?)\n\s*\},?\s*\n/);
  const roster = [...(rosterBlock?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const aliases = {};
  for (const m of (aliasesBlock?.[1] || "").matchAll(/([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/g)) {
    aliases[String(m[1]).toLowerCase()] = m[2];
  }
  if (!roster.length) {
    throw new Error(`No roster entries parsed from ${partyLuaPath}`);
  }
  return { roster, aliases };
}

const loaded = parsePartyLua(fs.readFileSync(partyLuaPath, "utf8"));

/** @type {string[]} */
export const FIXTURE_LAN_ROSTER = loaded.roster;

/** @type {Record<string, string>} */
export const FIXTURE_LAN_ROSTER_ALIASES = loaded.aliases;

/** Optional board excludes for tests (empty unless a test sets its own). */
export const FIXTURE_BOARD_EXCLUDE = [];
