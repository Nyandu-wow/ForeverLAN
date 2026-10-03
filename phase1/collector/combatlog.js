import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Combat-log unit names are `Name-Realm`. Forever names are `First Last` (no
 * hyphens in the character), so the first `-` is the realm separator — realms
 * may themselves contain hyphens (e.g. Area-52).
 */
export function characterFromCombatName(raw) {
  const name = String(raw || "").trim();
  if (!name) return undefined;
  const i = name.indexOf("-");
  if (i <= 0) return name;
  return name.slice(0, i).trim() || undefined;
}

/**
 * Simple byte-offset file tailer. Survives rotation/truncate/recreate.
 */
export class FileTailer {
  constructor(filePath, { onLine, pollMs = 500 } = {}) {
    this.filePath = filePath;
    this.onLine = onLine;
    this.pollMs = pollMs;
    this.offset = 0;
    this.buffer = "";
    this.timer = null;
    this.lastSize = null;
    this.exists = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.#tick(), this.pollMs);
    this.#tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  #tick() {
    if (!fs.existsSync(this.filePath)) {
      this.exists = false;
      this.offset = 0;
      this.buffer = "";
      return;
    }
    const stat = fs.statSync(this.filePath);
    if (!this.exists) {
      // First sighting: start at EOF to avoid replaying huge historical logs,
      // unless file is small (fresh session).
      this.exists = true;
      this.offset = stat.size > 256 * 1024 ? stat.size : 0;
      this.lastSize = stat.size;
    }
    if (stat.size < this.offset) {
      // truncated / rotated
      this.offset = 0;
      this.buffer = "";
    }
    if (stat.size === this.offset) return;

    const fd = fs.openSync(this.filePath, "r");
    try {
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      this.buffer += buf.toString("utf8");
      const parts = this.buffer.split(/\r?\n/);
      this.buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) this.onLine(line);
      }
    } finally {
      fs.closeSync(fd);
    }
    this.lastSize = stat.size;
  }
}

function splitCsvRespectingQuotes(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function stripTs(line) {
  // Forever: "9/20/2026 20:01:38.9632  EVENT,..."
  // Classic-ish: "9/20 21:43:12.123  EVENT,..."
  const m = line.match(
    /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}:\d{2}\.\d+)\s+(.*)$/
  );
  if (!m) return { tsText: null, rest: line };
  return { tsText: m[1], rest: m[2] };
}

function unquote(s) {
  if (s == null) return s;
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

function parseCombatLogTs(tsText) {
  // Forever: "9/20/2026 20:01:38.9632" or "9/20 21:43:12.123"
  if (!tsText) return Math.floor(Date.now() / 1000);
  const m = String(tsText).match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (!m) return Math.floor(Date.now() / 1000);
  let year = m[3] != null ? Number(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6]);
  const d = new Date(year, month, day, hour, min, sec);
  const unix = Math.floor(d.getTime() / 1000);
  return Number.isFinite(unix) ? unix : Math.floor(Date.now() / 1000);
}

/**
 * Extract a few high-signal combat-log events for discovery.
 * Does not invent unsupported signals.
 * Event time = combat-log line timestamp (not collector ingest time).
 *
 * Stateful: keeps a short ring of damage → player so UNIT_DIED can attach a death recap.
 */
export class CombatLogParser {
  constructor() {
    /** @type {Map<string, { kind: string, name: string|null, env: string|null, ts: number }>} */
    this.#lastHit = new Map();
  }

  #lastHit;

  parse(line) {
    const { tsText, rest } = stripTs(line);
    const fields = splitCsvRespectingQuotes(rest);
    const eventName = fields[0];
    if (!eventName) return null;

    const base = {
      v: 1,
      id: crypto.createHash("sha1").update(line).digest("hex").slice(0, 32),
      ts: parseCombatLogTs(tsText),
      ts_text: tsText,
      type: null,
      source: "combatlog",
      raw_event: eventName,
    };

    // Remember last damage onto players (for death recap).
    this.#noteDamage(eventName, fields, base.ts);

    if (eventName === "COMBAT_LOG_VERSION") {
      return {
        ...base,
        type: "COMBAT_LOG_VERSION",
        advanced: fields.includes("ADVANCED_LOG_ENABLED")
          ? fields[fields.indexOf("ADVANCED_LOG_ENABLED") + 1]
          : null,
        build: fields.includes("BUILD_VERSION")
          ? fields[fields.indexOf("BUILD_VERSION") + 1]
          : null,
        project_id: fields.includes("PROJECT_ID")
          ? fields[fields.indexOf("PROJECT_ID") + 1]
          : null,
      };
    }

    if (eventName === "ZONE_CHANGE") {
      return {
        ...base,
        type: "COMBAT_ZONE",
        zone_id: fields[1],
        zone: unquote(fields[2] || ""),
        instance_type: fields[3],
      };
    }

    if (eventName === "ENCOUNTER_START") {
      return {
        ...base,
        type: "ENCOUNTER_START",
        encounter_id: fields[1],
        encounter_name: unquote(fields[2] || ""),
        difficulty_id: fields[3],
        group_size: fields[4],
      };
    }

    if (eventName === "ENCOUNTER_END") {
      return {
        ...base,
        type: "ENCOUNTER_END",
        encounter_id: fields[1],
        encounter_name: unquote(fields[2] || ""),
        success: fields[5],
      };
    }

    if (eventName === "UNIT_DIED") {
      const destGuid = fields[5] || "";
      const destName = unquote(fields[6] || "");
      const isPlayer = destGuid.startsWith("Player-");
      const character = isPlayer ? characterFromCombatName(destName) : undefined;
      const hit = isPlayer ? this.#lastHit.get(destGuid) || this.#lastHit.get(character?.toLowerCase()) : null;
      const out = {
        ...base,
        type: isPlayer ? "COMBAT_PLAYER_DEATH" : "COMBAT_UNIT_DEATH",
        dest_guid: destGuid,
        dest_name: destName,
        character,
      };
      if (hit && base.ts - hit.ts <= 8) {
        out.death_cause = hit.kind;
        if (hit.name) out.killer_name = hit.name;
        if (hit.env) out.environmental_type = hit.env;
        out.death_summary = formatDeathSummary(hit);
      }
      return out;
    }

    if (eventName === "PARTY_KILL") {
      return {
        ...base,
        type: "PARTY_KILL",
        source_guid: fields[1],
        source_name: unquote(fields[2] || ""),
        dest_guid: fields[5],
        dest_name: unquote(fields[6] || ""),
        character: characterFromCombatName(unquote(fields[2] || "")),
      };
    }

    return null;
  }

  #noteDamage(eventName, fields, ts) {
    // dest is usually fields[5]/[6] for advanced combat log
    let destGuid = fields[5] || "";
    let destName = unquote(fields[6] || "");
    let srcGuid = fields[1] || "";
    let srcName = unquote(fields[2] || "");

    if (eventName === "ENVIRONMENTAL_DAMAGE") {
      // Standard prefix: src…, destGuid[5], destName[6], … then environmentalType[9]
      destGuid = fields[5] || fields[1] || "";
      destName = unquote(fields[6] || fields[2] || "");
      if (!destGuid.startsWith("Player-")) return;
      const env = unquote(fields[9] || fields[5] || "") || "Environment";
      // Avoid treating a GUID-looking field as the env type
      const envClean = /^Player-|Creature-|Vehicle-/.test(env) ? "Environment" : env;
      const hit = {
        kind: "environmental",
        name: null,
        env: envClean,
        ts,
      };
      this.#lastHit.set(destGuid, hit);
      const envKey = characterFromCombatName(destName);
      if (envKey) this.#lastHit.set(envKey.toLowerCase(), hit);
      return;
    }

    const damageEvents = new Set([
      "SWING_DAMAGE",
      "SWING_DAMAGE_LANDED",
      "SPELL_DAMAGE",
      "SPELL_PERIODIC_DAMAGE",
      "RANGE_DAMAGE",
      "DAMAGE_SHIELD",
    ]);
    if (!damageEvents.has(eventName)) return;
    if (!destGuid.startsWith("Player-")) return;
    // Ignore self-damage noise for killer attribution when source is also the player
    let kind = "creature";
    let name = srcName ? characterFromCombatName(srcName) : null;
    if (srcGuid.startsWith("Player-")) kind = "pvp";
    else if (srcGuid.startsWith("Creature-") || srcGuid.startsWith("Vehicle-")) kind = "creature";
    else if (!srcGuid || srcGuid === "0000000000000000") kind = "unknown";
    const hit = { kind, name, env: null, ts };
    this.#lastHit.set(destGuid, hit);
    const destKey = characterFromCombatName(destName);
    if (destKey) this.#lastHit.set(destKey.toLowerCase(), hit);
  }
}

function formatDeathSummary(hit) {
  if (!hit) return null;
  if (hit.kind === "environmental") {
    const env = String(hit.env || "Environment");
    if (/fall/i.test(env)) return "fell to their death";
    if (/drown/i.test(env)) return "drowned";
    if (/fatigue/i.test(env)) return "died of fatigue";
    if (/lava|fire/i.test(env)) return `died to ${env.toLowerCase()}`;
    return `died to ${env.toLowerCase()}`;
  }
  if (hit.kind === "pvp" && hit.name) return `slain by ${hit.name}`;
  if (hit.kind === "creature" && hit.name) return `slain by ${hit.name}`;
  return "died";
}

/** @deprecated Prefer CombatLogParser for death recap. */
export function parseCombatLogLine(line) {
  return new CombatLogParser().parse(line);
}
