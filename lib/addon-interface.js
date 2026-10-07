/**
 * Forever TOC Interface — match the client exactly.
 *
 * Forever treats a *wrong* Interface (including too-high) as incompatible.
 * We copy the live value from peer Forever addons / SavedVariables toc_version.
 * Collector rewrites the installed TOC on start so the host never runs a sync script.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** Known-good Forever beta Interface when peers/SV are unavailable. */
export const FOREVER_DEFAULT = 16001;
/** Mainline-family companion number used by working Forever addons today. */
export const MAINLINE_DEFAULT = 120100;

const CLIENT_CANDIDATES = [
  process.env.FOREVERLAN_WOW_CLIENT,
  "C:\\Games\\FOREVER\\World of Warcraft\\_classic_beta_",
  "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
  "C:\\Program Files\\World of Warcraft\\_classic_beta_",
].filter(Boolean);

export function resolveClientDir(extraDirs = []) {
  for (const raw of [...extraDirs, ...CLIENT_CANDIDATES]) {
    if (!raw) continue;
    const dir = path.resolve(String(raw));
    if (fs.existsSync(path.join(dir, "WowB.exe")) || fs.existsSync(path.join(dir, "Wow.exe"))) {
      return dir;
    }
    const nested = path.join(dir, "_classic_beta_");
    if (fs.existsSync(path.join(nested, "WowB.exe"))) return nested;
  }
  return null;
}

export function parseInterfaceLine(text) {
  const m = String(text || "").match(/^##\s*Interface:\s*(.+)$/im);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Forever beta Interface: 5-digit 16xxx (not mistyped 160001). */
export function isForeverInterface(n) {
  return Number.isFinite(n) && n >= 16000 && n < 17000 && String(Math.trunc(n)).length === 5;
}

export function isMainlineFamilyInterface(n) {
  return Number.isFinite(n) && n >= 100000 && n < 200000;
}

function collectPeerInterfaces(clientDir) {
  const addonsRoot = path.join(clientDir, "Interface", "AddOns");
  const forever = [];
  const mainline = [];
  if (!fs.existsSync(addonsRoot)) return { forever, mainline };
  for (const name of fs.readdirSync(addonsRoot)) {
    if (/^foreverlan$/i.test(name)) continue;
    const dir = path.join(addonsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.toc$/i.test(file)) continue;
      for (const n of parseInterfaceLine(fs.readFileSync(path.join(dir, file), "utf8"))) {
        if (isForeverInterface(n)) forever.push({ n, from: `${name}/${file}` });
        if (isMainlineFamilyInterface(n)) mainline.push({ n, from: `${name}/${file}` });
      }
    }
  }
  return { forever, mainline };
}

function collectSvTocVersion(clientDir) {
  const accountRoot = path.join(clientDir, "WTF", "Account");
  if (!fs.existsSync(accountRoot)) return null;
  let best = null;
  let bestMtime = 0;

  function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (ent.name !== "ForeverLAN.lua") continue;
      const st = fs.statSync(full);
      if (st.mtimeMs < bestMtime) continue;
      const text = fs.readFileSync(full, "utf8");
      const m = text.match(/\["toc_version"\]\s*=\s*(\d+)/) || text.match(/\btoc_version\s*=\s*(\d+)/);
      if (!m) continue;
      const n = Number(m[1]);
      if (!isForeverInterface(n)) continue;
      best = n;
      bestMtime = st.mtimeMs;
    }
  }

  walk(accountRoot);
  return best;
}

/**
 * Exact Interface list Forever will accept — match peers/SV, never invent a higher ceiling.
 */
export function targetInterfaces(clientDir) {
  let forever = FOREVER_DEFAULT;
  let mainline = MAINLINE_DEFAULT;
  let source = `default ${FOREVER_DEFAULT}`;

  if (clientDir) {
    const peer = collectPeerInterfaces(clientDir);
    if (peer.forever.length) {
      // Prefer the most common Forever Interface among peers (usually exact client value).
      const counts = new Map();
      for (const p of peer.forever) counts.set(p.n, (counts.get(p.n) || 0) + 1);
      let bestN = forever;
      let bestC = 0;
      for (const [n, c] of counts) {
        if (c > bestC || (c === bestC && n > bestN)) {
          bestN = n;
          bestC = c;
        }
      }
      forever = bestN;
      source = `peer ${peer.forever.find((p) => p.n === bestN)?.from || "addon"}`;
    }
    const sv = collectSvTocVersion(clientDir);
    if (sv) {
      forever = sv;
      source = `SavedVariables toc_version ${sv}`;
    }
    if (peer.mainline.length) {
      const counts = new Map();
      for (const p of peer.mainline) counts.set(p.n, (counts.get(p.n) || 0) + 1);
      let bestN = mainline;
      let bestC = 0;
      for (const [n, c] of counts) {
        if (c > bestC || (c === bestC && n > bestN)) {
          bestN = n;
          bestC = c;
        }
      }
      mainline = bestN;
    }
  }

  return { forever, mainline, source, list: [forever, mainline] };
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function rewriteInterfaceLine(text, interfaceValue) {
  let body = stripBom(text).replace(/\r\n/g, "\n");
  body = body.replace(/^##\s*Interface:\s*.+\n?/gim, "");
  body = body.replace(/^\s+/, "");
  return `## Interface: ${interfaceValue}\n${body}`;
}

function ensureAllowLoadGameType(text, value) {
  let body = stripBom(text).replace(/\r\n/g, "\n");
  body = body.replace(/^##\s*AllowLoadGameType:\s*.+\n?/gim, "");
  return body.replace(
    /^(##\s*Interface:\s*.+$)/im,
    `$1\n## AllowLoadGameType: ${value}`
  );
}

function patchTocFile(filePath, { interfaceValue, allowLoad }) {
  if (!fs.existsSync(filePath)) return false;
  const prev = fs.readFileSync(filePath, "utf8");
  let next = rewriteInterfaceLine(prev, interfaceValue);
  if (allowLoad) next = ensureAllowLoadGameType(next, allowLoad);
  if (stripBom(prev).replace(/\r\n/g, "\n") === next) return false;
  fs.writeFileSync(filePath, next, "utf8");
  return true;
}

/**
 * Patch installed AddOns/ForeverLAN TOCs (and optional source tree) to the exact client Interface.
 */
export function ensureInstalledAddonInterface(clientDir, opts = {}) {
  const { forever, mainline, source } = targetInterfaces(clientDir);
  const baseIface = `${forever}, ${mainline}`;
  const camelotIface = String(forever);
  const changedPaths = [];

  const installedDir = clientDir
    ? path.join(clientDir, "Interface", "AddOns", "ForeverLAN")
    : null;
  if (installedDir && fs.existsSync(installedDir)) {
    const base = path.join(installedDir, "ForeverLAN.toc");
    const camelot = path.join(installedDir, "ForeverLAN_Camelot.toc");
    if (patchTocFile(base, { interfaceValue: baseIface, allowLoad: "camelot, mainline" })) {
      changedPaths.push(base);
    }
    if (fs.existsSync(camelot)) {
      if (patchTocFile(camelot, { interfaceValue: camelotIface, allowLoad: "camelot" })) {
        changedPaths.push(camelot);
      }
    } else if (fs.existsSync(base)) {
      let body = fs.readFileSync(base, "utf8");
      body = rewriteInterfaceLine(body, camelotIface);
      body = ensureAllowLoadGameType(body, "camelot");
      fs.writeFileSync(camelot, body, "utf8");
      changedPaths.push(camelot);
    }
  }

  if (opts.patchSource) {
    const srcDir = opts.sourceDir || path.join(root, "addon", "ForeverLAN");
    const base = path.join(srcDir, "ForeverLAN.toc");
    const camelot = path.join(srcDir, "ForeverLAN_Camelot.toc");
    if (patchTocFile(base, { interfaceValue: baseIface, allowLoad: "camelot, mainline" })) {
      changedPaths.push(base);
    }
    if (patchTocFile(camelot, { interfaceValue: camelotIface, allowLoad: "camelot" })) {
      changedPaths.push(camelot);
    }
  }

  return { changed: changedPaths.length > 0, forever, mainline, source, paths: changedPaths };
}

export function addonSourceDir() {
  return path.join(root, "addon", "ForeverLAN");
}
