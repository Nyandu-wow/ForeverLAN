/**
 * Scan real Forever combat logs. Does not invent events.
 * Usage: node scripts/scan-combatlog.js [path]
 */
import fs from "node:fs";
import path from "node:path";
import { findCombatLogPath } from "../collector/config.js";
import { parseCombatLogLine } from "../collector/combatlog.js";

const arg = process.argv[2];
const file =
  arg ||
  findCombatLogPath("C:/Games/FOREVER/World of Warcraft/_classic_beta_");

if (!fs.existsSync(file)) {
  console.error("missing", file);
  process.exit(1);
}

const stat = fs.statSync(file);
console.log("file", file);
console.log("bytes", stat.size, "mtime", stat.mtime.toISOString());

const rawCounts = new Map();
const parsedCounts = new Map();
const samples = {
  ZONE_CHANGE: [],
  MAP_CHANGE: [],
  UNIT_DIED_PLAYER: [],
  UNIT_DIED_OTHER: [],
  PARTY_KILL_PLAYER: [],
  PARTY_KILL_NPC: [],
  ENCOUNTER_START: [],
  ENCOUNTER_END: [],
};

function pushSample(bucket, line, extra) {
  if (samples[bucket].length >= 4) return;
  samples[bucket].push({ line: line.slice(0, 280), ...extra });
}

const rs = fs.createReadStream(file, { encoding: "utf8" });
let buf = "";
let lines = 0;
let unparsedInteresting = 0;

await new Promise((resolve, reject) => {
  rs.on("data", (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      lines++;
      const rest = line.replace(
        /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}:\d{2}\.\d+\s+/,
        ""
      );
      const name = rest.split(",")[0];
      rawCounts.set(name, (rawCounts.get(name) || 0) + 1);

      const ev = parseCombatLogLine(line);
      if (ev?.type) parsedCounts.set(ev.type, (parsedCounts.get(ev.type) || 0) + 1);

      if (name === "ZONE_CHANGE") pushSample("ZONE_CHANGE", line, { parsed: ev?.type, zone: ev?.zone });
      if (name === "MAP_CHANGE") pushSample("MAP_CHANGE", line);
      if (name === "ENCOUNTER_START") pushSample("ENCOUNTER_START", line, { parsed: ev?.type });
      if (name === "ENCOUNTER_END") pushSample("ENCOUNTER_END", line, { parsed: ev?.type });
      if (name === "UNIT_DIED") {
        const player = line.includes("Player-");
        pushSample(player ? "UNIT_DIED_PLAYER" : "UNIT_DIED_OTHER", line, {
          parsed: ev?.type,
          character: ev?.character,
          dest: ev?.dest_name,
        });
      }
      if (name === "PARTY_KILL") {
        const destPlayer = /PARTY_KILL,.*Player-/.test(line) && line.split("Player-").length > 2;
        // crude: two Player- guids often means player vs player
        const playerHits = (line.match(/Player-/g) || []).length;
        pushSample(playerHits >= 2 ? "PARTY_KILL_PLAYER" : "PARTY_KILL_NPC", line, {
          parsed: ev?.type,
          dest_guid: ev?.dest_guid,
          source: ev?.source_name,
          dest: ev?.dest_name,
        });
      }
    }
  });
  rs.on("end", resolve);
  rs.on("error", reject);
});

console.log("\nlines", lines);
console.log("\n-- raw event names (top) --");
[...rawCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .forEach(([k, v]) => console.log(String(v).padStart(8), k));

const interesting = [
  "ZONE_CHANGE",
  "MAP_CHANGE",
  "UNIT_DIED",
  "PARTY_KILL",
  "ENCOUNTER_START",
  "ENCOUNTER_END",
  "COMBAT_LOG_VERSION",
];
console.log("\n-- interesting raw counts --");
for (const k of interesting) console.log(String(rawCounts.get(k) || 0).padStart(8), k);

console.log("\n-- parser normalized counts --");
[...parsedCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(String(v).padStart(8), k));

console.log("\n-- samples --");
console.log(JSON.stringify(samples, null, 2));
