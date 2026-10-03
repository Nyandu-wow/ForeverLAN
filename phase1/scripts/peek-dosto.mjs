import fs from "fs";
import readline from "readline";
import path from "path";

const dataDir = "C:\\Games\\FOREVER\\ForeverLAN-data";
const jsonl = path.join(dataDir, "host-events.jsonl");
console.log("jsonl mtime", fs.statSync(jsonl).mtime.toISOString(), "size", fs.statSync(jsonl).size);

const rl = readline.createInterface({ input: fs.createReadStream(jsonl), crlfDelay: Infinity });
const hits = [];
for await (const line of rl) {
  if (!/Brook/i.test(line)) continue;
  try {
    const e = JSON.parse(line);
    if (/LOGIN|LOGOUT|ONLINE|OFFLINE|DETECTED|PLAYING|PARTY_ROSTER|WORLD_ENTER/.test(e.type || "")) {
      hits.push({
        type: e.type,
        ts: e.ts,
        online: e.online,
        is_self: e.is_self,
        host: e.host_received_at,
        id: String(e.id || "").slice(0, 60),
      });
    }
  } catch {
    /* ignore */
  }
}
console.log("presence hits", hits.length);
console.log(JSON.stringify(hits.slice(-30), null, 2));
