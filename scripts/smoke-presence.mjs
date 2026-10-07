/**
 * Presence / online-status smoke for lan-session.
 * Run: node scripts/smoke-presence.mjs
 */
import { LanSession } from "../host/lan-session.js";
import { DEFAULT_LAN_ROSTER } from "../collector/lan-roster.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString();

const events = [
  {
    v: 1,
    id: "a-1",
    ts: now - 7200,
    type: "LOGIN",
    source: "addon",
    character: "Alex River",
    guid: "Player-1-AAAA",
    class: "Priest",
    level: 10,
    is_self: true,
    online: true,
    host_received_at: iso(now - 7200),
  },
  {
    v: 1,
    id: "a-2",
    ts: now - 7000,
    type: "LOGOUT",
    source: "addon",
    character: "Alex River",
    guid: "Player-1-AAAA",
    is_self: true,
    online: false,
    host_received_at: iso(now - 7000),
  },
  {
    v: 1,
    id: "b-1",
    ts: now - 120,
    type: "LOGIN",
    source: "addon",
    character: "Sam",
    guid: "Player-1-BBBB",
    class: "Warrior",
    level: 12,
    is_self: true,
    online: true,
    host_received_at: iso(now - 120),
  },
  {
    v: 1,
    id: "c-1",
    ts: now - 7200,
    type: "PLAYER_DETECTED",
    source: "addon",
    character: "Jordan Vale",
    guid: "Player-1-CCCC",
    class: "Mage",
    level: 8,
    is_self: false,
    online: true,
    host_received_at: iso(now - 7200),
  },
];

const session = new LanSession({ roster: DEFAULT_LAN_ROSTER });
session.rebuildFromEvents(events);
const board = session.getPublicState();
const byName = Object.fromEntries((board.players || []).map((p) => [p.character, p]));

assert(byName["Alex River"], "Alex River on board");
assert(
  byName["Alex River"].online === false,
  `Alex River self ingest ~2h ago should be offline, got ${byName["Alex River"].online}`
);
assert(byName.Sam, "Sam on board");
assert(byName.Sam.online === true, `Sam should be online after recent LOGIN, got ${byName.Sam.online}`);
assert(byName["Jordan Vale"], "Jordan Vale on board");
assert(
  byName["Jordan Vale"].online === false,
  `Jordan Vale friend ingest ~2h ago should be stale-offline, got ${byName["Jordan Vale"].online}`
);

// Push LAN reload LOGOUT must not force Offline when tagged.
const pushReload = new LanSession({ roster: DEFAULT_LAN_ROSTER });
pushReload.rebuildFromEvents([
  {
    v: 1,
    id: "pr1",
    ts: now - 60,
    type: "LOGIN",
    character: "Alex Brook",
    guid: "Player-1-EEEE",
    is_self: true,
    source: "addon",
    online: true,
    level: 6,
    host_received_at: iso(now - 60),
  },
  {
    v: 1,
    id: "pr2",
    ts: now - 30,
    type: "LOGOUT",
    character: "Alex Brook",
    guid: "Player-1-EEEE",
    is_self: true,
    source: "addon",
    online: true,
    ui_reload: true,
    reason: "push_reload",
    host_received_at: iso(now - 30),
  },
]);
const dosto = pushReload.getPublicState().players.find((p) => /Brook/.test(p.character));
assert(dosto?.online === true, `Push-reload LOGOUT must leave Brook online, got ${dosto?.online}`);

// Self with recent host ingest stays online even if last typed event was LOGOUT
// (Push stranded Offline before LOGIN flush).
const stranded = new LanSession({ roster: DEFAULT_LAN_ROSTER });
stranded.rebuildFromEvents([
  {
    v: 1,
    id: "d1",
    ts: now - 120,
    type: "LOGIN",
    character: "Alex Brook",
    guid: "Player-1-FFFF",
    is_self: true,
    source: "addon",
    online: true,
    level: 6,
    host_received_at: iso(now - 120),
  },
  {
    v: 1,
    id: "d2",
    ts: now - 60,
    type: "PLAYER_OFFLINE",
    character: "Alex Brook",
    guid: "Player-1-FFFF",
    is_self: true,
    source: "addon",
    online: false,
    host_received_at: iso(now - 60),
  },
  {
    v: 1,
    id: "d3",
    ts: now - 55,
    type: "LOGOUT",
    character: "Alex Brook",
    guid: "Player-1-FFFF",
    is_self: true,
    source: "addon",
    online: false,
    host_received_at: iso(now - 55),
  },
]);
const strandedP = stranded.getPublicState().players.find((p) => /Brook/.test(p.character));
assert(
  strandedP?.online === true,
  `Self with fresh host ingest must show online (Push strand fix), got ${strandedP?.online}`
);

// Push LAN pattern: LOGOUT then LOGIN ⇒ online
const push = new LanSession({ roster: DEFAULT_LAN_ROSTER });
push.rebuildFromEvents([
  {
    v: 1,
    id: "p1",
    ts: now - 30,
    type: "LOGOUT",
    character: "Sam",
    guid: "Player-1-BBBB",
    is_self: true,
    source: "addon",
    host_received_at: iso(now - 30),
  },
  {
    v: 1,
    id: "p2",
    ts: now - 25,
    type: "LOGIN",
    character: "Sam",
    guid: "Player-1-BBBB",
    is_self: true,
    source: "addon",
    online: true,
    level: 12,
    host_received_at: iso(now - 25),
  },
]);
const k = push.getPublicState().players.find((p) => p.character.startsWith("Sam"));
assert(k?.online === true, `Push LAN LOGOUT+LOGIN should end online, got ${k?.online}`);

console.log("smoke-presence: ok");
