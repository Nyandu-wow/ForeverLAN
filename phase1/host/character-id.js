/**
 * Character name helpers for the one-weekend LAN board.
 *
 * Forever names are always "First Last"; the full name (or GUID) is the identity.
 * Combat-log names arrive as "First-Realm-" with no surname, so they can only
 * attach through a GUID — never by matching the first word of a full name.
 * GUID-keyed identity and name-stub reconciliation live in LanSession only.
 *
 * Explicit roster aliases (Casey → Casey Brook) are the only bare-first-name
 * bridge — never invent Alex → Alex River (multiple Alex alts).
 */

/** Exact identity key: full name, realm suffix stripped, case-folded. */
export function fullNameKey(raw) {
  return String(raw || "")
    .trim()
    .split("-")[0]
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Roster entries without a surname cannot identify a Forever character. */
export function isFullName(raw) {
  return /\S\s+\S/.test(String(raw || "").split("-")[0].trim());
}

/**
 * Map a raw name to a roster identity key.
 * Exact full-name hit first; then explicit aliases only (never fuzzy first-token).
 * @param {string} raw
 * @param {Set<string>} rosterKeys lower-case fullNameKey set
 * @param {Map<string, string>|Record<string, string>} [aliases] bare → full display name
 * @returns {string|null} roster key (lower-case) or null
 */
export function resolveRosterKey(raw, rosterKeys, aliases = null) {
  const key = fullNameKey(raw);
  if (!key) return null;
  if (rosterKeys instanceof Set ? rosterKeys.has(key) : rosterKeys?.has?.(key)) return key;
  if (!aliases) return null;
  const aliasTarget =
    aliases instanceof Map ? aliases.get(key) : aliases[key] || aliases[fullNameKey(key)];
  if (!aliasTarget) return null;
  const resolved = fullNameKey(aliasTarget);
  if (!resolved) return null;
  if (rosterKeys instanceof Set ? rosterKeys.has(resolved) : rosterKeys?.has?.(resolved)) {
    return resolved;
  }
  return null;
}

/** Build a lower-case alias map from config / defaults. */
export function aliasMapFrom(aliases) {
  const out = new Map();
  if (!aliases) return out;
  const entries =
    aliases instanceof Map
      ? aliases.entries()
      : Object.entries(aliases);
  for (const [from, to] of entries) {
    const a = fullNameKey(from);
    const b = String(to || "").trim();
    if (a && b) out.set(a, b);
  }
  return out;
}

export function preferDisplayName(current, next) {
  const a = cleanName(current);
  const b = cleanName(next);
  if (!b) return a || null;
  if (!a) return b;
  return b.length > a.length ? b : a;
}

/** Drop placeholder names the addon sometimes emits before UnitName resolves. */
export function cleanName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^(unknown|nil|none|player)$/i.test(s)) return "";
  return s;
}
