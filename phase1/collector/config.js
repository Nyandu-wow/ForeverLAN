import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1Root = path.resolve(__dirname, "..");

export function loadConfig(configPath = process.env.FOREVERLAN_CONFIG) {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(phase1Root, "config.json");
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  // Prefer a local (non-OneDrive) dataDir — sync locks wedge the host under load.
  const dataDir = raw.dataDir
    ? path.resolve(raw.dataDir)
    : path.join(phase1Root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    ...raw,
    configPath: resolved,
    phase1Root,
    dataDir,
    outboxPath: path.resolve(dataDir, path.basename(raw.outboxPath || "outbox.jsonl")),
    statePath: path.resolve(dataDir, path.basename(raw.statePath || "collector-state.json")),
  };
}

export function discoverClientDir(config) {
  const candidates = [];

  if (process.env.FOREVERLAN_WOW_CLIENT) {
    candidates.push(process.env.FOREVERLAN_WOW_CLIENT);
  }
  if (config.wowRoot && config.clientFolder) {
    candidates.push(path.join(config.wowRoot, config.clientFolder));
  }
  if (config.wowRoot) {
    candidates.push(config.wowRoot);
  }

  const defaults = [
    "C:\\Games\\FOREVER\\World of Warcraft\\_classic_beta_",
    "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
    "C:\\Program Files\\World of Warcraft\\_classic_beta_",
  ];
  candidates.push(...defaults);

  for (const c of candidates) {
    if (!c) continue;
    const normalized = path.resolve(c);
    if (fs.existsSync(path.join(normalized, "WowB.exe")) || fs.existsSync(path.join(normalized, "Wow.exe"))) {
      return normalized;
    }
    // Allow pointing at parent WoW folder
    const nested = path.join(normalized, "_classic_beta_");
    if (fs.existsSync(path.join(nested, "WowB.exe"))) {
      return nested;
    }
  }
  return null;
}

export function logsDir(clientDir) {
  return path.join(clientDir, "Logs");
}

/**
 * Forever writes timestamped combat logs (WoWCombatLog-MMDDYY_HHMMSS.txt).
 * Prefer the newest matching file; fall back to classic WoWCombatLog.txt.
 */
export function findCombatLogPath(clientDir) {
  const dir = logsDir(clientDir);
  if (!fs.existsSync(dir)) return path.join(dir, "WoWCombatLog.txt");
  let best = null;
  let bestMtime = -1;
  for (const name of fs.readdirSync(dir)) {
    if (!/^WoWCombatLog.*\.txt$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (st.mtimeMs >= bestMtime) {
        bestMtime = st.mtimeMs;
        best = full;
      }
    } catch {
      /* skip */
    }
  }
  return best || path.join(dir, "WoWCombatLog.txt");
}

/** @deprecated use findCombatLogPath — kept for callers */
export function combatLogPath(clientDir) {
  return findCombatLogPath(clientDir);
}

export function chatLogPath(clientDir) {
  return path.join(logsDir(clientDir), "WoWChatLog.txt");
}
