/**
 * Mirrors ForeverLAN.lua queue-cap trim (MAX_PENDING + DROP_UNDER_PRESSURE).
 * Keep in sync with addon local MAX_PENDING / DROP_UNDER_PRESSURE / trimPendingOverCap /
 * pruneFlushedLowValuePending.
 */

export const MAX_PENDING = 1500;
export const QUEUE_SOFT_WARN = 1200;

/** Types dropped before high-signal events when over cap. */
export const DROP_UNDER_PRESSURE = new Set([
  "PLAYER_DISTANCE",
  "PLAYER_FOOD_BUFF",
  "PLAYER_MAP_OPENED",
  "PLAYER_POWER_STATS",
  "PLAYER_MONEY",
  "PLAYER_QUESTS",
  "PLAYER_PROFESSIONS",
  "PLAYER_COMBAT_TIME",
  "PLAYER_CRAFT",
  "PING",
  "WORLD_ENTER",
  "POSITION_UPDATE",
]);

/** Snapshot/cumulative streams merged in-place by ForeverLAN.lua enqueue(). Not crafts. */
export const COALESCE_PENDING = new Set([
  "PLAYER_DISTANCE",
  "PLAYER_FOOD_BUFF",
  "PLAYER_MAP_OPENED",
  "PLAYER_POWER_STATS",
  "PLAYER_MONEY",
  "PLAYER_QUESTS",
  "PLAYER_PROFESSIONS",
  "PLAYER_COMBAT_TIME",
  "PING",
  "WORLD_ENTER",
  "POSITION_UPDATE",
]);

/**
 * Mirror addon enqueue coalesce: update latest unflushed row; remint after Push.
 * @param {Array<Record<string, unknown>>} pending
 * @param {string} type
 * @param {Record<string, unknown>} fields
 * @param {{ flushedAt?: number, nowTs?: number }} [opts]
 * @returns {{ pending: typeof pending, event: Record<string, unknown>, coalesced: boolean }}
 */
export function coalescePending(pending, type, fields = {}, opts = {}) {
  const list = Array.isArray(pending) ? pending.slice() : [];
  const flushedAt = Number(opts.flushedAt) || 0;
  const nowTs = Number(opts.nowTs) || Number(fields.ts) || Date.now() / 1000;
  if (!COALESCE_PENDING.has(type)) {
    const event = { v: 1, type, ...fields };
    list.push(event);
    return { pending: list, event, coalesced: false };
  }
  const guid = fields.guid;
  const mapKind = fields.map_kind;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ev = list[i];
    if (!ev || ev.type !== type || ev.guid !== guid) continue;
    if (type === "PLAYER_MAP_OPENED" && ev.map_kind !== mapKind) continue;
    const evTs = Number(ev.ts) || 0;
    if (flushedAt > 0 && evTs <= flushedAt) break;
    const merged = { ...ev, ...fields, ts: nowTs };
    list[i] = merged;
    return { pending: list, event: merged, coalesced: true };
  }
  const event = { v: 1, type, ts: nowTs, ...fields };
  list.push(event);
  return { pending: list, event, coalesced: false };
}

/**
 * @param {Array<{ id?: string, type?: string }>} pending
 * @param {number} [maxPending]
 * @returns {{ pending: typeof pending, dropped: typeof pending }}
 */
export function trimPendingOverCap(pending, maxPending = MAX_PENDING) {
  const list = Array.isArray(pending) ? pending.slice() : [];
  const dropped = [];
  while (list.length > maxPending) {
    let dropIdx = list.findIndex((ev) => ev && DROP_UNDER_PRESSURE.has(ev.type));
    if (dropIdx < 0) dropIdx = 0;
    dropped.push(list.splice(dropIdx, 1)[0]);
  }
  return { pending: list, dropped };
}

/** Mirror addon: after Push, drop all flushed low-value noise (export still holds them). */
export function pruneFlushedLowValuePending(pending, flushedAt, _softWarnUnused) {
  const list = Array.isArray(pending) ? pending.slice() : [];
  const dropped = [];
  if (!(flushedAt > 0) || list.length === 0) return { pending: list, dropped };
  let i = 0;
  while (i < list.length) {
    const ev = list[i];
    const ts = Number(ev?.ts) || 0;
    if (ev && DROP_UNDER_PRESSURE.has(ev.type) && ts <= flushedAt) {
      dropped.push(list.splice(i, 1)[0]);
    } else {
      i += 1;
    }
  }
  return { pending: list, dropped };
}

export function pendingFullyFlushedToDisk(pending, flushedAt) {
  if (!(flushedAt > 0) || !Array.isArray(pending) || pending.length === 0) return false;
  return pending.every((ev) => (Number(ev?.ts) || 0) <= flushedAt);
}
