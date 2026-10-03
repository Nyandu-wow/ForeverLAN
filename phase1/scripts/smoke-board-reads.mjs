/**
 * Read-model cache: catalog and character slices come from one board version.
 * Does not fold events. Does not touch the weekend log.
 */
import assert from "node:assert/strict";
import { LanSession } from "../host/lan-session.js";
import { createBoardReads } from "../host/board-reads.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok  ", name);
}

const now = Math.floor(Date.now() / 1000);
const session = new LanSession({ roster: ["Alex River"], rosterAuto: true });
const events = [
  {
    v: 1,
    id: "login",
    type: "LOGIN",
    source: "addon",
    is_self: true,
    character: "Alex River",
    guid: "Player-1-A",
    ts: now - 120,
    level: 4,
  },
  {
    v: 1,
    id: "ding",
    type: "PLAYER_LEVEL_CHANGED",
    source: "addon",
    is_self: true,
    character: "Alex River",
    guid: "Player-1-A",
    ts: now - 60,
    old_level: 4,
    level: 5,
  },
  {
    v: 1,
    id: "dead",
    type: "PLAYER_DIED",
    source: "addon",
    is_self: true,
    character: "Alex River",
    guid: "Player-1-A",
    ts: now - 30,
    level: 5,
  },
];
for (const ev of events) session.apply(ev, { announce: false });
const board = session.getPublicState();

const reads = createBoardReads();
reads.invalidate(1);

test("catalog is cached until the board version changes", () => {
  const a = reads.catalog(board, events.length);
  const b = reads.catalog(board, events.length);
  assert.equal(a, b);
  assert.equal(a.board_version, 1);
  assert.equal(a.source, "lan-session");
  assert.equal(a.characters[0].deaths, board.players[0].deaths);
  reads.invalidate(2);
  const c = reads.catalog(board, events.length);
  assert.notEqual(a, c);
  assert.equal(c.board_version, 2);
});

test("character detail reuses the event-log slice for the same version", () => {
  const a = reads.characterDetail(board, events, { guid: "Player-1-A" });
  const b = reads.characterDetail(board, events, { name: "Alex River" });
  assert.equal(a, b);
  assert.equal(a.deaths.length, board.players[0].deaths);
  assert.equal(a.sessions.reduce((n, s) => n + s.deaths, 0), board.players[0].deaths);
  reads.invalidate(3);
  const c = reads.characterDetail(board, events, { guid: "Player-1-A" });
  assert.notEqual(a, c);
  assert.equal(c.board_version, 3);
});

test("timeline rows stay on the board version and do not invent deaths", () => {
  const rows = reads.timelineRows(board, events, { character: "Alex River", bucket: "ALL" });
  assert.equal(rows.board_version, 3);
  assert.ok(rows.rows.some((r) => r.type === "PLAYER_DIED"));
  const again = reads.timelineRows(board, events, { character: "Alex River", bucket: "ALL" });
  assert.equal(rows, again);
  const deaths = reads.timelineRows(board, events, { character: "Alex River", bucket: "DEATHS" });
  assert.ok(deaths.rows.every((r) => r.bucket === "DEATHS"));
});

test("unknown character is not invented", () => {
  assert.equal(reads.characterDetail(board, events, { name: "Nobody Else" }), null);
});

console.log(`\n${passed} passed, 0 failed`);
