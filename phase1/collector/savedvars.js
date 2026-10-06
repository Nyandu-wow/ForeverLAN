import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseClipboardPayload } from "./clipboard.js";
import { fullNameKey } from "../host/character-id.js";

const PREFIX = "FOREVERLAN_CLIP|";

/**
 * Character folder under WTF is usually "First-Last" → "First Last".
 * Returns null for account-level SavedVariables paths.
 */
export function characterNameFromSvPath(file) {
  const parts = String(file || "").split(/[/\\]/);
  const idx = parts.lastIndexOf("SavedVariables");
  if (idx < 2) return null;
  const charFolder = parts[idx - 1];
  const parent = parts[idx - 2];
  // Account/<acct>/SavedVariables — no per-character folder.
  if (!charFolder || charFolder === "SavedVariables") return null;
  if (parent === "Account") return null;
  return charFolder.replace(/-/g, " ").trim() || null;
}

/**
 * Find ForeverLAN.lua SavedVariables under:
 *   WTF/Account/<account>/SavedVariables/ForeverLAN.lua          (account-wide)
 *   WTF/Account/<account>/<realm>/<character>/SavedVariables/ForeverLAN.lua  (per-character)
 * @param {string} clientDir
 * @param {{ excludeNames?: string[] }} [opts]
 */
export function findSavedVariableFiles(clientDir, opts = {}) {
  const accountRoot = path.join(clientDir, "WTF", "Account");
  if (!fs.existsSync(accountRoot)) return [];
  const exclude = new Set((opts.excludeNames || []).map(fullNameKey).filter(Boolean));
  const out = [];
  const seen = new Set();

  function add(sv) {
    if (!sv || seen.has(sv)) return;
    if (exclude.size) {
      const who = characterNameFromSvPath(sv);
      if (who && exclude.has(fullNameKey(who))) return;
    }
    if (fs.existsSync(sv)) {
      seen.add(sv);
      out.push(sv);
    }
  }

  for (const account of fs.readdirSync(accountRoot, { withFileTypes: true })) {
    if (!account.isDirectory() || account.name === "SavedVariables") continue;
    const accountDir = path.join(accountRoot, account.name);
    add(path.join(accountDir, "SavedVariables", "ForeverLAN.lua"));

    let realmEntries;
    try {
      realmEntries = fs.readdirSync(accountDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const realm of realmEntries) {
      if (!realm.isDirectory()) continue;
      if (realm.name === "SavedVariables") continue;
      const realmDir = path.join(accountDir, realm.name);
      let charEntries;
      try {
        charEntries = fs.readdirSync(realmDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const character of charEntries) {
        if (!character.isDirectory()) continue;
        add(
          path.join(realmDir, character.name, "SavedVariables", "ForeverLAN.lua")
        );
      }
    }
  }
  return out;
}

/**
 * Minimal WoW SavedVariables Lua reader for ForeverLANDB tables.
 */
function parseLuaValue(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  if (i >= src.length) return [null, i];

  if (src[i] === '"') {
    i++;
    let s = "";
    while (i < src.length) {
      if (src[i] === "\\") {
        const n = src[i + 1];
        if (n === "n") s += "\n";
        else if (n === "r") s += "\r";
        else if (n === "t") s += "\t";
        else if (n === '"') s += '"';
        else if (n === "\\") s += "\\";
        else s += n || "";
        i += 2;
        continue;
      }
      if (src[i] === '"') {
        i++;
        break;
      }
      s += src[i++];
    }
    return [s, i];
  }

  if (src.startsWith("true", i)) return [true, i + 4];
  if (src.startsWith("false", i)) return [false, i + 5];
  if (src.startsWith("nil", i)) return [null, i + 3];

  if (/[-\d]/.test(src[i])) {
    let j = i;
    if (src[j] === "-") j++;
    while (j < src.length && /[\d.]/.test(src[j])) j++;
    return [Number(src.slice(i, j)), j];
  }

  if (src[i] === "{") {
    i++;
    const obj = {};
    const arr = [];
    let usedKeys = false;
    let usedArr = false;
    while (i < src.length) {
      while (i < src.length && /[\s,]/.test(src[i])) i++;
      if (src[i] === "}") {
        i++;
        break;
      }
      if (src[i] === "[") {
        i++;
        while (i < src.length && /\s/.test(src[i])) i++;
        let key;
        if (src[i] === '"') {
          [key, i] = parseLuaValue(src, i);
        } else {
          let j = i;
          while (j < src.length && src[j] !== "]") j++;
          key = src.slice(i, j).trim();
          if (/^-?\d+$/.test(key)) key = Number(key);
          i = j;
        }
        if (src[i] === "]") i++;
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src[i] === "=") i++;
        const [val, ni] = parseLuaValue(src, i);
        i = ni;
        obj[key] = val;
        usedKeys = true;
      } else {
        const [val, ni] = parseLuaValue(src, i);
        i = ni;
        arr.push(val);
        usedArr = true;
      }
    }
    if (usedArr && !usedKeys) return [arr, i];
    if (usedKeys && !usedArr) return [obj, i];
    for (let k = 0; k < arr.length; k++) obj[k + 1] = arr[k];
    if (usedArr && Object.keys(obj).every((k) => k === String(Number(k)) || typeof k === "number")) {
      return [arr.length ? arr : Object.values(obj), i];
    }
    return [Object.keys(obj).length ? obj : arr, i];
  }

  return [null, i + 1];
}

function luaTableToEvents(pending) {
  if (!pending) return [];
  let list;
  if (Array.isArray(pending)) list = pending;
  else if (typeof pending === "object") {
    list = Object.keys(pending)
      .filter((k) => /^\d+$/.test(String(k)))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => pending[k]);
  } else return [];

  return list
    .filter((e) => e && typeof e === "object" && e.id && e.type)
    .map((e) => {
      if (e.members && !Array.isArray(e.members) && typeof e.members === "object") {
        e = {
          ...e,
          members: Object.keys(e.members)
            .filter((k) => /^\d+$/.test(String(k)))
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => e.members[k]),
        };
      }
      return { ...e, source: e.source || "addon" };
    });
}

function eventsFromExportString(exportStr) {
  if (typeof exportStr !== "string" || !exportStr.startsWith(PREFIX)) return [];
  try {
    return parseClipboardPayload(exportStr) || [];
  } catch {
    return [];
  }
}

function collectEventsFromBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return { events: [], via: null };
  const byId = new Map();
  let via = null;
  if (typeof bucket.export === "string" && bucket.export.startsWith(PREFIX)) {
    for (const ev of eventsFromExportString(bucket.export)) {
      if (ev?.id && !byId.has(ev.id)) byId.set(ev.id, ev);
    }
    if (byId.size) via = "export";
  }
  // Pending can hold rows minted after the export snapshot (Push-in-combat combat-time).
  for (const ev of luaTableToEvents(bucket.pending)) {
    if (ev?.id && !byId.has(ev.id)) {
      byId.set(ev.id, ev);
      via = via ? "merged" : "pending";
    }
  }
  return { events: [...byId.values()], via };
}

/**
 * Merge events from ForeverLANCharDB (schema 3) and/or ForeverLANDB (schema 1–2).
 * Dedupes by event.id (first wins).
 * @param {object} db
 * @param {{ skipExport?: boolean, skipCharacters?: boolean, ambiguousPendingOnly?: boolean }} [opts]
 */
export function collectEventsFromForeverLANDB(db, opts = {}) {
  if (!db || typeof db !== "object") {
    return { events: [], via: "empty" };
  }
  const byId = new Map();
  const vias = new Set();

  function take(list, via) {
    for (const ev of list || []) {
      if (!ev?.id) continue;
      if (opts.ambiguousPendingOnly && !isAmbiguousAccountEvent(ev)) continue;
      if (!byId.has(ev.id)) {
        byId.set(ev.id, ev);
        if (via) vias.add(via);
      }
    }
  }

  const chars = db.characters;
  if (!opts.skipCharacters && chars && typeof chars === "object") {
    for (const key of Object.keys(chars)) {
      const bucket = chars[key];
      const filtered =
        opts.skipExport && bucket && typeof bucket === "object"
          ? { pending: bucket.pending, export: null }
          : bucket;
      const { events, via } = collectEventsFromBucket(filtered);
      take(events, via ? `characters:${via}` : null);
    }
  }

  // CharDB / legacy / root pending+export
  const root = collectEventsFromBucket({
    export: opts.skipExport ? null : db.export,
    pending: db.pending,
  });
  take(root.events, root.via ? `root:${root.via}` : null);

  const events = [...byId.values()];
  let via = "empty";
  if (events.length) {
    if (vias.has("characters:export") || vias.has("root:export")) via = "export";
    else if (vias.has("characters:pending") || vias.has("root:pending")) via = "pending";
    else via = "merged";
  }
  return { events, via };
}

/** Bare first-name / missing character — not a Forever surnamed identity. */
export function isAmbiguousAccountEvent(ev) {
  const c = ev?.character;
  if (typeof c !== "string" || !c.trim()) return true;
  // Surname form has a space ("Alex Ford"); bare "Alex" is ambiguous.
  if (!/\s/.test(c)) return true;
  return false;
}

function parseNamedLuaTable(text, globalName) {
  const re = new RegExp(`${globalName}\\s*=\\s*`);
  const m = text.match(re);
  if (!m) return null;
  const idx = m.index + m[0].length;
  try {
    const [db] = parseLuaValue(text, idx);
    return db && typeof db === "object" ? db : null;
  } catch {
    return null;
  }
}

/** @deprecated prefer parseNamedLuaTable — kept for callers */
function parseForeverLANDB(text) {
  return parseNamedLuaTable(text, "ForeverLANDB");
}

/**
 * Collect events from a SavedVariables file that may contain ForeverLANCharDB
 * and/or ForeverLANDB assignments.
 * @param {string} text
 * @param {{ skipAccountExport?: boolean }} [opts]
 */
export function collectEventsFromSavedVariablesText(text, opts = {}) {
  const byId = new Map();
  const vias = new Set();
  function merge(part) {
    for (const ev of part.events || []) {
      if (!ev?.id || byId.has(ev.id)) continue;
      byId.set(ev.id, ev);
    }
    if (part.via && part.via !== "empty") vias.add(part.via);
  }

  const charDb = parseNamedLuaTable(text, "ForeverLANCharDB");
  if (charDb) merge(collectEventsFromForeverLANDB(charDb));

  const accountDb = parseNamedLuaTable(text, "ForeverLANDB");
  if (accountDb) {
    merge(
      collectEventsFromForeverLANDB(accountDb, {
        skipExport: opts.skipAccountExport === true,
        skipCharacters: opts.skipAccountExport === true,
        ambiguousPendingOnly: opts.skipAccountExport === true,
      })
    );
  }

  const events = [...byId.values()];
  let via = "empty";
  if (events.length) {
    if ([...vias].some((v) => v.includes("export") || v === "export")) via = "export";
    else if ([...vias].some((v) => v.includes("pending") || v === "pending")) via = "pending";
    else via = "merged";
  }
  return { events, via };
}

/** Account-level SV path (not per-character). */
export function isAccountSavedVariablesPath(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  return /\/Account\/[^/]+\/SavedVariables\/ForeverLAN\.lua$/i.test(norm);
}

/** True when .../Account/<acct>/<realm>/<char>/SavedVariables/ForeverLAN.lua exists. */
export function hasPerCharacterSavedVariables(accountSvPath) {
  const norm = String(accountSvPath || "").replace(/\\/g, "/");
  const m = norm.match(/^(.*)\/Account\/([^/]+)\/SavedVariables\/ForeverLAN\.lua$/i);
  if (!m) return false;
  const accountRoot = path.join(m[1].replace(/\//g, path.sep), "Account", m[2]);
  if (!fs.existsSync(accountRoot)) return false;
  for (const realm of fs.readdirSync(accountRoot, { withFileTypes: true })) {
    if (!realm.isDirectory() || realm.name === "SavedVariables") continue;
    const realmDir = path.join(accountRoot, realm.name);
    let chars;
    try {
      chars = fs.readdirSync(realmDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const character of chars) {
      if (!character.isDirectory()) continue;
      const sv = path.join(realmDir, character.name, "SavedVariables", "ForeverLAN.lua");
      if (fs.existsSync(sv)) return true;
    }
  }
  return false;
}

function looksTruncated(text) {
  if (!text || !text.trim()) return true;
  // WoW SV files are a complete Lua assignment; a mid-write often ends mid-string/table.
  const trimmed = text.replace(/\s+$/, "");
  if (!/ForeverLAN(?:Char)?DB/.test(trimmed)) return true;
  const last = trimmed[trimmed.length - 1];
  if (last !== "}" && last !== '"') return true;
  // Unbalanced quotes in the export string is a common partial-write symptom.
  const exportRe = /\[["']?export["']?\]\s*=\s*"/;
  if (exportRe.test(trimmed)) {
    const open = (trimmed.match(/"/g) || []).length;
    if (open % 2 !== 0) return true;
  }
  // Brace balance (string-aware): partial flush can end on an inner `}` while the
  // outer ForeverLANCharDB / ForeverLANDB table is still open.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth < 0) return true;
    }
  }
  if (inString || depth !== 0) return true;
  return false;
}

/**
 * Read + classify a SavedVariables snapshot.
 * @returns {{ ok: boolean, events: object[], fingerprint: string|null, reason?: string, bytes: number }}
 */
export function readSavedVariablesSnapshot(filePath) {
  let text;
  let bytes = 0;
  try {
    text = fs.readFileSync(filePath, "utf8");
    bytes = Buffer.byteLength(text, "utf8");
  } catch (err) {
    return { ok: false, events: [], fingerprint: null, reason: `read:${err.message}`, bytes: 0 };
  }

  if (looksTruncated(text)) {
    return { ok: false, events: [], fingerprint: null, reason: "partial_or_empty", bytes };
  }

  const fingerprint = crypto.createHash("sha1").update(text).digest("hex");

  const skipAccountExport =
    isAccountSavedVariablesPath(filePath) && hasPerCharacterSavedVariables(filePath);
  const merged = collectEventsFromSavedVariablesText(text, { skipAccountExport });
  if (merged.events.length || /ForeverLAN(?:Char)?DB\s*=/.test(text)) {
    return {
      ok: true,
      events: merged.events,
      fingerprint,
      bytes,
      via: merged.via,
      skipAccountExport,
    };
  }

  // Fallback: legacy regex path if named-table parse found nothing.
  // Do not use account-level export fallback when CharDB siblings own Push state.
  if (skipAccountExport) {
    return { ok: true, events: [], fingerprint, bytes, via: "empty", skipAccountExport };
  }
  const exportRe = /\[["']?export["']?\]\s*=\s*"((?:\\.|[^"\\])*)"/;
  const em = text.match(exportRe);
  if (em) {
    const unescaped = em[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    if (unescaped.startsWith(PREFIX)) {
      try {
        const fromExport = parseClipboardPayload(unescaped);
        if (fromExport.length) {
          return { ok: true, events: fromExport, fingerprint, bytes, via: "export" };
        }
        // Export present but empty/invalid JSON — treat as transient if pending also missing.
      } catch {
        return { ok: false, events: [], fingerprint: null, reason: "export_parse", bytes };
      }
    } else if (unescaped.length > 0) {
      return { ok: false, events: [], fingerprint: null, reason: "export_prefix", bytes };
    }
  }

  const pendingIdx = text.indexOf('["pending"]');
  if (pendingIdx < 0) {
    // Valid SV with no pending yet (fresh install)
    return { ok: true, events: [], fingerprint, bytes, via: "empty" };
  }
  const eq = text.indexOf("=", pendingIdx);
  if (eq < 0) {
    return { ok: false, events: [], fingerprint: null, reason: "pending_eq", bytes };
  }
  try {
    const [pending] = parseLuaValue(text, eq + 1);
    const events = luaTableToEvents(pending);
    return { ok: true, events, fingerprint, bytes, via: "pending" };
  } catch (err) {
    return { ok: false, events: [], fingerprint: null, reason: `pending_parse:${err.message}`, bytes };
  }
}

export function readEventsFromSavedVariables(filePath) {
  const snap = readSavedVariablesSnapshot(filePath);
  return snap.ok ? snap.events : [];
}

/**
 * Convert ForeverLANDB.positionProbe into POSITION_UPDATE events.
 */
export function readPositionProbeEvents(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const idx = text.indexOf('["positionProbe"]');
  if (idx < 0) return [];
  const eq = text.indexOf("=", idx);
  if (eq < 0) return [];
  const [probe] = parseLuaValue(text, eq + 1);
  if (!probe || !probe.probes) return [];
  let list = probe.probes;
  if (!Array.isArray(list) && typeof list === "object") {
    list = Object.keys(list)
      .filter((k) => /^\d+$/.test(String(k)))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => list[k]);
  }
  if (!Array.isArray(list)) return [];
  const ts = probe.ts || Math.floor(Date.now() / 1000);
  return list
    .filter((p) => p && (p.character || p.unit))
    .map((p) => ({
      v: 1,
      id: `pos-${p.character || p.unit}-${ts}-${p.ui_map_id || "x"}-${Math.round((p.map_x || 0) * 1e6)}`,
      ts,
      type: "POSITION_UPDATE",
      source: "addon",
      character: p.character || "",
      class: p.class || "",
      level: p.level,
      unit: p.unit,
      guid: p.unit === "player" ? undefined : undefined,
      position: {
        accuracy: p.accuracy || "UNKNOWN",
        zone: p.zone_text || p.ui_map_name || null,
        subzone: p.subzone_text || null,
        map_id: p.ui_map_id ?? null,
        map_name: p.ui_map_name || null,
        parent_map_id: p.ui_map_parent ?? null,
        map_x: p.map_x ?? null,
        map_y: p.map_y ?? null,
        world_x: p.world_x ?? null,
        world_y: p.world_y ?? null,
        instance_id: p.instance_id ?? null,
        continent_id: p.continent_id ?? null,
        source:
          p.map_x != null
            ? "C_Map.GetPlayerMapPosition"
            : p.world_x != null
              ? "UnitPosition"
              : "probe",
        confidence: p.accuracy === "EXACT" ? "VERIFIED" : "HIGH",
        ts,
      },
    }));
}

/** @deprecated use readEventsFromSavedVariables */
export function readExportFromSavedVariables(filePath) {
  return readEventsFromSavedVariables(filePath);
}

/**
 * Poll SavedVariables. Tolerant of mid-write / partial files:
 * - unchanged content fingerprint → skip (no reprocess)
 * - transient parse failure → keep prior good state, retry next poll, throttle logs
 * - never treat a bad read as “empty success”
 */
export function pollSavedVariables(clientDir, onEvents, opts = {}) {
  const log = opts.log || ((..._args) => {});
  const excludeNames = opts.excludeNames || [];
  /** @type {Map<string, number>} */
  const mtimes = new Map();
  /** @type {Map<string, string>} seeded from collector-state across restarts */
  const fingerprints = new Map(Object.entries(opts.initialFingerprints || {}));
  /** @type {Map<string, number>} */
  const lastFailLogAt = new Map();

  function scan(force = false) {
    let fpsDirty = false;
    const current = findSavedVariableFiles(clientDir, { excludeNames });
    for (const f of current) {
      let mtime;
      let size = 0;
      try {
        const st = fs.statSync(f);
        mtime = st.mtimeMs;
        size = st.size;
      } catch {
        continue;
      }
      const prevMtime = mtimes.get(f);
      if (!force && prevMtime != null && mtime <= prevMtime) continue;

      const snap = readSavedVariablesSnapshot(f);
      if (!snap.ok) {
        // Do not advance mtime — retry until a complete write appears.
        const now = Date.now();
        const last = lastFailLogAt.get(f) || 0;
        if (now - last > 30000) {
          lastFailLogAt.set(f, now);
          log(
            `[collector] SavedVariables transient (${snap.reason || "invalid"}) size=${size} — keeping prior state, will retry`
          );
        }
        continue;
      }

      // Fingerprint skip applies even on boot force-scan — avoids re-parsing
      // unchanged BankAlt/alt exports every collector restart.
      if (snap.fingerprint && fingerprints.get(f) === snap.fingerprint) {
        mtimes.set(f, mtime);
        continue;
      }

      mtimes.set(f, mtime);
      fingerprints.set(f, snap.fingerprint);
      lastFailLogAt.delete(f);
      fpsDirty = true;

      const events = [...snap.events, ...readPositionProbeEvents(f)];
      if (events.length) onEvents(events, f, { bytes: snap.bytes, via: snap.via });
    }
    if (fpsDirty && typeof opts.onFingerprintsChange === "function") {
      opts.onFingerprintsChange(Object.fromEntries(fingerprints));
    }
  }

  scan(true);
  const timer = setInterval(() => scan(false), 1500);
  // Expose immediate rescan for tests / forced refresh without waiting 1.5s.
  timer.scan = (force = false) => scan(force);
  timer.getFingerprints = () => Object.fromEntries(fingerprints);
  return timer;
}
