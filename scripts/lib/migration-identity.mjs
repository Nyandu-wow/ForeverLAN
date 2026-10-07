/**
 * Mirrors ForeverLAN.lua conservative legacy-migration identity rules (schema 3).
 * Keep in sync with eventSafelyBelongsToPlayer / bucketSafelyBelongsToPlayer / charKeyFromParts.
 */

function normalizeRealm(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, "").toLowerCase();
}

function namesEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Forever-safe char key — full name (+ realm), never bare first name alone. */
export function charKeyFromParts(fullName, realm) {
  if (typeof fullName !== "string" || !fullName) return null;
  if (typeof realm === "string" && realm) return `${fullName}-${realm}`;
  return fullName;
}

/**
 * @param {object} player
 * @param {string} [player.guid]
 * @param {string} player.fullName
 * @param {string} [player.firstName]
 * @param {string} [player.lastName]
 * @param {string} [player.realm]
 * @param {string} [player.charKey]
 */
export function eventSafelyBelongsToPlayer(ev, player) {
  if (!ev || typeof ev !== "object" || !player || typeof player !== "object") return false;

  // A different GUID is a different character, even under the same full name.
  if (typeof ev.guid === "string" && ev.guid && player.guid) {
    return ev.guid === player.guid;
  }

  const evChar = ev.character;
  if (typeof evChar !== "string" || !evChar) return false;
  if (!namesEqual(evChar, player.fullName)) return false;
  // Bare "Alex" must not match a surnamed live character.
  if (!/\s/.test(evChar) && player.lastName) return false;

  const evRealm = normalizeRealm(ev.realm);
  const pRealm = normalizeRealm(player.realm);
  if (evRealm && pRealm && evRealm !== pRealm) return false;
  return true;
}

export function bucketSafelyBelongsToPlayer(bucketKey, player) {
  if (typeof bucketKey !== "string" || !bucketKey || !player) return false;
  if (bucketKey === "__legacy__") return false;
  if (player.charKey && namesEqual(bucketKey, player.charKey)) return true;
  if (namesEqual(bucketKey, player.fullName)) {
    if (!/\s/.test(bucketKey) && !/-/.test(bucketKey) && player.lastName) return false;
    return true;
  }
  if (player.fullName && player.realm) {
    const alt = `${player.fullName}-${player.realm}`;
    if (namesEqual(bucketKey, alt)) return true;
  }
  return false;
}

/** Simulate one character's migrate/reclaim pass over account ForeverLANDB → CharDB pending. */
export function migrateAccountQueue(accountDb, charDb, player) {
  const db = charDb || { pending: [] };
  if (!Array.isArray(db.pending)) db.pending = [];
  const already = !!db.migrated_from_account;

  const seen = new Set(db.pending.filter((e) => e?.id).map((e) => e.id));
  function take(ev) {
    if (!ev) return;
    if (ev.id && seen.has(ev.id)) return;
    db.pending.push(ev);
    if (ev.id) seen.add(ev.id);
  }

  if (accountDb?.characters && typeof accountDb.characters === "object") {
    for (const [key, bucket] of Object.entries(accountDb.characters)) {
      if (!bucket || typeof bucket !== "object") continue;
      if (bucketSafelyBelongsToPlayer(key, player)) {
        for (const ev of Object.values(bucket.pending || {})) {
          if (ev && typeof ev === "object") take(ev);
        }
        delete accountDb.characters[key];
        continue;
      }
      // Short / foreign bucket: reclaim matching events by identity.
      const pending = bucket.pending || {};
      const values = Array.isArray(pending) ? pending : Object.values(pending);
      const keep = [];
      for (const ev of values) {
        if (!ev || typeof ev !== "object") continue;
        if (eventSafelyBelongsToPlayer(ev, player)) take(ev);
        else keep.push(ev);
      }
      if (keep.length === 0) delete accountDb.characters[key];
      else bucket.pending = keep;
    }
  }

  if (Array.isArray(accountDb?.pending)) {
    const keep = [];
    for (const ev of accountDb.pending) {
      if (eventSafelyBelongsToPlayer(ev, player)) take(ev);
      else keep.push(ev);
    }
    accountDb.pending = keep;
  }

  db.migrated_from_account = true;
  return { charDb: db, accountDb, skipped: already };
}
