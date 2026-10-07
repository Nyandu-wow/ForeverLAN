/**
 * Parity smoke: every dashboard surface uses the ONE LanSession fold.
 *
 * Checks Live (/lan players) vs Explore (/api/v1/catalog + character sessions) on:
 * deaths, identity, levels, zones, professions, Legacy, awards — plus the fold's own
 * correctness edges (test events, level baselines, combat-before-addon deaths,
 * ambiguous name stubs, roster timestamps, poison events, replay determinism).
 *
 * Runs on a synthetic fixture always, and on data/host-events.jsonl when present.
 *   node scripts/smoke-board-catalog.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LanSession } from "../host/lan-session.js";
import { catalogFromLanState } from "../host/board-catalog.js";
import { characterSessions, sessionFactsFromBoard } from "../host/analytics.js";
import {
  FIXTURE_LAN_ROSTER,
  FIXTURE_LAN_ROSTER_ALIASES,
  FIXTURE_BOARD_EXCLUDE,
} from "./fixtures/weekend-roster.mjs";
import { createSyncWho } from "../collector/sync-who.js";
import { characterFromCombatName } from "../collector/combatlog.js";
import { fullNameKey, isFullName, resolveRosterKey, aliasMapFrom } from "../host/character-id.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const ROSTER = FIXTURE_LAN_ROSTER;
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok  ", name);
}

console.log("\n[identity] Forever full name, never first-name matching");
test("fullNameKey is exact: Alex ≠ Alex River", () => {
  assert.equal(fullNameKey("Alex River-ClassicBetaPvP"), "alex river");
  assert.notEqual(fullNameKey("Alex"), fullNameKey("Alex River"));
  assert.equal(isFullName("Alex River"), true);
  assert.equal(isFullName("Alex"), false);
});
test("combat-log realm strip keeps Forever First Last (hyphenated realms)", () => {
  assert.equal(characterFromCombatName("Alex River-ClassicBetaPvP"), "Alex River");
  assert.equal(characterFromCombatName("Casey Brook-Area-52"), "Casey Brook");
  assert.equal(characterFromCombatName("Sam Hill-ClassicBetaPvP"), "Sam Hill");
  assert.equal(characterFromCombatName("Sam"), "Sam");
});
test("remembered roster: exact + explicit aliases (never bare Alex)", () => {
  const who = createSyncWho(FIXTURE_LAN_ROSTER, FIXTURE_LAN_ROSTER_ALIASES);
  assert.equal(who.filterEvent({ type: "LOGIN", character: "Alex Brook", is_self: false }), null);
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Alex Brook", is_self: true }));
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Jordan Vale", is_self: false }));
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Jordan", is_self: false }));
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Casey", is_self: false }));
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Sam", is_self: false }));
  assert.equal(who.filterEvent({ type: "LOGIN", character: "Alex", is_self: false }), null);
  assert.ok(who.filterEvent({ type: "LOGIN", character: "Alex River", is_self: false }));
  const aliases = aliasMapFrom(FIXTURE_LAN_ROSTER_ALIASES);
  const roster = new Set(FIXTURE_LAN_ROSTER.map(fullNameKey));
  assert.equal(resolveRosterKey("Casey", roster, aliases), "casey brook");
  assert.equal(resolveRosterKey("Sam", roster, aliases), "sam hill");
  assert.equal(resolveRosterKey("Alex", roster, aliases), null);
});
test("board-exclude drops bank is_self; PARTY_KILL gets Forever full name from GUID", () => {
  // Explicit exclude list — product DEFAULT_BOARD_EXCLUDE is empty.
  const bankExclude = ["Bank Alt"];
  const who = createSyncWho(FIXTURE_LAN_ROSTER, FIXTURE_LAN_ROSTER_ALIASES, {
    boardExclude: bankExclude,
  });
  assert.equal(
    who.filterEvent({
      type: "LOGIN",
      character: "Bank Alt",
      guid: "Player-BANK-1",
      is_self: true,
      ts: 999,
    }),
    null
  );
  assert.equal(who.playingName(), "");
  assert.ok(
    who.filterEvent({
      type: "LOGIN",
      character: "Alex Brook",
      guid: "Player-4619-DOS",
      is_self: true,
      ts: 100,
    })
  );
  assert.equal(who.playingName(), "Alex Brook");
  const kill = who.filterEvent({
    type: "PARTY_KILL",
    source: "combatlog",
    source_guid: "Player-4619-DOS",
    character: "Alex",
    ts: 101,
  });
  assert.ok(kill);
  assert.equal(kill.character, "Alex Brook");
  assert.equal(kill.character_combat, "Alex");
});
test("board exclude keeps bank alts off; misfiled realm surname repairs Sam Hill", () => {
  const session = new LanSession({
    roster: ROSTER,
    rosterAliases: FIXTURE_LAN_ROSTER_ALIASES,
    boardExclude: ["Bank Alt"],
    rosterAuto: true,
    levelCap: 60,
  });
  session.apply({
    v: 1,
    id: "bank-1",
    type: "LOGIN",
    source: "addon",
    ts: Math.floor(Date.now() / 1000),
    character: "Bank Alt",
    guid: "Player-BANK-1",
    is_self: true,
    level: 1,
  });
  session.apply({
    v: 1,
    id: "sam-misfiled-1",
    type: "PLAYER_LEVEL_CHANGED",
    source: "addon",
    ts: Math.floor(Date.now() / 1000),
    character: "Sam",
    realm: "This",
    guid: "Player-KLAYNZ-1",
    is_self: false,
    level: 7,
    old_level: 6,
  });
  const state = session.getPublicState();
  assert.equal(
    state.players.some((p) => /bank alt/i.test(p.character || "")),
    false
  );
  const k = state.players.find((p) => /sam/i.test(p.character || ""));
  assert.ok(k, "Sam Hill should appear");
  assert.equal(k.character, "Sam Hill");
});

function rebuild(events) {
  const session = new LanSession({
    roster: ROSTER,
    rosterAliases: FIXTURE_LAN_ROSTER_ALIASES,
    boardExclude: FIXTURE_BOARD_EXCLUDE,
    rosterAuto: true,
    levelCap: 60,
  });
  return session.rebuildFromEvents(events);
}

function ownsRow(p, row) {
  return (p.guid && row.guid && p.guid === row.guid) || (!row.guid && row.character === p.character);
}

/** Invariants that must hold for ANY event log. */
function checkParity(label, events, { exactSessions = false } = {}) {
  const state = rebuild(events);
  const board = catalogFromLanState(state);
  const players = state.players || [];
  const rows = state.death_log || [];

  test(`${label}: no two board rows share a GUID`, () => {
    const guids = players.map((p) => p.guid).filter(Boolean);
    assert.equal(new Set(guids).size, guids.length);
  });

  test(`${label}: every death row belongs to exactly one board player`, () => {
    for (const row of rows) {
      const owners = players.filter((p) => ownsRow(p, row));
      assert.equal(owners.length, 1, `death ${row.id} (${row.character}) owners=${owners.length}`);
    }
  });

  test(`${label}: deaths — Live total == death_log rows == catalog characters`, () => {
    const live = players.reduce((a, p) => a + (p.deaths || 0), 0);
    assert.equal(rows.length, live, `death_log ${rows.length} vs Live ${live}`);
    assert.equal(board.deaths.length, live);
    assert.equal(board.characters.reduce((a, c) => a + (c.deaths || 0), 0), live);
    for (const p of players) {
      assert.equal(rows.filter((r) => ownsRow(p, r)).length, p.deaths || 0, `${p.character} rows vs deaths`);
    }
  });

  test(`${label}: catalog character rows mirror Live identity/levels/professions/Legacy`, () => {
    assert.equal(board.characters.length, players.length);
    for (const p of players) {
      const c = board.characters.find((x) => (p.guid ? x.guid === p.guid : x.character === p.character));
      assert(c, `missing catalog row for ${p.character}`);
      assert.equal(c.character, p.character);
      assert.equal(c.level ?? null, p.level ?? null, `${p.character} level`);
      assert.equal(c.levels_gained, p.levels_gained ?? 0, `${p.character} levels_gained`);
      assert.equal(c.deaths, p.deaths || 0, `${p.character} deaths`);
      assert.deepEqual(c.professions || null, p.professions || null, `${p.character} professions`);
      assert.deepEqual(c.legacy || null, p.legacy || null, `${p.character} legacy`);
    }
  });

  test(`${label}: zone death tallies come from the same death rows`, () => {
    const zoned = rows.filter((r) => r.zone).length;
    assert.equal(board.zones.reduce((a, z) => a + z.deaths, 0), zoned);
  });

  test(`${label}: awards and records name board characters only`, () => {
    const names = new Set(players.map((p) => p.character));
    for (const r of state.records || []) {
      if (r.character) assert(names.has(r.character), `record ${r.key} names ${r.character}`);
    }
    for (const h of state.hall || []) {
      if (h.character) assert(names.has(h.character), `hall "${h.title}" names ${h.character}`);
    }
  });

  test(`${label}: session tables count the board's deaths and dings`, () => {
    const allow = players.map((p) => ({ character: p.character, guid: p.guid || null }));
    for (const p of players) {
      const facts = sessionFactsFromBoard(p, rows.filter((r) => ownsRow(p, r)));
      const sessions = characterSessions(events, p.character, allow, p.guid || null, facts);
      const deaths = sessions.reduce((a, s) => a + s.deaths, 0);
      const dings = sessions.reduce((a, s) => a + s.dings, 0);
      if (exactSessions) {
        assert.equal(deaths, p.deaths || 0, `${p.character} session deaths`);
        assert.equal(dings, (p.ding_times || []).length, `${p.character} session dings`);
      } else {
        // A board fact outside every raw session window (no own events around it) is not shown.
        assert(deaths <= (p.deaths || 0), `${p.character} session deaths ${deaths} > ${p.deaths}`);
        assert(dings <= (p.ding_times || []).length, `${p.character} session dings overcount`);
      }
    }
  });

  return state;
}

// ---------------------------------------------------------------------------
// Synthetic fixture — each block is a real failure seen in the beta log.
// ---------------------------------------------------------------------------
const t0 = Math.floor(Date.now() / 1000) - 6 * 3600;
const A = "Player-1-BIGG";
const B = "Player-1-DOST";
const K = "Player-1-KLAY";
const S = "Player-1-SINU";
const W = "Player-1-SWIN";
const self = (character, guid, extra) => ({ v: 1, source: "addon", is_self: true, character, guid, ...extra });
let n = 0;
const ev = (fields) => ({ id: `fx-${++n}`, ...fields });

const fixture = [
  // River: 1→3, a fake down and its re-emit, one death emitted twice.
  ev({ ...self("Alex River", A), type: "LOGIN", ts: t0, level: 1, zone: "Elwynn Forest", zone_source: "addon" }),
  ev({ ...self("Alex River", A), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 600, old_level: 1, level: 2 }),
  ev({ ...self("Alex River", A), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 1200, old_level: 2, level: 3 }),
  ev({ ...self("Alex River", A), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 1300, old_level: 3, level: 2 }),
  ev({ ...self("Alex River", A), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 1320, old_level: 2, level: 3 }),
  ev({ ...self("Alex River", A), type: "PLAYER_DIED", ts: t0 + 1500, level: 3, zone: "Westfall" }),
  ev({ ...self("Alex River", A), type: "PLAYER_DIED", ts: t0 + 1505, level: 3, zone: "Westfall" }),
  // Brook: same first name, different GUID — must stay a separate row. He scores the
  // first ding while the addon still reports the bare first name; the surname arrives later.
  ev({ ...self("Alex", B), type: "LOGIN", ts: t0 + 100, level: 5 }),
  ev({ ...self("Alex", B), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 150, old_level: 5, level: 6 }),
  ev({ ...self("Alex Brook", B), type: "PLAYER_DIED", ts: t0 + 2000, level: 6 }),
  // Bare "Alex" with no GUID while two Nyandus exist: ambiguous, dropped with its death.
  ev({ v: 1, source: "addon", character: "Alex", type: "PLAYER_DIED", ts: t0 + 2500 }),
  // Sam Hill: first sighting 0→3 is a baseline, then one real ding.
  ev({ ...self("Sam Hill", K), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 50, old_level: 0, level: 3 }),
  ev({ ...self("Sam Hill", K), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 900, old_level: 3, level: 4 }),
  // Combat log counts the fall 200s BEFORE the addon reports it — one death, addon clock.
  ev({ v: 1, source: "combatlog", type: "COMBAT_PLAYER_DEATH", ts: t0 + 3000, character: "Sam Hill", dest_name: "Sam Hill-ClassicBetaPvP-" }),
  ev({ ...self("Sam Hill", K), type: "PLAYER_DIED", ts: t0 + 3200, level: 4 }),
  // Casey Brook: pre-levelled character, 0→19 / 19→0 / 0→19 scans — never a ding or FIRST TO 10.
  ev({ ...self("Casey Brook", S), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 60, old_level: 0, level: 19 }),
  ev({ ...self("Casey Brook", S), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 70, old_level: 19, level: 0 }),
  ev({ ...self("Casey Brook", S), type: "PLAYER_LEVEL_CHANGED", ts: t0 + 71, old_level: 0, level: 19 }),
  // Jordan Vale only via a party roster (members carry no ts) + a null member.
  ev({
    ...self("Alex River", A),
    type: "PARTY_ROSTER",
    ts: t0 + 400,
    in_group: true,
    members: [{ character: "Jordan Vale", guid: W, class: "Mage", level: 7, online: true }, null],
  }),
  // Test traffic that reached the log: must never touch the board.
  { v: 1, id: "catchup-smoke-1", source: "smoke", type: "PLAYER_LEVEL_CHANGED", ts: t0 - 86400, character: "Alex River", level: 10, old_level: 9, is_self: true },
  { v: 1, id: "loadtest-lt1-c0-1", source: "LOADTEST", type: "PLAYER_DIED", ts: t0 + 4000, character: "Alex River", guid: A, is_self: true },
];

console.log("\n[fixture] fold correctness");
const state = checkParity("fixture", fixture, { exactSessions: true });
const byName = (name) => state.players.find((p) => p.character === name);

test("fixture: GUID twins stay separate; ambiguous bare name is not a board row", () => {
  assert(byName("Alex River"));
  assert(byName("Alex Brook"));
  assert.equal(byName("Alex"), undefined);
  assert.equal(state.players.length, 5);
});

test("fixture: death definition — double emit, combat-before-addon, ambiguous stub", () => {
  assert.equal(byName("Alex River").deaths, 1);
  assert.equal(byName("Alex Brook").deaths, 1);
  assert.equal(byName("Sam Hill").deaths, 1);
  assert.equal(state.death_log.length, 3);
  const k = state.death_log.find((r) => r.guid === K);
  assert.equal(k.ts, t0 + 3200, "merged death takes the addon clock");
});

test("fixture: levels — baselines are not dings, fake downs/re-emits are ignored", () => {
  const a = byName("Alex River");
  assert.deepEqual([a.start_level, a.level, a.levels_gained, a.ding_times.length], [1, 3, 2, 2]);
  const k = byName("Sam Hill");
  assert.deepEqual([k.start_level, k.level, k.levels_gained, k.ding_times.length], [3, 4, 1, 1]);
  const s = byName("Casey Brook");
  assert.deepEqual([s.level, s.levels_gained, (s.ding_times || []).length], [19, 0, 0]);
});

test("fixture: records — first ding is a real ding and follows the surname upgrade", () => {
  const first = state.records.find((r) => r.key === "first_ding");
  assert.equal(first?.character, "Alex Brook");
  assert.equal(first?.guid, B);
  assert.match(first.label, /^Alex Brook — first ding/);
  const d = byName("Alex Brook");
  assert.deepEqual([d.start_level, d.level, d.levels_gained], [5, 6, 1]);
});

test("fixture: no FIRST TO 10 or ding activity from a pre-levelled baseline", () => {
  assert.equal(state.records.some((r) => r.key === "first_level_10"), false);
  assert.equal(state.activity.some((a) => /Casey Brook reached level/.test(a.text || "")), false);
});

test("fixture: test events (smoke / loadtest) never drive the board", () => {
  const a = byName("Alex River");
  assert.equal(a.start_level, 1, "catchup-smoke must not set start_level");
  assert.equal(a.first_seen_at, new Date(t0 * 1000).toISOString());
  assert.equal(state.watching_since, new Date(t0 * 1000).toISOString());
});

test("fixture: roster-only players carry event time, not rebuild wall-clock", () => {
  const w = byName("Jordan Vale");
  const iso = new Date((t0 + 400) * 1000).toISOString();
  assert.equal(w.first_seen_at, iso);
  assert.equal(w.last_seen_at, iso);
});

test("fixture: replay is order-independent (arrival order ≠ event order)", () => {
  const shuffled = [...fixture].reverse();
  const again = rebuild(shuffled);
  const pick = (st) =>
    st.players
      .map((p) => [p.character, p.level, p.start_level, p.levels_gained, p.deaths, p.first_seen_at, p.last_seen_at])
      .sort();
  assert.deepEqual(pick(again), pick(state));
  assert.deepEqual(
    again.death_log.map((r) => [r.id, r.ts]).sort(),
    state.death_log.map((r) => [r.id, r.ts]).sort()
  );
});

test("fixture: a poison event is skipped and counted, the board still builds", () => {
  const poison = {
    id: "poison-1",
    type: "LOGIN",
    ts: t0 + 10,
    get character() {
      throw new Error("boom");
    },
  };
  const st = rebuild([...fixture, poison]);
  assert.equal(st.meta.fold_errors, 1);
  assert.equal(st.meta.last_fold_error.id, "poison-1");
  assert.equal(st.players.length, 5);
});

// ---------------------------------------------------------------------------
// Real weekend log (if this machine has one).
// ---------------------------------------------------------------------------
const logPath = path.join(root, "../data/host-events.jsonl");
if (fs.existsSync(logPath)) {
  const events = [];
  for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.id && e?.type) events.push(e);
    } catch {
      /* torn line — host skips it too */
    }
  }
  if (events.length) {
    console.log(`\n[real log] ${events.length} events`);
    const real = checkParity("real log", events, { exactSessions: true });
    test("real log: fold raised no errors", () => assert.equal(real.meta.fold_errors || 0, 0));
    console.log(
      "      board:",
      real.players.map((p) => `${p.character} L${p.level} +${p.levels_gained ?? 0} deaths=${p.deaths ?? 0}`).join(" | ")
    );
  }
}

console.log(`\nsmoke-board-catalog: PASS (${passed} checks)`);
