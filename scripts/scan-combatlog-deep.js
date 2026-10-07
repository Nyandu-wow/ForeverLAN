/**
 * Deeper pass on a real Forever combat log: zones, player deaths, PvP kills.
 */
import fs from "node:fs";
import readline from "node:readline";

const file = process.argv[2];
const rl = readline.createInterface({
  input: fs.createReadStream(file, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

const zones = [];
const maps = [];
const playerDeaths = [];
const pvpKills = [];
const partyKillDestTypes = new Map();
let alexDied = 0;
let samDied = 0;
let recent = [];

function nameOf(quoted) {
  return String(quoted || "").replace(/^"|"$/g, "");
}

for await (const line of rl) {
  recent.push(line);
  if (recent.length > 8) recent.shift();
  const rest = line.replace(
    /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}:\d{2}\.\d+\s+/,
    ""
  );
  const ts = line.slice(0, 24).trim();
  if (rest.startsWith("ZONE_CHANGE,")) zones.push(line.trim());
  if (rest.startsWith("MAP_CHANGE,")) maps.push(line.trim());
  if (rest.startsWith("UNIT_DIED,")) {
    if (/Player-/.test(rest)) {
      playerDeaths.push({
        line: line.trim(),
        before: recent.slice(0, -1).filter((l) => /DAMAGE|PARTY_KILL|ENVIRONMENTAL/.test(l)).slice(-3),
      });
      if (/Alex/i.test(line)) alexDied++;
      if (/Sam/i.test(line)) samDied++;
    }
  }
  if (rest.startsWith("PARTY_KILL,")) {
    const m = rest.match(/PARTY_KILL,([^,]+),("[^"]+"|[^,]+),[^,]+,[^,]+,([^,]+),("[^"]+"|[^,]+)/);
    const destGuid = m ? m[3] : "?";
    const kind = destGuid.startsWith("Player-")
      ? "player"
      : destGuid.startsWith("Creature-")
        ? "creature"
        : "other";
    partyKillDestTypes.set(kind, (partyKillDestTypes.get(kind) || 0) + 1);
    if (kind === "player") pvpKills.push(line.trim());
  }
}

console.log("ZONE_CHANGE", zones.length);
zones.forEach((l) => console.log(" ", l));
console.log("\nMAP_CHANGE", maps.length);
maps.forEach((l) => console.log(" ", l));
console.log("\nPLAYER UNIT_DIED", playerDeaths.length, "alex", alexDied, "sam", samDied);
for (const d of playerDeaths) {
  console.log("---");
  console.log(d.line);
  for (const b of d.before) console.log("  ctx:", b.slice(0, 220));
}
console.log("\nPARTY_KILL dest kinds", Object.fromEntries(partyKillDestTypes));
console.log("PvP PARTY_KILL lines", pvpKills.length);
pvpKills.slice(0, 5).forEach((l) => console.log(l));
