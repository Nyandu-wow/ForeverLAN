/**
 * Build a Steam Deck / SteamOS friend pack (no Windows INSTALL.bat).
 *
 *   node scripts/prepare-steamdeck-pack.mjs
 *
 * Output:
 *   dist/ForeverLAN-SteamDeck/
 *   dist/ForeverLAN-SteamDeck.zip  ← copy to the Deck
 *
 * ZIP rules (SteamOS-critical):
 *   - entry paths use `/` (never `\`) — PowerShell Compress-Archive breaks Linux unzip
 *   - install-steamdeck.sh + runtime/bin/node marked Unix executable (mode 0755)
 *   - shell / markdown / party text normalized to LF (no CRLF shebang failures)
 *
 * Deck: unzip → bash install-steamdeck.sh
 *   (./install-steamdeck.sh also works when unzip honors Unix modes)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolveFriendPartySource } from "./lib/friend-party-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** Match install-steamdeck.sh */
const NODE_VERSION = "22.11.0";
const NODE_ARCH = "linux-x64";
const NODE_TAR = `node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}`;

function loadHostConfig() {
  const p = path.join(root, "config.json");
  if (!fs.existsSync(p)) {
    throw new Error("config.json missing — need lanToken");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Weekend roster for friend/Deck packs only (not CurseForge). */
function injectFriendPartyDefaults(addonDir, cfg) {
  const src = resolveFriendPartySource(root, cfg);
  src.write(path.join(addonDir, "ForeverLAN_Party.lua"));
  for (const tocName of ["ForeverLAN.toc", "ForeverLAN_Camelot.toc"]) {
    const tocPath = path.join(addonDir, tocName);
    if (!fs.existsSync(tocPath)) continue;
    let toc = fs.readFileSync(tocPath, "utf8");
    if (!/ForeverLAN_Party\.lua/.test(toc)) {
      toc = toc.replace(/^(ForeverLAN\.lua)\s*$/m, "ForeverLAN_Party.lua\n$1");
      fs.writeFileSync(tocPath, toc, "utf8");
    }
  }
  console.log("friend party defaults:", src.label, "→", addonDir);
}

function toLf(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function writeUnixText(dest, text) {
  fs.writeFileSync(dest, toLf(text), "utf8");
}

function copyUnixTextFile(src, dest) {
  writeUnixText(dest, fs.readFileSync(src, "utf8"));
}

function copyDir(src, dest, { textExts = null } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "node_modules" || name === "data" || name === "runtime") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      copyDir(from, to, { textExts });
    } else if (textExts && textExts.has(path.extname(name).toLowerCase())) {
      copyUnixTextFile(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
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

async function ensureLinuxNode(runtimeDir) {
  const cacheRoot = path.join(root, ".cache", `node-v${NODE_VERSION}-${NODE_ARCH}`);
  const cachedBin = path.join(cacheRoot, "bin", "node");

  if (fs.existsSync(cachedBin)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    copyDir(cacheRoot, runtimeDir);
    console.log("linux node: from cache");
    return;
  }

  fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
  const tarPath = path.join(root, ".cache", NODE_TAR);
  if (!fs.existsSync(tarPath)) {
    console.log("downloading Node", NODE_VERSION, NODE_ARCH, "…");
    await download(NODE_URL, tarPath);
  } else {
    console.log("linux node tarball: cached");
  }

  const extractDir = path.join(root, ".cache", `_extract-linux-${NODE_VERSION}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  // Official tarball includes Unix symlinks (npm/npx/corepack). Windows tar cannot
  // create those; we only need bin/node for the Deck agent.
  try {
    execFileSync(
      "tar",
      [
        "-xJf",
        tarPath,
        "-C",
        extractDir,
        "--exclude",
        "*/bin/npm",
        "--exclude",
        "*/bin/npx",
        "--exclude",
        "*/bin/corepack",
      ],
      { stdio: "inherit" }
    );
  } catch {
    /* symlink failures on Windows — OK if node binary extracted */
  }

  const extracted = path.join(extractDir, `node-v${NODE_VERSION}-${NODE_ARCH}`);
  const extractedBin = path.join(extracted, "bin", "node");
  if (!fs.existsSync(extractedBin)) {
    throw new Error(`linux node binary missing after extract: ${extractedBin}`);
  }

  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(cacheRoot, "bin"), { recursive: true });
  fs.copyFileSync(extractedBin, path.join(cacheRoot, "bin", "node"));
  const license = path.join(extracted, "LICENSE");
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(cacheRoot, "LICENSE"));
  fs.rmSync(extractDir, { recursive: true, force: true });

  fs.rmSync(runtimeDir, { recursive: true, force: true });
  copyDir(cacheRoot, runtimeDir);
  console.log("linux node: ready + cached (bin/node only)");
}

/**
 * Build a Linux-friendly ZIP:
 * - forward-slash entry names (SteamOS unzip treats `\` as a literal filename)
 * - Unix create_system + executable mode for .sh and runtime/bin/node
 *
 * Uses `py -3` (Windows) — not PowerShell Compress-Archive.
 */
function zipPackUnix(folderPath) {
  const zipPath = `${folderPath}.zip`;
  fs.rmSync(zipPath, { force: true });

  const py = `
import os, sys, zipfile

root = os.path.abspath(sys.argv[1])
out = os.path.abspath(sys.argv[2])

def is_exec(arc: str) -> bool:
    name = os.path.basename(arc)
    if name.endswith(".sh"):
        return True
    if arc.replace("\\\\", "/") == "runtime/bin/node" or arc.endswith("/bin/node"):
        return True
    return False

bad = []
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, _, files in os.walk(root):
        for name in files:
            full = os.path.join(dirpath, name)
            arc = os.path.relpath(full, root).replace("\\\\", "/")
            if "\\\\" in arc or arc.startswith("/") or ":" in arc.split("/")[0]:
                bad.append(arc)
            zi = zipfile.ZipInfo(filename=arc)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.create_system = 3  # Unix
            mode = 0o100755 if is_exec(arc) else 0o100644
            zi.external_attr = (mode & 0xFFFF) << 16
            with open(full, "rb") as fh:
                data = fh.read()
            # Guard: shell scripts must not contain CRLF (shebang break on SteamOS)
            if name.endswith(".sh") and b"\\r" in data:
                raise SystemExit(f"CRLF in shell script before zip: {arc}")
            zf.writestr(zi, data)

if bad:
    raise SystemExit("bad zip entry names: " + ", ".join(bad[:5]))

# Self-check entry list
with zipfile.ZipFile(out, "r") as zf:
    names = zf.namelist()
for n in names:
    if "\\\\" in n:
        raise SystemExit(f"zip still contains backslash entry: {n!r}")
need = [
    "install-steamdeck.sh",
    "start-agent.sh",
    "addon/ForeverLAN/ForeverLAN.toc",
    "collector/index.js",
    "runtime/bin/node",
    "party.json",
    "agent.js",
]
missing = [n for n in need if n not in names]
if missing:
    raise SystemExit("zip missing entries: " + ", ".join(missing))
print(f"zip ok: {len(names)} entries, forward-slash paths, Unix modes")
`;

  execFileSync("py", ["-3", "-c", py, folderPath, zipPath], { stdio: "inherit" });
  return zipPath;
}

function assertNoCrlf(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0x0d)) {
    throw new Error(`CRLF remains in ${filePath} — SteamOS would fail the shebang`);
  }
}

async function main() {
  const cfg = loadHostConfig();
  if (!cfg.lanToken || cfg.lanToken.includes("GENERATE")) {
    throw new Error("Set a real lanToken in config.json before preparing the Steam Deck pack");
  }

  const out = path.join(root, "dist", "ForeverLAN-SteamDeck");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  await ensureLinuxNode(path.join(out, "runtime"));

  execFileSync(process.execPath, [path.join(root, "scripts", "sync-addon-interface.mjs")], {
    cwd: root,
    stdio: "inherit",
  });

  const textExts = new Set([".js", ".mjs", ".json", ".md", ".txt", ".sh", ".bat", ".ps1", ".example"]);
  copyDir(path.join(root, "collector"), path.join(out, "collector"), { textExts });
  copyDir(path.join(root, "addon", "ForeverLAN"), path.join(out, "addon", "ForeverLAN"), {
    textExts: new Set([".toc", ".lua", ".md", ".txt"]),
  });
  injectFriendPartyDefaults(path.join(out, "addon", "ForeverLAN"), cfg);
  // Keep friend-pack/ addon mirror aligned whenever Deck packs rebuild.
  const mirror = path.join(root, "friend-pack", "ForeverLAN");
  fs.rmSync(mirror, { recursive: true, force: true });
  copyDir(path.join(root, "addon", "ForeverLAN"), mirror, {
    textExts: new Set([".toc", ".lua", ".md", ".txt"]),
  });
  injectFriendPartyDefaults(mirror, cfg);

  for (const name of [
    "agent.js",
    "discover.js",
    "start-agent.sh",
    "install-steamdeck.sh",
    "STEAMDECK.md",
    "foreverlan-agent.service",
  ]) {
    const src = path.join(root, "friend-client", name);
    if (!fs.existsSync(src)) throw new Error(`missing ${src}`);
    copyUnixTextFile(src, path.join(out, name));
  }
  assertNoCrlf(path.join(out, "install-steamdeck.sh"));
  assertNoCrlf(path.join(out, "start-agent.sh"));

  const party = {
    lanToken: cfg.lanToken,
    httpPort: Number(cfg.listenPort || 8765),
  };
  if (cfg.friendHostUrl) {
    party.hostUrl = cfg.friendHostUrl;
    if (/^https:\/\//i.test(String(cfg.friendHostUrl))) {
      console.warn("");
      console.warn("!!! WARNING: friendHostUrl is an Internet URL:", cfg.friendHostUrl);
      console.warn("!!! For the house LAN weekend: remove friendHostUrl from config.json and rebuild.");
      console.warn("");
    }
  }
  writeUnixText(path.join(out, "party.json"), JSON.stringify(party, null, 2) + "\n");

  writeUnixText(
    path.join(out, "READ ME.txt"),
    [
      "Forever LAN — Steam Deck",
      "========================",
      "",
      "1. Copy this zip onto the Deck and unzip it",
      "2. Desktop Mode → Konsole → cd into this folder",
      "3. Run (no chmod needed):",
      "",
      "     bash install-steamdeck.sh",
      "",
      "   If WowB.exe is not found automatically:",
      "",
      '     bash install-steamdeck.sh "/home/deck/Games/Forever/WoW/World of Warcraft/_classic_beta_"',
      "",
      "4. In WoW: enable ForeverLAN → /reload",
      "   Optional: /combatlog once, Push LAN after sessions",
      "",
      "Host : same Wi-Fi, start-weekend.bat, firewall open.",
      "Full notes: STEAMDECK.md",
      "",
      "Linux Node is bundled in runtime/bin/node (no download on the Deck).",
      "",
    ].join("\n")
  );

  console.log("");
  console.log("Steam Deck pack folder:");
  console.log(" ", out);
  const zipPath = zipPackUnix(out);
  console.log("Steam Deck zip (copy to Deck):");
  console.log(" ", zipPath);
  console.log("");
  console.log("On Deck: unzip → bash install-steamdeck.sh");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
