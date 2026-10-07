/**
 * Build the addon-only zip and upload it to CurseForge (WoW).
 *
 * Setup (one time):
 *   1. https://www.curseforge.com/account/api-tokens  → create token
 *   2. Copy .env.example → .env  and set CURSEFORGE_API_TOKEN
 *   3. Copy curseforge.example.json → curseforge.json
 *      Set projectId (number from your project URL / sidebar)
 *      Optionally set gameVersionNames or gameVersionIds
 *
 * Usage:
 *   node scripts/upload-curseforge.mjs
 *   node scripts/upload-curseforge.mjs --dry-run
 *   node scripts/upload-curseforge.mjs --list-versions
 *   node scripts/upload-curseforge.mjs --release-type beta
 *
 * Docs: https://support.curseforge.com/support/solutions/articles/9000197321-curseforge-upload-api
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadDotEnv() {
  for (const p of [path.join(root, ".env")]) {
    if (!fs.existsSync(p)) continue;
    // Strip UTF-8 BOM (Windows editors often write one).
    const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] == null || process.env[m[1]] === "") {
        process.env[m[1]] = v;
      }
    }
  }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function loadConfig() {
  const cfgPath = path.join(root, "curseforge.json");
  const example = path.join(root, "curseforge.example.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(
      `Missing ${cfgPath}\nCopy ${example} → curseforge.json and set projectId.`
    );
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

function readVersionFromToc() {
  const toc = fs.readFileSync(path.join(root, "addon", "ForeverLAN", "ForeverLAN.toc"), "utf8");
  const m = toc.match(/^##\s*Version:\s*(.+)$/m);
  return (m && m[1].trim()) || "0.0.0";
}

/** First ## section of CHANGELOG.md (markdown body under that heading). */
function extractLatestChangelog(changelogPath) {
  const text = fs.readFileSync(changelogPath, "utf8");
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return text.trim();
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

function apiBase(endpoint) {
  return `https://${endpoint}.curseforge.com`;
}

async function cfFetch(endpoint, token, apiPath, opts = {}) {
  const url = `${apiBase(endpoint)}${apiPath}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "X-Api-Token": token,
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* plain text error */
  }
  return { ok: res.ok, status: res.status, text, json };
}

async function listVersions(endpoint, token) {
  const { ok, status, json, text } = await cfFetch(endpoint, token, "/api/game/versions");
  if (!ok) {
    throw new Error(`GET /api/game/versions → ${status}\n${text}`);
  }
  return Array.isArray(json) ? json : [];
}

function resolveGameVersionIds(versions, cfg) {
  if (Array.isArray(cfg.gameVersionIds) && cfg.gameVersionIds.length) {
    return cfg.gameVersionIds.map(Number);
  }
  const names = Array.isArray(cfg.gameVersionNames) ? cfg.gameVersionNames : [];
  if (!names.length) {
    return [];
  }
  const byName = new Map(versions.map((v) => [String(v.name).toLowerCase(), v.id]));
  const bySlug = new Map(versions.map((v) => [String(v.slug || "").toLowerCase(), v.id]));
  const ids = [];
  for (const name of names) {
    const key = String(name).toLowerCase();
    const id = byName.get(key) || bySlug.get(key);
    if (id == null) {
      throw new Error(
        `Unknown game version "${name}". Run: node scripts/upload-curseforge.mjs --list-versions`
      );
    }
    ids.push(id);
  }
  return ids;
}

function printVersionHints(versions) {
  const interesting = versions.filter((v) => {
    const n = String(v.name || "").toLowerCase();
    return (
      n.includes("forever") ||
      n.includes("camelot") ||
      n.includes("classic") ||
      n.includes("1.60") ||
      n.includes("12.") ||
      n.includes("retail") ||
      n.includes("mainline")
    );
  });
  const rows = (interesting.length ? interesting : versions.slice(0, 40)).map(
    (v) => `${v.id}\t${v.name}\t(type ${v.gameVersionTypeID})`
  );
  console.log(rows.join("\n"));
  console.log(`\n(${versions.length} total versions; showing ${rows.length})`);
}

async function main() {
  loadDotEnv();
  const token = process.env.CURSEFORGE_API_TOKEN || process.env.CF_API_TOKEN || "";
  if (!token) {
    throw new Error(
      "Set CURSEFORGE_API_TOKEN in repo-root .env (see .env.example).\n" +
        "Create a token at https://www.curseforge.com/account/api-tokens"
    );
  }

  const cfg = loadConfig();
  const endpoint = cfg.endpoint || "wow";
  const projectId = String(cfg.projectId || "").trim();

  if (hasFlag("--list-versions")) {
    const versions = await listVersions(endpoint, token);
    printVersionHints(versions);
    return;
  }

  if (!projectId || projectId.includes("REPLACE")) {
    throw new Error("Set numeric projectId in curseforge.json");
  }

  console.log("Building CurseForge zip…");
  execFileSync(process.execPath, [path.join(root, "scripts", "prepare-curseforge-addon.mjs")], {
    cwd: root,
    stdio: "inherit",
  });

  const version = readVersionFromToc();
  const zipPath = path.join(root, "dist", "curseforge", `ForeverLAN-${version}.zip`);
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Zip missing: ${zipPath}`);
  }

  const changelogRel = cfg.changelogFile || "addon/ForeverLAN/CHANGELOG.md";
  const changelogPath = path.join(root, changelogRel);
  const changelog = extractLatestChangelog(changelogPath);

  const releaseType =
    argValue("--release-type") || cfg.releaseType || "beta";
  if (!["alpha", "beta", "release"].includes(releaseType)) {
    throw new Error(`Invalid releaseType: ${releaseType}`);
  }

  const versions = await listVersions(endpoint, token);
  const gameVersions = resolveGameVersionIds(versions, cfg);
  if (!gameVersions.length) {
    console.warn(
      "Warning: no gameVersions set. CurseForge may reject the upload.\n" +
        "  Fill gameVersionNames or gameVersionIds in curseforge.json\n" +
        "  Tip: node scripts/upload-curseforge.mjs --list-versions"
    );
  }

  const metadata = {
    changelog,
    changelogType: "markdown",
    displayName: cfg.displayName || `ForeverLAN-${version}`,
    releaseType,
  };
  if (gameVersions.length) {
    metadata.gameVersions = gameVersions;
  }

  console.log("Upload target:");
  console.log(" ", `${apiBase(endpoint)}/api/projects/${projectId}/upload-file`);
  console.log(" ", "file:", zipPath);
  console.log(" ", "displayName:", metadata.displayName);
  console.log(" ", "releaseType:", releaseType);
  console.log(" ", "gameVersions:", gameVersions.length ? gameVersions.join(", ") : "(none)");
  console.log("Changelog preview:\n" + changelog.split("\n").slice(0, 12).join("\n") + "\n…");

  if (hasFlag("--dry-run")) {
    console.log("Dry run — not uploading.");
    return;
  }

  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  const bytes = fs.readFileSync(zipPath);
  form.append("file", new Blob([bytes], { type: "application/zip" }), path.basename(zipPath));

  const { ok, status, json, text } = await cfFetch(
    endpoint,
    token,
    `/api/projects/${projectId}/upload-file`,
    { method: "POST", body: form }
  );

  if (!ok) {
    throw new Error(`Upload failed HTTP ${status}\n${text}`);
  }

  console.log("CurseForge upload OK:", json || text);
  if (json && json.id) {
    console.log(`File id: ${json.id}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
