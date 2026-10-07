/**
 * One-off analysis of the host's 2026-09-30 Forever multi-char session.
 * Run: node scripts/analyze-session-sv.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  findSavedVariableFiles,
  readSavedVariablesSnapshot,
  collectEventsFromSavedVariablesText,
} from "../collector/savedvars.js";

const client = "C:/Games/FOREVER/World of Warcraft/_classic_beta_";
const data = "C:/Games/FOREVER/ForeverLAN-data";

function summarize(label, events) {
  const byChar = new Map();
  const byType = new Map();
  for (const ev of events) {
    const c = ev.character || ev.unit || "(none)";
    byChar.set(c, (byChar.get(c) || 0) + 1);
    byType.set(ev.type || "?", (byType.get(ev.type || "?") || 0) + 1);
  }
  const topChar = [...byChar.entries()].sort((a, b) => b[1] - a[1]);
  const topType = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\n## ${label}`);
  console.log(`  events=${events.length} uniqueChars=${byChar.size}`);
  console.log("  by character:", Object.fromEntries(topChar));
  console.log("  top types:", Object.fromEntries(topType));
  return { byChar, events };
}

function metaFromText(text) {
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };
  return {
    hasCharDB: /ForeverLANCharDB\s*=/.test(text),
    hasAccDB: /ForeverLANDB\s*=/.test(text),
    version: pick(/\["version"\]\s*=\s*"([^"]+)"/),
    schema: pick(/\["schema"\]\s*=\s*(\d+)/),
    character_key: pick(/\["character_key"\]\s*=\s*"([^"]+)"/),
    migrated: /migrated_from_account"\]\s*=\s*true/.test(text),
    last_flush_at: Number(pick(/\["last_flush_at"\]\s*=\s*(\d+)/) || 0),
    last_flush_count: Number(pick(/\["last_flush_count"\]\s*=\s*(\d+)/) || 0),
    hasExport: /\["export"\]\s*=\s*"FOREVERLAN_CLIP/.test(text),
    dirty: /\["dirty"\]\s*=\s*true/.test(text),
  };
}

console.log("=== SV discovery ===");
const files = findSavedVariableFiles(client);
for (const f of files) {
  const rel = f.split("WTF")[1] || f;
  const snap = readSavedVariablesSnapshot(f);
  const text = fs.readFileSync(f, "utf8");
  const meta = metaFromText(text);
  console.log({
    rel,
    ok: snap.ok,
    via: snap.via,
    parsedEvents: snap.events.length,
    bytes: text.length,
    ...meta,
  });
  summarize(rel, snap.events);
}

// Cross-contamination check: events in River file claiming Brook/Ford and vice versa
console.log("\n=== isolation check (character field vs file folder) ===");
for (const f of files) {
  if (!f.includes("Alex-")) continue;
  const folder = f.includes("Ford")
    ? "Ford"
    : f.includes("River")
      ? "River"
      : f.includes("Brook")
        ? "Brook"
        : "?";
  const snap = readSavedVariablesSnapshot(f);
  const foreign = snap.events.filter((ev) => {
    const c = String(ev.character || "");
    if (!c.includes("Alex")) return false;
    if (folder === "Ford") return /River|Brook/i.test(c);
    if (folder === "River") return /Ford|Brook/i.test(c);
    if (folder === "Brook") return /Ford|River/i.test(c);
    return false;
  });
  const shortOnly = snap.events.filter((ev) => String(ev.character || "") === "Alex");
  console.log({
    folder,
    total: snap.events.length,
    foreignSurnameEvents: foreign.length,
    bareNyanduEvents: shortOnly.length,
    sampleForeign: foreign.slice(0, 3).map((e) => ({ id: e.id, type: e.type, character: e.character })),
  });
}

// Outbox
const lines = fs.readFileSync(path.join(data, "outbox.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean);
let pending = 0;
let sent = 0;
const byCharRecent = new Map();
for (const line of lines) {
  try {
    const row = JSON.parse(line);
    if (row.sent_at) sent += 1;
    else pending += 1;
    const c = row.event?.character || "?";
    const ts = Number(row.event?.ts) || 0;
    // WoW time() may be game-time-ish; still useful relatively
    if (!byCharRecent.has(c) || byCharRecent.get(c).ts < ts) {
      byCharRecent.set(c, { ts, type: row.event?.type, sent: !!row.sent_at, id: row.event?.id });
    }
  } catch {
    /* ignore */
  }
}
console.log("\n=== outbox ===", { rows: lines.length, pending, sent });
console.log("latest per character:", Object.fromEntries(byCharRecent));

// Ingest timeline 15:30+
const ingest = fs
  .readFileSync(path.join(data, "ingest.log"), "utf8")
  .split(/\r?\n/)
  .filter((l) => /2026-09-30 15:(3|4)/.test(l));
console.log("\n=== ingest timeline (15:30–15:40) ===");
for (const l of ingest) {
  const short = l.replace(/^\[/, "").replace(/\] /, " | ");
  if (/LOGIN|logged in|now playing|CATCH-UP|NEW CLIENT|ding|Brook|River|Ford/.test(l)) {
    console.log(short);
  }
}

// Hotfix ForeverLAN
const ht = "C:/Games/FOREVER/World of Warcraft/_classic_beta_/Logs/Hotfix.log";
const htText = fs.readFileSync(ht, "utf8");
const fl = htText.split(/\r?\n/).filter((l) => /ForeverLAN|AddOns\\ForeverLAN/i.test(l));
console.log("\n=== Hotfix ForeverLAN matches ===", fl.length);
console.log("shutdown lines:", htText.split(/\r?\n/).filter((l) => /Shutdown|Fatal|SCRIPT/.test(l)).slice(-5));
