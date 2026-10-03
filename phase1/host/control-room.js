/**
 * Forever LAN — control-room intelligence (host-derived, Counted).
 * One weekend / one dataset. No new telemetry. No client-contract changes.
 *
 * Honesty:
 * - Observed = raw event / host_received_at
 * - Derived = calculated from those (status, lead pulse, milestones, evidence)
 */

/** Host ingest age thresholds for client status (seconds). */
export const CLIENT_STATUS_THRESHOLDS = Object.freeze({
  /** last_host_seen within this ⇒ REPORTING (or CATCHING UP if rebuild active) */
  REPORTING_SEC: 120,
  /** between REPORTING and this ⇒ STALE */
  STALE_SEC: 15 * 60,
  /** beyond STALE (or explicit offline) ⇒ OFFLINE */
});

/**
 * @typedef {"REPORTING"|"STALE"|"OFFLINE"|"CATCHING_UP"} ClientStatus
 */

/**
 * Derive per-player telemetry status.
 * Explicitly separates host ingest freshness from in-game event time.
 *
 * @param {object} player public or internal player
 * @param {{ nowMs?: number, catchUpActive?: boolean }} [opts]
 */
export function deriveClientStatus(player, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const catchUpActive = !!opts.catchUpActive;
  const hostAt = player?.last_host_seen_at ? new Date(player.last_host_seen_at).getTime() : NaN;
  const gameAt = player?.last_event_at
    ? new Date(player.last_event_at).getTime()
    : player?.last_seen_at
      ? new Date(player.last_seen_at).getTime()
      : NaN;

  const hostAgeSec = Number.isFinite(hostAt) ? Math.max(0, (nowMs - hostAt) / 1000) : null;
  const gameAgeSec = Number.isFinite(gameAt) ? Math.max(0, (nowMs - gameAt) / 1000) : null;

  /** @type {ClientStatus} */
  let status = "OFFLINE";
  if (hostAgeSec != null && hostAgeSec <= CLIENT_STATUS_THRESHOLDS.REPORTING_SEC) {
    status = catchUpActive ? "CATCHING_UP" : "REPORTING";
  } else if (
    hostAgeSec != null &&
    hostAgeSec <= CLIENT_STATUS_THRESHOLDS.STALE_SEC &&
    player?.online !== false
  ) {
    status = "STALE";
  } else if (player?.online === true && hostAgeSec != null && hostAgeSec <= CLIENT_STATUS_THRESHOLDS.STALE_SEC) {
    status = "STALE";
  } else {
    status = "OFFLINE";
  }

  // Explicit logout / soft-offline wins over a stale "online" flag with ancient ingest.
  if (player?.online === false && status !== "CATCHING_UP") {
    if (hostAgeSec == null || hostAgeSec > CLIENT_STATUS_THRESHOLDS.REPORTING_SEC) {
      status = "OFFLINE";
    }
  }

  return {
    status,
    label: statusLabel(status),
    host_ingest_at: player?.last_host_seen_at || null,
    host_ingest_age_sec: hostAgeSec != null ? Math.round(hostAgeSec) : null,
    host_ingest_label: formatAge(hostAgeSec),
    game_event_at: Number.isFinite(gameAt) ? new Date(gameAt).toISOString() : null,
    game_event_age_sec: gameAgeSec != null ? Math.round(gameAgeSec) : null,
    game_event_label: formatAge(gameAgeSec),
    catching_up: status === "CATCHING_UP",
    honesty: "derived",
  };
}

function statusLabel(status) {
  switch (status) {
    case "REPORTING":
      return "Reporting";
    case "STALE":
      return "Stale";
    case "CATCHING_UP":
      return "Catching up";
    default:
      return "Offline";
  }
}

export function formatAge(ageSec) {
  if (ageSec == null || !Number.isFinite(ageSec)) return "—";
  if (ageSec < 5) return "just now";
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
  return `${Math.round(ageSec / 86400)}d ago`;
}

/**
 * Attach client_status onto public players (mutates copies).
 */
export function attachClientStatuses(players, opts = {}) {
  return (players || []).map((p) => ({
    ...p,
    client_status: deriveClientStatus(p, opts),
  }));
}

/**
 * Race-control lead pulse from current levels + trajectory markers.
 * Only emits when the state is meaningful (tie / sole lead / recent change).
 */
export function buildRacePulse(players, trajectory = null, opts = {}) {
  const leveled = (players || []).filter((p) => p.level != null && p.character);
  if (leveled.length < 2) {
    return {
      kind: "WAITING",
      headline: null,
      detail: null,
      leader: leveled[0]?.character || null,
      gap: null,
      tied: false,
      honesty: "derived",
    };
  }
  const sorted = [...leveled].sort(
    (a, b) => b.level - a.level || String(a.character).localeCompare(String(b.character))
  );
  const top = sorted[0];
  const second = sorted[1];
  const leaders = sorted.filter((p) => p.level === top.level);
  const gap = top.level - second.level;
  const markers = trajectory?.markers || [];
  const recentLead = [...markers]
    .filter((m) => m.kind === "lead_change")
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0];

  if (leaders.length > 1) {
    const names = leaders.map((p) => shortName(p.character)).join(" / ");
    return {
      kind: "TIED_RACE",
      headline: "THE RACE IS TIED",
      detail: `${names} at ${top.level}`,
      leader: null,
      gap: 0,
      tied: true,
      honesty: "derived",
    };
  }

  if (gap >= 3) {
    return {
      kind: "BIG_SWING",
      headline: `${shortName(top.character).toUpperCase()} +${gap} LEVELS AHEAD`,
      detail: `Leads ${shortName(second.character)} ${top.level}–${second.level}`,
      leader: top.character,
      gap,
      tied: false,
      honesty: "derived",
    };
  }

  if (recentLead && opts.includeRecentChange !== false) {
    const who = recentLead.character || top.character;
    return {
      kind: "LEAD_CHANGED",
      headline: `${shortName(who).toUpperCase()} TAKES THE LEAD`,
      detail: recentLead.label || `Now level ${top.level}`,
      leader: top.character,
      gap,
      tied: false,
      marker_ts: recentLead.ts || null,
      honesty: "derived",
    };
  }

  return {
    kind: "NEW_LEADER",
    headline: `${shortName(top.character).toUpperCase()} LEADS`,
    detail:
      gap > 0
        ? `${shortName(top.character)} +${gap} level${gap > 1 ? "s" : ""} ahead`
        : `Level ${top.level}`,
    leader: top.character,
    gap,
    tied: false,
    honesty: "derived",
  };
}

/**
 * Meaningful moments for "since you last looked" / Live pulse.
 * Prefers story over volume. Dedupes by id.
 *
 * @param {{ activity?: object[], trajectory?: object, racePulse?: object, players?: object[], sinceIso?: string|null, limit?: number }} input
 */
export function buildLookbackMoments(input = {}) {
  const sinceMs = input.sinceIso ? new Date(input.sinceIso).getTime() : Date.now() - 30 * 60 * 1000;
  const limit = input.limit ?? 5;
  const out = [];
  const seen = new Set();

  function push(m) {
    if (!m?.id || !m?.text) return;
    if (seen.has(m.id)) return;
    const ts = m.ts ? new Date(m.ts).getTime() : NaN;
    if (Number.isFinite(ts) && ts < sinceMs) return;
    seen.add(m.id);
    out.push(m);
  }

  if (input.racePulse?.kind === "TIED_RACE" || input.racePulse?.kind === "LEAD_CHANGED" || input.racePulse?.kind === "BIG_SWING") {
    push({
      id: `race-${input.racePulse.kind}-${input.racePulse.leader || "tie"}`,
      kind: input.racePulse.kind,
      text: input.racePulse.headline,
      detail: input.racePulse.detail,
      ts: input.racePulse.marker_ts || new Date().toISOString(),
      honesty: "derived",
    });
  }

  for (const m of input.trajectory?.markers || []) {
    if (!["lead_change", "comeback", "biggest_lead", "sprint"].includes(m.kind)) continue;
    push({
      id: `traj-${m.kind}-${m.character}-${m.ts}-${m.level}`,
      kind: m.kind === "comeback" ? "COMEBACK" : m.kind === "lead_change" ? "LEAD_CHANGED" : m.kind.toUpperCase(),
      text: m.label || `${m.character} · ${m.kind}`,
      character: m.character || null,
      ts: m.ts,
      honesty: "derived",
    });
  }

  for (const a of input.activity || []) {
    if (!["DING", "DEATH", "MOMENT", "PVP", "LOOT"].includes(a.kind)) continue;
    // Skip low-signal spam moments that duplicate trajectory chips.
    if (a.kind === "MOMENT" && /biggest gap|biggest catch-up/i.test(a.text || "")) {
      // keep — race control cares
    }
    const voiced = a.announce;
    push({
      id: `act-${a.kind}-${a.ts}-${a.character || ""}-${String(a.text || "").slice(0, 40)}`,
      kind: a.kind,
      text: voiced?.compact || voiced?.headline || a.text,
      detail: voiced?.subline || null,
      character: a.character || null,
      ts: a.ts,
      honesty: a.kind === "MOMENT" ? "derived" : "observed",
    });
  }

  // Multi-death disaster in the window
  const deathBy = new Map();
  for (const a of input.activity || []) {
    if (a.kind !== "DEATH") continue;
    const t = a.ts ? new Date(a.ts).getTime() : 0;
    if (t < sinceMs) continue;
    const who = a.character || "?";
    deathBy.set(who, (deathBy.get(who) || 0) + 1);
  }
  const disasters = [...deathBy.entries()].filter(([, n]) => n >= 2);
  if (disasters.length >= 2) {
    push({
      id: `disaster-${sinceMs}`,
      kind: "DISASTER",
      text: `${disasters.length} players died repeatedly`,
      detail: disasters.map(([n, c]) => `${shortName(n)}×${c}`).join(", "),
      ts: new Date().toISOString(),
      honesty: "derived",
    });
  }

  out.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  return out.slice(0, limit);
}

/**
 * Award evidence from existing player fields / findTooSoon result.
 * Never fabricates causes — only counts and timestamps.
 */
export function buildAwardEvidence(award, player = null, extras = {}) {
  if (!award?.title) return null;
  const title = award.title;
  const who = award.character || player?.character || null;
  /** @type {{ observed: object[], derived: object[] }} */
  const evidence = { observed: [], derived: [] };

  if (title === "HOGGER'S FAVORITE" && player) {
    evidence.observed.push({
      label: "Deaths logged",
      value: player.deaths ?? 0,
    });
    const times = (player.death_times || []).slice(-5);
    for (const t of times) {
      evidence.observed.push({ label: "Death at", value: t });
    }
  }

  if (title === "TOO SOON!" && extras.tooSoon) {
    const ts = extras.tooSoon;
    evidence.observed.push({ label: "Ding at", value: ts.ding_at || null });
    evidence.observed.push({ label: "Death at", value: ts.death_at || null });
    evidence.derived.push({
      label: "Interval",
      value: `${ts.seconds}s after ding`,
      formula: "death_ts − ding_ts (30s–10m window)",
    });
  }

  if (title === "CORPSE TOURIST" && player) {
    evidence.observed.push({
      label: "Longest corpse run",
      value: `${Math.round(player.longest_corpse_run_seconds || 0)}s`,
    });
    evidence.derived.push({
      label: "Counted from",
      value: "death → resurrect / unghost intervals",
    });
  }

  if (title === "SECOND WIND" || /comeback|SECOND WIND/i.test(title)) {
    if (extras.comeback) {
      evidence.derived.push({
        label: "Levels recovered",
        value: extras.comeback.levels,
      });
      evidence.observed.push({
        label: "Character",
        value: extras.comeback.character,
      });
    }
  }

  if (title === "DING! GRATS!" || title === "DING! DING! DING!") {
    if (player?.last_ding_at) {
      evidence.observed.push({ label: "Last ding", value: player.last_ding_at });
    }
    if ((player?.ding_times || []).length) {
      evidence.observed.push({
        label: "Ding count logged",
        value: player.ding_times.length,
      });
    }
  }

  if (!evidence.observed.length && !evidence.derived.length) {
    if (award.detail) {
      evidence.derived.push({ label: "Summary", value: award.detail });
    } else {
      return null;
    }
  }

  return {
    title,
    character: who,
    honesty: award.honesty || "derived",
    evidence,
  };
}

/**
 * Enrich hall awards with evidence when underlying data exists.
 */
export function attachHallEvidence(hall, players, extras = {}) {
  const byName = new Map();
  for (const p of players || []) {
    if (p?.character) byName.set(p.character, p);
  }
  return (hall || []).map((a) => {
    const p = (a.character && byName.get(a.character)) || null;
    const packed = buildAwardEvidence(a, p, extras);
    return packed?.evidence ? { ...a, evidence: packed.evidence } : { ...a };
  });
}

/**
 * Compact career milestones (5–8) from existing player fields.
 */
export function buildCareerMilestones(player) {
  if (!player?.character) return [];
  const items = [];

  function add(id, label, ts, honesty = "observed") {
    if (!ts && ts !== 0) return;
    items.push({ id, label, ts: typeof ts === "number" ? new Date(ts * 1000).toISOString() : ts, honesty });
  }

  if (player.first_seen_at) add("first_seen", "First seen", player.first_seen_at);
  const dings = player.ding_times || [];
  if (dings[0]) add("first_ding", "First ding", dings[0]);
  for (const lvl of [10, 20, 30, 40, 50, 60]) {
    const hit = (player.level_history || []).find((h) => h.level === lvl);
    if (hit?.ts) add(`lvl_${lvl}`, `Hit ${lvl}`, hit.ts);
    else if (dings.length && player.level >= lvl) {
      // level_history may be sparse — skip guessed timestamps
    }
  }
  if ((player.death_times || [])[0]) add("first_death", "First death", player.death_times[0]);
  if ((player.deaths || 0) >= 5) {
    add("death_stack", `${player.deaths} deaths`, player.last_death_at || player.death_times?.slice(-1)[0], "derived");
  }
  if ((player.longest_corpse_run_seconds || 0) >= 120) {
    add(
      "corpse",
      `Corpse run ${Math.round(player.longest_corpse_run_seconds)}s`,
      player.last_death_at,
      "derived"
    );
  }
  if ((player.profession_skill_ups || 0) >= 10) {
    add("prof", `+${player.profession_skill_ups} profession skill-ups`, player.last_seen_at, "derived");
  }
  if ((player.loot_epic || 0) > 0) {
    add("epic", `${player.loot_epic} epic loot`, player.last_seen_at, "observed");
  }
  if ((player.levels_gained || 0) >= 5) {
    add("gained", `+${player.levels_gained} levels this weekend`, player.last_ding_at || player.last_seen_at, "derived");
  }

  items.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  // Keep first + last + middle highlights, max 8
  if (items.length <= 8) return items;
  const first = items[0];
  const last = items[items.length - 1];
  const mid = items.slice(1, -1);
  const picked = [first];
  const step = Math.max(1, Math.floor(mid.length / 6));
  for (let i = 0; i < mid.length && picked.length < 7; i += step) picked.push(mid[i]);
  if (last && last.id !== first.id) picked.push(last);
  // dedupe
  const seen = new Set();
  return picked.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  }).slice(0, 8);
}

/**
 * Host diagnostics payload — no tokens / filesystem paths.
 */
export function buildHostDiagnostics(input = {}) {
  const players = input.players || [];
  const statuses = players.map((p) => ({
    character: p.character,
    status: p.client_status?.status || deriveClientStatus(p, input).status,
    host_ingest_label: p.client_status?.host_ingest_label || formatAge(
      p.last_host_seen_at ? (Date.now() - new Date(p.last_host_seen_at).getTime()) / 1000 : null
    ),
    game_event_label: p.client_status?.game_event_label || null,
  }));
  const reporting = statuses.filter((s) => s.status === "REPORTING" || s.status === "CATCHING_UP").length;
  const stale = statuses.filter((s) => s.status === "STALE").length;
  const offline = statuses.filter((s) => s.status === "OFFLINE").length;

  const foldErrors = Number(input.foldErrors) || 0;
  const lastFold = input.lastFoldError || null;

  return {
    ok: true,
    honesty: "derived",
    host: {
      ready: input.ready !== false,
      catch_up_active: !!input.catchUpActive,
      event_count: input.eventCount ?? null,
      fold_errors: foldErrors,
      last_fold_error: lastFold,
      last_ingest_at: input.lastIngestAt || null,
      last_ingest_label: formatAge(
        input.lastIngestAt ? (Date.now() - new Date(input.lastIngestAt).getTime()) / 1000 : null
      ),
      last_event_at: input.lastEventAt || null,
      sse_clients: input.sseClients ?? null,
      ingest_clients_seen: input.ingestClients ?? null,
    },
    roster: {
      reporting,
      stale,
      offline,
      players: statuses,
    },
    notes: buildDiagNotes({
      reporting,
      stale,
      offline,
      catchUpActive: input.catchUpActive,
      players: statuses,
      foldErrors,
      lastFold,
    }),
  };
}

function buildDiagNotes({ reporting, stale, offline, catchUpActive, players, foldErrors = 0, lastFold = null }) {
  const notes = [];
  if (catchUpActive) notes.push("Board catch-up rebuild in progress — live applies are deferred.");
  if (foldErrors > 0) {
    const last = lastFold?.id ? ` Last: ${lastFold.type || "?"} ${lastFold.id}` : "";
    notes.push(`${foldErrors} fold error${foldErrors > 1 ? "s" : ""} — malformed event(s) skipped (kept in log).${last}`);
  }
  if (reporting === 0 && offline > 0) notes.push("Nobody is actively reporting right now.");
  if (stale > 0) notes.push(`${stale} client${stale > 1 ? "s" : ""} looks stale — check Push LAN / collector.`);
  const missing = (players || []).filter((p) => p.status === "OFFLINE").map((p) => shortName(p.character));
  if (missing.length && reporting > 0) {
    notes.push(`Silent: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`);
  }
  if (!notes.length) notes.push("Collection looks healthy.");
  return notes;
}

/**
 * Scaffold for a future moment detector — groups nearby activity without storytelling yet.
 * Safe to call; not shown on Live unless we wire it later.
 */
export function scaffoldMomentClusters(activity = [], windowSec = 180) {
  const sorted = [...(activity || [])]
    .filter((a) => a?.ts && a?.kind)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const clusters = [];
  let cur = null;
  for (const a of sorted) {
    const t = new Date(a.ts).getTime();
    if (!cur || t - cur.endMs > windowSec * 1000) {
      cur = {
        id: `cluster-${a.ts}-${a.character || "x"}`,
        start: a.ts,
        end: a.ts,
        endMs: t,
        character: a.character || null,
        kinds: [a.kind],
        texts: [a.text].filter(Boolean),
        honesty: "derived",
      };
      clusters.push(cur);
    } else {
      cur.end = a.ts;
      cur.endMs = t;
      if (!cur.kinds.includes(a.kind)) cur.kinds.push(a.kind);
      if (a.text) cur.texts.push(a.text);
    }
  }
  return clusters.slice(-40);
}

/** Board label: the full Forever name ("Alex River"), realm suffix stripped. */
export function shortName(character) {
  return String(character || "").split("-")[0].trim() || "?";
}
