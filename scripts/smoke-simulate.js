/**
 * Offline smoke test: simulates addon clipboard payload + combat log lines.
 * Usage: node scripts/smoke-simulate.js
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, discoverClientDir, combatLogPath, logsDir } from "../collector/config.js";

const execFileAsync = promisify(execFile);
const config = loadConfig();
const clientDir = discoverClientDir(config);
if (!clientDir) {
  console.error("No client dir");
  process.exit(1);
}

const combatPath = combatLogPath(clientDir);
fs.mkdirSync(logsDir(clientDir), { recursive: true });

const loginId = `smoke-login-${Date.now()}`;
const levelId = `smoke-level-${Date.now()}`;
const payload = {
  events: [
    {
      v: 1,
      id: loginId,
      ts: Math.floor(Date.now() / 1000),
      type: "LOGIN",
      character: "Alex River",
      realm: "SmokeTest",
      class: "PRIEST",
      race: "Human",
      level: 1,
      zone: "Northshire Abbey",
      source: "addon",
    },
    {
      v: 1,
      id: levelId,
      ts: Math.floor(Date.now() / 1000),
      type: "LEVEL_UP",
      character: "Alex River",
      realm: "SmokeTest",
      class: "PRIEST",
      race: "Human",
      level: 2,
      old_level: 1,
      source: "addon",
    },
  ],
};

const clip = "FOREVERLAN_CLIP|" + JSON.stringify(payload);
const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText(@'
${clip}
'@)`;
await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
  windowsHide: true,
});
console.log("Clipboard set with LOGIN + LEVEL_UP");

const lines = [
  `9/20 21:43:12.001  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.60.1.69913,PROJECT_ID,5`,
  `9/20 21:44:01.100  ZONE_CHANGE,12,"Elwynn Forest",0`,
  `9/20 21:45:10.200  UNIT_DIED,0000000000000000,nil,0x80000000,0x0,Player-1-0000ABCD,"Alex River",0x511,0x0`,
  `9/20 21:46:00.300  PARTY_KILL,Player-1-0000ABCD,"Alex River",0x511,0x0,Creature-0-1-12-1-6-00000001,"Kobold Vermin",0x10a48,0x0`,
];
fs.appendFileSync(combatPath, lines.map((l) => l + "\n").join(""), "utf8");
console.log("Appended sample combat log lines to", combatPath);
console.log("If collector + host are running, the viewer should update within ~2s.");
