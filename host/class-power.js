/**
 * Class-aware combat power — only surface stats that match the character's role.
 * Raw PLAYER_POWER_STATS may include AP on casters (WoW still tracks it); we don't show it.
 */

/** @param {string|null|undefined} cls */
export function normalizeClass(cls) {
  return String(cls || "").trim().toUpperCase();
}

export function isPhysicalMeleeClass(cls) {
  const c = normalizeClass(cls);
  return c === "WARRIOR" || c === "ROGUE";
}

export function isRangedPhysicalClass(cls) {
  return normalizeClass(cls) === "HUNTER";
}

export function isSpellPowerClass(cls) {
  const c = normalizeClass(cls);
  return (
    c === "MAGE" ||
    c === "WARLOCK" ||
    c === "PRIEST" ||
    c === "PALADIN" ||
    c === "SHAMAN" ||
    c === "DRUID"
  );
}

export function isHealerClass(cls) {
  const c = normalizeClass(cls);
  return c === "PRIEST" || c === "PALADIN" || c === "SHAMAN" || c === "DRUID";
}

function numGt0(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {{ class?: string, attack_power?: number|null, ranged_attack_power?: number|null, spell_power?: number|null, spell_healing?: number|null }} p
 */
export function relevantPowerStats(p) {
  const cls = p?.class;
  const ap = numGt0(p?.attack_power);
  const rap = numGt0(p?.ranged_attack_power);
  const sp = numGt0(p?.spell_power);
  const heal = numGt0(p?.spell_healing);

  // RAP is hunter-only. Warriors/rogues get melee AP; casters get SP (+ healing for healers).
  if (isPhysicalMeleeClass(cls)) {
    return { attack_power: ap, ranged_attack_power: null, spell_power: null, spell_healing: null };
  }
  if (isRangedPhysicalClass(cls)) {
    return {
      attack_power: null,
      ranged_attack_power: rap ?? ap,
      spell_power: null,
      spell_healing: null,
    };
  }
  if (isSpellPowerClass(cls)) {
    return {
      attack_power: null,
      ranged_attack_power: null,
      spell_power: sp,
      spell_healing: isHealerClass(cls) ? heal : null,
    };
  }
  // Unknown class: never invent RAP — prefer SP if present, else melee AP.
  if (sp != null && (ap == null || sp >= ap)) {
    return { attack_power: null, ranged_attack_power: null, spell_power: sp, spell_healing: heal };
  }
  return { attack_power: ap, ranged_attack_power: null, spell_power: null, spell_healing: null };
}

export function hasRelevantPower(p) {
  const r = relevantPowerStats(p);
  return !!(
    r.attack_power ||
    r.ranged_attack_power ||
    r.spell_power ||
    r.spell_healing
  );
}

/** Activity feed / ingest log lines. */
export function formatPowerActivityLabel(p) {
  const r = relevantPowerStats(p);
  const bits = [];
  if (r.attack_power != null) bits.push(`AP ${r.attack_power}`);
  if (r.ranged_attack_power != null) bits.push(`RAP ${r.ranged_attack_power}`);
  if (r.spell_power != null) bits.push(`SP ${r.spell_power}`);
  if (r.spell_healing != null) bits.push(`+healing ${r.spell_healing}`);
  return bits.join(" · ");
}
