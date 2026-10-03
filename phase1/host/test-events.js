/**
 * One definition of "test traffic" for ingest, the LanSession fold, and raw log views.
 *
 * - Smoke probes: never stored (path check only).
 * - Load-test rows: stored on purpose (rebuild/throughput stress) but never drive the board.
 *
 * host-events.jsonl is append-only, so rows that slipped in before this filter existed
 * (e.g. catchup-smoke-*) are skipped by the fold instead of being rewritten.
 */

const SMOKE_SOURCES = new Set(["smoke"]);
const LOADTEST_SOURCES = new Set(["loadtest"]);
const SMOKE_ID_PREFIXES = ["smoke-", "catchup-smoke-"];
const LOADTEST_ID_PREFIXES = ["loadtest-"];

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

/** Path-test POSTs: acknowledge with 200, do not persist. */
export function isSmokeProbe(ev) {
  if (!ev) return false;
  if (SMOKE_SOURCES.has(lower(ev.source))) return true;
  const id = lower(ev.id);
  if (SMOKE_ID_PREFIXES.some((p) => id.startsWith(p))) return true;
  return lower(ev.character) === "smokefriend";
}

/** Any synthetic test row — excluded from the board, catalog, sessions, and timeline. */
export function isTestEvent(ev) {
  if (!ev) return false;
  if (isSmokeProbe(ev)) return true;
  if (LOADTEST_SOURCES.has(lower(ev.source))) return true;
  const id = lower(ev.id);
  return LOADTEST_ID_PREFIXES.some((p) => id.startsWith(p));
}
