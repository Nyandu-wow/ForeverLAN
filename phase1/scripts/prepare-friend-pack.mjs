/**
 * the host runs this once before the weekend.
 * Builds a zip-ready folder friends can use with a single double-click (INSTALL.bat).
 *
 *   node scripts/prepare-friend-pack.mjs
 *
 * Output: phase1/dist/ForeverLAN-Friends/
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1 = path.resolve(__dirname, "..");
const NODE_VERSION = "22.11.0";
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

function loadHostConfig() {
  const p = path.join(phase1, "config.json");
  if (!fs.existsSync(p)) {
    throw new Error("phase1/config.json missing — need lanToken");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "node_modules" || name === "data" || name === "runtime") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download ${url} → ${res.statusCode}`));
          return;
        }
        const out = createWriteStream(dest);
        pipeline(res, out).then(resolve, reject);
      })
      .on("error", reject);
  });
}

function warnInternetHostUrl(url) {
  if (!/^https:\/\//i.test(String(url))) return;
  console.warn("");
  console.warn("!!! WARNING: friendHostUrl is an Internet URL:", url);
  console.warn("!!! This pack sends friends' events over the Internet (remote beta).");
  console.warn("!!! For the house LAN weekend: remove friendHostUrl from config.json and rebuild.");
  console.warn("");
}

async function verifyNodeChecksum(zipPath) {
  const sumsPath = `${zipPath}.SHASUMS256.txt`;
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, sumsPath);
  const line = fs
    .readFileSync(sumsPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().endsWith(` ${NODE_ZIP}`));
  fs.rmSync(sumsPath, { force: true });
  const expected = line?.trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  if (!expected || expected !== actual) {
    throw new Error(`portable Node checksum mismatch for ${NODE_ZIP} (expected ${expected || "?"}, got ${actual})`);
  }
}

async function ensurePortableNode(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const nodeExe = path.join(runtimeDir, "node.exe");
  const cacheDir = path.join(phase1, ".cache", `node-v${NODE_VERSION}-win-x64`);
  const cachedExe = path.join(cacheDir, "node.exe");
  const cachedLicense = path.join(cacheDir, "LICENSE");

  if (fs.existsSync(cachedExe)) {
    fs.copyFileSync(cachedExe, nodeExe);
    if (fs.existsSync(cachedLicense)) fs.copyFileSync(cachedLicense, path.join(runtimeDir, "LICENSE"));
    console.log("portable node: from cache");
    return;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(phase1, ".cache", NODE_ZIP);
  console.log("downloading portable Node", NODE_VERSION, "…");
  await download(NODE_URL, zipPath);
  await verifyNodeChecksum(zipPath);

  const extractDir = path.join(phase1, ".cache", "_extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xf", zipPath, "-C", extractDir], { stdio: "inherit" });
  const extracted = path.join(extractDir, `node-v${NODE_VERSION}-win-x64`, "node.exe");
  if (!fs.existsSync(extracted)) {
    throw new Error(`node.exe not found after extract: ${extracted}`);
  }
  fs.copyFileSync(extracted, cachedExe);
  fs.copyFileSync(cachedExe, nodeExe);
  const license = path.join(extractDir, `node-v${NODE_VERSION}-win-x64`, "LICENSE");
  if (fs.existsSync(license)) {
    fs.copyFileSync(license, cachedLicense);
    fs.copyFileSync(license, path.join(runtimeDir, "LICENSE"));
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  console.log("portable node: ready + cached");
}

function zipFriendPack(folderPath) {
  const zipPath = `${folderPath}.zip`;
  fs.rmSync(zipPath, { force: true });
  // PowerShell Compress-Archive — available on Windows 10+
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${folderPath}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: "inherit" }
  );
  return zipPath;
}

async function main() {
  const cfg = loadHostConfig();
  if (!cfg.lanToken || cfg.lanToken.includes("GENERATE")) {
    throw new Error("Set a real lanToken in phase1/config.json before preparing the friend pack");
  }

  const out = path.join(phase1, "dist", "ForeverLAN-Friends");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const runtimeDir = path.join(out, "runtime");
  await ensurePortableNode(runtimeDir);

  execFileSync(process.execPath, [path.join(phase1, "scripts", "sync-addon-interface.mjs")], {
    cwd: phase1,
    stdio: "inherit",
  });

  copyDir(path.join(phase1, "collector"), path.join(out, "collector"));
  copyDir(path.join(phase1, "addon", "ForeverLAN"), path.join(out, "addon", "ForeverLAN"));
  // Keep friend-pack/ addon mirror in sync for beta rebuilds (not a freeze artifact).
  const mirror = path.join(phase1, "friend-pack", "ForeverLAN");
  fs.rmSync(mirror, { recursive: true, force: true });
  copyDir(path.join(phase1, "addon", "ForeverLAN"), mirror);

  for (const name of [
    "INSTALL.bat",
    "Uninstall.bat",
    // Linux scripts ship only in ForeverLAN-SteamDeck.zip (LF-normalized + Linux Node).
    "agent.js",
    "discover.js",
    "stamp-wow.mjs",
    "pick-wow.ps1",
  ]) {
    const src = path.join(phase1, "friend-client", name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, name));
  }

  const party = {
    lanToken: cfg.lanToken,
    httpPort: Number(cfg.listenPort || 8765),
    // hostUrl optional — agent auto-discovers on the LAN
  };
  if (cfg.friendHostUrl) {
    party.hostUrl = cfg.friendHostUrl;
    warnInternetHostUrl(cfg.friendHostUrl);
  }
  fs.writeFileSync(path.join(out, "party.json"), JSON.stringify(party, null, 2), "utf8");

  const readMe = [
    "Forever LAN",
    "===========",
    "",
    "INSTALL",
    "  Double-click INSTALL.bat",
    "  When asked, pick your WoW: Forever folder",
    "  (the folder with WowB.exe, usually _classic_beta_).",
    "  Then in WoW: enable the ForeverLAN addon.",
    "  That is everything. No websites. No command prompts.",
    "",
  ];
  if (cfg.friendHostUrl) {
    readMe.push(
      "REMOTE BETA",
      "  This pack points at the ingest host over the Internet.",
      `  Ingest: ${String(cfg.friendHostUrl).replace(/\/$/, "")}`,
      "  Dashboard (if shared): ask the host — Cloudflare Access login.",
      "  Play as usual — the agent syncs when online.",
      ""
    );
  }
  readMe.push(
    "STEAM DECK / Linux",
    "  Use ForeverLAN-SteamDeck.zip instead (ask the host) — this zip is Windows-only.",
    "",
    "Optional in-game: type /combatlog once per session,",
    "and use Push LAN (or logout) so data saves.",
    "",
    "UNINSTALL (after the LAN weekend)",
    "  Double-click Uninstall.bat",
    "  (or use \"Uninstall Forever LAN\" on your Desktop after install)",
    "  Removes the agent, Startup entry, WoW addon, and local data.",
    "  Your PC is back to how it was before Forever LAN.",
    ""
  );
  fs.writeFileSync(path.join(out, "READ ME.txt"), readMe.join("\r\n"), "utf8");

  console.log("");
  console.log("Friend pack folder:");
  console.log(" ", out);
  const zipPath = zipFriendPack(out);
  console.log("Friend pack zip (send this):");
  console.log(" ", zipPath);
  console.log("");
  console.log("Friends: unzip → INSTALL.bat → enable addon in WoW.");
  console.log("Steam Deck: node scripts/prepare-steamdeck-pack.mjs → ForeverLAN-SteamDeck.zip");
  console.log("After LAN: Uninstall.bat (or Desktop shortcut).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
