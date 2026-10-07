/**
 * Simulate a PARTY_ROSTER clipboard payload for UI testing (not Forever-verified).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ts = Math.floor(Date.now() / 1000);
const id = (s) => `party-smoke-${s}-${Date.now()}`;

const members = [
  {
    unit: "player",
    character: "Alex River",
    realm: "SmokeTest",
    class: "PRIEST",
    race: "Human",
    level: 12,
    guid: "Player-1-SELF",
    online: true,
    dead: false,
    role: "NONE",
    zone: "The Barrens",
    zone_source: "GetZoneText",
    is_self: true,
  },
  {
    unit: "party1",
    party_index: 1,
    character: "Sam",
    realm: "SmokeTest",
    class: "ROGUE",
    race: "NightElf",
    level: 13,
    guid: "Player-1-OTHER",
    online: true,
    dead: false,
    role: "NONE",
    zone: "The Barrens",
    zone_source: "inferred_same_UnitPosition_instance",
    is_self: false,
  },
];

const events = [
  {
    v: 1,
    id: id("roster"),
    ts,
    type: "PARTY_ROSTER",
    source: "addon",
    reason: "smoke",
    group_size: 2,
    in_group: true,
    in_raid: false,
    members,
    character: members[0].character,
    level: 12,
  },
  {
    v: 1,
    id: id("level"),
    ts: ts + 1,
    type: "PLAYER_LEVEL_CHANGED",
    source: "addon",
    character: "Sam",
    realm: "SmokeTest",
    class: "ROGUE",
    guid: "Player-1-OTHER",
    unit: "party1",
    level: 13,
    old_level: 12,
    is_self: false,
    detection: "UnitLevel_delta",
  },
  {
    v: 1,
    id: id("death"),
    ts: ts + 2,
    type: "PLAYER_DIED",
    source: "addon",
    character: "Sam",
    class: "ROGUE",
    guid: "Player-1-OTHER",
    unit: "party1",
    level: 13,
    is_self: false,
    detection: "UnitIsDead",
  },
  {
    v: 1,
    id: id("inst"),
    ts: ts + 3,
    type: "PLAYER_ENTERED_INSTANCE",
    source: "addon",
    character: "Alex River",
    class: "PRIEST",
    guid: "Player-1-SELF",
    level: 12,
    instance_name: "Wailing Caverns",
    instance_type: "party",
    difficulty_name: "Normal",
    is_self: true,
  },
];

const clip = "FOREVERLAN_CLIP|" + JSON.stringify({ events });
const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText(@'
${clip}
'@)`;
await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
  windowsHide: true,
});
console.log("Party smoke clipboard set. Open http://127.0.0.1:8765/");
