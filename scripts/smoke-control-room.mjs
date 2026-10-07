/**
 * Control-room intelligence smoke tests (host-derived).
 * Run: node scripts/smoke-control-room.mjs
 */
import assert from "node:assert/strict";
import {
  deriveClientStatus,
  buildRacePulse,
  buildLookbackMoments,
  buildAwardEvidence,
  buildCareerMilestones,
  buildHostDiagnostics,
  scaffoldMomentClusters,
  CLIENT_STATUS_THRESHOLDS,
  attachHallEvidence,
} from "../host/control-room.js";
import { findTooSoon } from "../host/prize-pool.js";
import { LanSession } from "../host/lan-session.js";
import { FIXTURE_LAN_ROSTER } from "./fixtures/weekend-roster.mjs";

const now = Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString();

console.log("thresholds", CLIENT_STATUS_THRESHOLDS);

// --- client status transitions ---
{
  const reporting = deriveClientStatus(
    { online: true, last_host_seen_at: iso(now - 30), last_event_at: iso(now - 40) },
    { nowMs: now * 1000 }
  );
  assert.equal(reporting.status, "REPORTING");

  const stale = deriveClientStatus(
    { online: true, last_host_seen_at: iso(now - 600), last_event_at: iso(now - 600) },
    { nowMs: now * 1000 }
  );
  assert.equal(stale.status, "STALE");

  const offline = deriveClientStatus(
    { online: false, last_host_seen_at: iso(now - 3600), last_event_at: iso(now - 3600) },
    { nowMs: now * 1000 }
  );
  assert.equal(offline.status, "OFFLINE");

  const catching = deriveClientStatus(
    { online: true, last_host_seen_at: iso(now - 20), last_event_at: iso(now - 7200) },
    { nowMs: now * 1000, catchUpActive: true }
  );
  assert.equal(catching.status, "CATCHING_UP");
  assert.equal(catching.catching_up, true);
  assert.ok(catching.host_ingest_label);
  assert.ok(catching.game_event_label);
  console.log("ok  client status reporting/stale/offline/catching-up");
}

// --- race pulse: tie / lead / swing ---
{
  const tied = buildRacePulse([
    { character: "Alex", level: 12 },
    { character: "Sam", level: 12 },
  ]);
  assert.equal(tied.kind, "TIED_RACE");
  assert.match(tied.headline, /TIED|EVEN/i);

  const lead = buildRacePulse([
    { character: "Jordan", level: 14 },
    { character: "Alex", level: 13 },
  ]);
  assert.ok(["NEW_LEADER", "LEAD_CHANGED"].includes(lead.kind));
  assert.match(lead.headline, /SWINDOR|LEADS|AHEAD|LEAD/i);

  const swing = buildRacePulse([
    { character: "Jordan", level: 18 },
    { character: "Alex", level: 14 },
  ]);
  assert.equal(swing.kind, "BIG_SWING");
  assert.match(swing.headline, /\+4|SWINDOR/i);
  console.log("ok  race pulse tie/lead/swing");
}

// --- lookback moments prefer meaningful ---
{
  const moments = buildLookbackMoments({
    sinceIso: iso(now - 3600),
    racePulse: { kind: "LEAD_CHANGED", headline: "SWINDOR TAKES THE LEAD", detail: "L14", leader: "Jordan" },
    activity: [
      { kind: "DING", text: "Alex dinged 13", character: "Alex", ts: iso(now - 100) },
      { kind: "DEATH", text: "Alex died", character: "Alex", ts: iso(now - 90) },
      { kind: "ZONE", text: "noise", character: "Alex", ts: iso(now - 80) },
    ],
    trajectory: {
      markers: [{ kind: "comeback", character: "Sam", ts: iso(now - 50), label: "Sam comeback", level: 12 }],
    },
    limit: 5,
  });
  assert.ok(moments.length >= 2);
  assert.ok(moments.some((m) => /SWINDOR|LEAD/i.test(m.text)));
  assert.ok(!moments.some((m) => m.kind === "ZONE"));
  console.log("ok  lookback moments");
}

// --- TOO SOON evidence ---
{
  const players = [
    {
      character: "Alex",
      ding_times: [iso(now - 300)],
      death_times: [iso(now - 240)],
      deaths: 1,
    },
  ];
  const tooSoon = findTooSoon(players);
  assert.ok(tooSoon);
  assert.equal(tooSoon.seconds, 60);
  assert.ok(tooSoon.ding_at);
  assert.ok(tooSoon.death_at);
  const ev = buildAwardEvidence(
    { title: "TOO SOON!", character: "Alex", honesty: "derived" },
    players[0],
    { tooSoon }
  );
  assert.ok(ev.evidence.observed.length >= 2);
  assert.ok(ev.evidence.derived.some((d) => /Interval/i.test(d.label)));
  console.log("ok  TOO SOON evidence");
}

// --- HOGGER evidence + hall attach ---
{
  const players = [
    {
      character: "Sam",
      deaths: 7,
      death_times: [iso(now - 500), iso(now - 400), iso(now - 300)],
    },
  ];
  const hall = attachHallEvidence(
    [{ title: "HOGGER'S FAVORITE", detail: "Sam · 7 deaths", character: "Sam", honesty: "observed" }],
    players
  );
  assert.ok(hall[0].evidence);
  assert.ok(hall[0].evidence.observed.some((o) => o.label === "Deaths logged"));
  console.log("ok  award evidence + hall attach");
}

// --- comeback evidence ---
{
  const ev = buildAwardEvidence(
    { title: "SECOND WIND", character: "Alex" },
    { character: "Alex" },
    { comeback: { levels: 3, character: "Alex" } }
  );
  assert.ok(ev.evidence.derived.some((d) => d.value === 3));
  console.log("ok  comeback evidence");
}

// --- career milestones ---
{
  const career = buildCareerMilestones({
    character: "Alex",
    first_seen_at: iso(now - 10000),
    ding_times: [iso(now - 9000), iso(now - 8000)],
    death_times: [iso(now - 7000)],
    deaths: 5,
    last_death_at: iso(now - 7000),
    levels_gained: 6,
    last_ding_at: iso(now - 8000),
    level_history: [{ ts: iso(now - 8500), level: 10 }],
  });
  assert.ok(career.length >= 3);
  assert.ok(career.length <= 8);
  assert.ok(career.some((c) => /First seen|First ding|First death|Hit 10|deaths/i.test(c.label)));
  console.log("ok  career milestones");
}

// --- empty / missing ---
{
  assert.equal(buildCareerMilestones({}).length, 0);
  assert.equal(buildAwardEvidence({ title: "UNKNOWN" }, null), null);
  const emptyPulse = buildRacePulse([]);
  assert.equal(emptyPulse.kind, "WAITING");
  const quiet = buildLookbackMoments({ activity: [], sinceIso: iso(now - 60), limit: 5 });
  assert.equal(quiet.length, 0);
  console.log("ok  empty/missing cases");
}

// --- diagnostics + moment scaffold ---
{
  const diag = buildHostDiagnostics({
    players: [
      {
        character: "Alex",
        client_status: { status: "REPORTING", host_ingest_label: "just now", game_event_label: "1m ago" },
      },
      {
        character: "Jordan",
        client_status: { status: "OFFLINE", host_ingest_label: "2h ago", game_event_label: "2h ago" },
      },
    ],
    ready: true,
    catchUpActive: false,
    eventCount: 100,
    lastIngestAt: iso(now - 10),
    sseClients: 1,
    ingestClients: 2,
    foldErrors: 0,
  });
  assert.equal(diag.roster.reporting, 1);
  assert.equal(diag.roster.offline, 1);
  assert.equal(diag.host.fold_errors, 0);
  assert.ok(diag.notes.length);
  const broken = buildHostDiagnostics({
    players: [],
    foldErrors: 2,
    lastFoldError: { id: "bad-1", type: "LOGIN", error: "boom" },
  });
  assert.equal(broken.host.fold_errors, 2);
  assert.ok(broken.notes.some((n) => /fold error/.test(n)));
  const clusters = scaffoldMomentClusters([
    { kind: "DING", text: "ding", ts: iso(now - 100), character: "A" },
    { kind: "DEATH", text: "death", ts: iso(now - 90), character: "A" },
    { kind: "DING", text: "later", ts: iso(now - 10), character: "B" },
  ]);
  assert.ok(clusters.length >= 1);
  console.log("ok  diagnostics + moment scaffold");
}

// --- LanSession integration: client_status + race_pulse on board ---
{
  const session = new LanSession({ roster: FIXTURE_LAN_ROSTER });
  session.rebuildFromEvents([
    {
      id: "n1",
      ts: now - 60,
      type: "LOGIN",
      source: "addon",
      character: "Alex River",
      guid: "Player-1-N",
      level: 10,
      is_self: true,
      online: true,
      host_received_at: iso(now - 60),
    },
    {
      id: "n2",
      ts: now - 50,
      type: "PLAYER_LEVEL_CHANGED",
      source: "addon",
      character: "Alex River",
      guid: "Player-1-N",
      level: 11,
      old_level: 10,
      is_self: true,
      host_received_at: iso(now - 50),
    },
    {
      id: "k1",
      ts: now - 40,
      type: "LOGIN",
      source: "addon",
      character: "Sam",
      guid: "Player-1-K",
      level: 11,
      is_self: true,
      online: true,
      host_received_at: iso(now - 40),
    },
  ]);
  const board = session.getPublicState();
  assert.ok(board.race_pulse);
  assert.ok(Array.isArray(board.lookback_moments));
  assert.ok(Array.isArray(board.moment_clusters));
  const ny = board.players.find((p) => p.character === "Alex River");
  assert.ok(ny?.client_status);
  assert.ok(Array.isArray(ny.career));
  console.log("ok  LanSession race_pulse / lookback / career");
}

// --- Shared-zone moment names each character once (same name under two GUIDs) ---
{
  const session = new LanSession({ roster: FIXTURE_LAN_ROSTER });
  const zoneEv = (id, ts, character, guid, extra = {}) => ({
    id,
    ts,
    type: "PLAYER_ZONE_CHANGED",
    source: "addon",
    character,
    guid,
    level: 10,
    zone: "Dun Morogh",
    online: true,
    host_received_at: iso(ts),
    ...extra,
  });
  session.rebuildFromEvents([
    zoneEv("z1", now - 90, "Sam Hill", "Player-1-K", { is_self: true }),
    zoneEv("z2", now - 80, "Sam Hill", "Player-1-K2", { is_self: false, in_party: true }),
    zoneEv("z3", now - 70, "Alex River", "Player-1-N", { is_self: true }),
    zoneEv("z4", now - 60, "Alex River", "Player-1-N2", { is_self: false, in_party: true }),
  ]);
  const board = session.getPublicState();
  const together = (board.activity || []).filter((a) => /levelers in Dun Morogh/.test(a.text || ""));
  assert.ok(together.length >= 1, "shared-zone moment fires");
  for (const m of together) {
    const names = m.text.split("—")[1].replace(/\.$/, "").split(",").map((s) => s.trim());
    assert.equal(new Set(names).size, names.length, `duplicate names in: ${m.text}`);
    assert.match(m.text, new RegExp(`^${names.length} levelers`));
  }
  console.log("ok  shared-zone moment dedupes names");
}

// A death in the same hour beats a zone pile-up for the Live headline.
{
  const session = new LanSession({ roster: FIXTURE_LAN_ROSTER });
  session.rebuildFromEvents([
    {
      id: "d1",
      ts: now - 28 * 60,
      type: "PLAYER_DIED",
      source: "addon",
      character: "Alex River",
      guid: "Player-1-N",
      level: 12,
      zone: "Dun Morogh",
      is_self: true,
      online: true,
      host_received_at: iso(now - 28 * 60),
    },
    {
      id: "z1",
      ts: now - 27 * 60,
      type: "PLAYER_ZONE_CHANGED",
      source: "addon",
      character: "Alex River",
      guid: "Player-1-N",
      level: 12,
      zone: "Dun Morogh",
      is_self: true,
      online: true,
      host_received_at: iso(now - 27 * 60),
    },
    {
      id: "z2",
      ts: now - 26 * 60,
      type: "PLAYER_ZONE_CHANGED",
      source: "addon",
      character: "Sam Hill",
      guid: "Player-1-K",
      level: 11,
      zone: "Dun Morogh",
      is_self: true,
      online: true,
      host_received_at: iso(now - 26 * 60),
    },
  ]);
  const board = session.getPublicState();
  assert.ok((board.activity || []).some((a) => /levelers in Dun Morogh/.test(a.text || "")));
  assert.match(board.headline?.text || "", /DEATH|FALLEN|SPIRITS|NYANDU/i);
  assert.doesNotMatch(board.headline?.text || "", /ZONE CHANGE/i);
  console.log("ok  headline prefers a death over a zone pile-up", board.headline?.text);
}

console.log("\nsmoke-control-room: all passed");
