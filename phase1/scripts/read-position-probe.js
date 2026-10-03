import fs from "node:fs";
import path from "node:path";

const root = "C:/Games/FOREVER/World of Warcraft/_classic_beta_/WTF/Account";
const accounts = fs.readdirSync(root);
let file = null;
for (const a of accounts) {
  const p = path.join(root, a, "SavedVariables", "ForeverLAN.lua");
  if (fs.existsSync(p)) {
    file = p;
    break;
  }
}
if (!file) {
  console.log("NO_SV");
  process.exit(1);
}
const st = fs.statSync(file);
console.log("SV", file, "mtime", st.mtime.toISOString(), "size", st.size);
const t = fs.readFileSync(file, "utf8");
console.log("has_positionProbe", t.includes("positionProbe"));
console.log("has_map_x", t.includes('["map_x"]') || t.includes("map_x"));
console.log("has_accuracy", t.includes("accuracy"));
console.log("has_GetPlayerMapPosition", t.includes("GetPlayerMapPosition"));

const idx = t.indexOf("positionProbe");
if (idx >= 0) {
  console.log("--- positionProbe slice ---");
  console.log(t.slice(idx, idx + 3500));
}

// Extract a few accuracy / map_x assignments
const acc = [...t.matchAll(/\["accuracy"\]\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
const mapx = [...t.matchAll(/\["map_x"\]\s*=\s*([^\n,]+)/g)].map((m) => m[1].trim());
const mapy = [...t.matchAll(/\["map_y"\]\s*=\s*([^\n,]+)/g)].map((m) => m[1].trim());
const worldx = [...t.matchAll(/\["world_x"\]\s*=\s*([^\n,]+)/g)].map((m) => m[1].trim());
const mapIds = [...t.matchAll(/\["map_id"\]\s*=\s*([^\n,]+)/g)].map((m) => m[1].trim());
const mapNames = [...t.matchAll(/\["map_name"\]\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
console.log("accuracy_samples", [...new Set(acc)].slice(0, 10), "count", acc.length);
console.log("map_x_samples", mapx.slice(0, 8));
console.log("map_y_samples", mapy.slice(0, 8));
console.log("world_x_samples", worldx.slice(0, 8));
console.log("map_id_samples", [...new Set(mapIds)].slice(0, 10));
console.log("map_name_samples", [...new Set(mapNames)].slice(0, 10));
