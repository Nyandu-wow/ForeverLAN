/**
 * Cheap reads over the published LanSession board.
 * Does not fold events. Does not mutate the board.
 * Caches catalog + per-character event-log slices until board_version changes.
 */

import { catalogFromLanState } from "./board-catalog.js";
import { characterSessions, characterTimeline, sessionFactsFromBoard } from "./analytics.js";

export function createBoardReads() {
  let version = 0;
  let catalogEntry = null;
  /** @type {Map<string, object>} */
  const detailCache = new Map();

  function invalidate(nextVersion) {
    version = Number(nextVersion) || 0;
    catalogEntry = null;
    detailCache.clear();
  }

  function catalog(state, eventCount) {
    if (catalogEntry && catalogEntry.version === version) return catalogEntry.body;
    const board = catalogFromLanState(state);
    const allow = (state?.players || [])
      .filter((p) => p?.character)
      .map((p) => ({ guid: p.guid || null, character: p.character }));
    const body = {
      ...board,
      event_count: eventCount,
      roster: allow.map((a) => a.character),
      generated_at: new Date().toISOString(),
      board_version: version,
      // Host IANA zone for Explore clocks (Timeline/Deaths) without a second /lan fetch.
      display_time_zone: state?.meta?.display_time_zone || null,
    };
    catalogEntry = { version, body };
    return body;
  }

  function characterDetail(state, events, { name = "", guid = "" } = {}) {
    const board = catalog(state, events?.length || 0);
    const profile = board.characters.find((c) => {
      if (guid && c.guid) return c.guid === guid;
      return c.character === name;
    });
    if (!profile) return null;
    const key = `${version}|${profile.guid || ""}|${profile.character}`;
    const hit = detailCache.get(key);
    if (hit) return hit;

    const allow = (state?.players || [])
      .filter((p) => p?.character)
      .map((p) => ({ guid: p.guid || null, character: p.character }));
    const deaths = board.deaths.filter((d) =>
      profile.guid && d.guid ? d.guid === profile.guid : d.character === profile.character
    );
    const livePlayer = (state.players || []).find((p) =>
      profile.guid ? p.guid === profile.guid : p.character === profile.character
    );
    const facts = sessionFactsFromBoard(livePlayer, deaths);
    const body = {
      character: profile,
      sessions: characterSessions(events, profile.character, allow, profile.guid, facts).slice(0, 12),
      timeline: characterTimeline(events, profile.character, allow, profile.guid).slice(0, 40),
      deaths: deaths.slice(0, 20),
      source: "lan-session",
      board_version: version,
      note: "Deaths and dings match Live (LanSession). Session windows and timeline rows are the event log, cached until the board version changes.",
    };
    if (detailCache.size > 48) {
      const first = detailCache.keys().next().value;
      detailCache.delete(first);
    }
    detailCache.set(key, body);
    return body;
  }

  function timelineRows(state, events, { character = "", bucket = "ALL", limit = 250 } = {}) {
    const lim = Math.min(2000, Math.max(1, Number(limit) || 250));
    const key = `${version}|tl|${character}|${bucket}|${lim}`;
    const hit = detailCache.get(key);
    if (hit) return hit;
    const allow = (state?.players || [])
      .filter((p) => p?.character)
      .map((p) => ({ guid: p.guid || null, character: p.character }));
    const onBoard = (state?.players || []).find((p) => p.character === character);
    let rows = characterTimeline(events, character, allow, onBoard?.guid || null);
    if (bucket && bucket !== "ALL") rows = rows.filter((r) => r.bucket === bucket);
    const total = rows.length;
    const truncated = total > lim;
    const body = {
      character,
      bucket,
      rows: truncated ? rows.slice(0, lim) : rows,
      total,
      limit: lim,
      truncated,
      board_version: version,
    };
    if (detailCache.size > 48) {
      const first = detailCache.keys().next().value;
      detailCache.delete(first);
    }
    detailCache.set(key, body);
    return body;
  }

  return {
    invalidate,
    version: () => version,
    catalog,
    characterDetail,
    timelineRows,
    stats: () => ({ version, catalogCached: !!catalogEntry, details: detailCache.size }),
  };
}
