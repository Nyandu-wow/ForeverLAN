/**
 * Build an addon-only CurseForge zip from the canonical source.
 *
 *   node scripts/prepare-curseforge-addon.mjs
 *
 * Output:
 *   dist/curseforge/ForeverLAN-0.1.xx.zip
 *   dist/curseforge/ForeverLAN/   (unpacked mirror)
 *
 * Contains ONLY the WoW addon folder — never collector, agent, tokens, or host.
 * Listing copy for the CurseForge website: CURSEFORGE_LISTING.md (not in the zip).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "addon", "ForeverLAN");
const outRoot = path.join(root, "dist", "curseforge");
const staging = path.join(outRoot, "ForeverLAN");

function readVersion(tocText) {
  const m = tocText.match(/^##\s*Version:\s*(.+)$/m);
  return (m && m[1].trim()) || "0.0.0";
}

function syncInterface() {
  try {
    execFileSync(process.execPath, [path.join(root, "scripts", "sync-addon-interface.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
  } catch (err) {
    console.warn(
      "[prepare-curseforge] interface sync skipped:",
      err && err.message ? err.message : err
    );
  }
}

function copyAddon() {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const allowed = new Set([
    "ForeverLAN.toc",
    "ForeverLAN_Camelot.toc",
    "ForeverLAN.lua",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  const blockedName = /foreverlan_party|party\.json|lantoken|config\.json/i;
  for (const name of fs.readdirSync(srcDir)) {
    if (blockedName.test(name)) {
      throw new Error(`Forbidden CurseForge source file: ${name}`);
    }
    if (!allowed.has(name)) {
      console.warn(`skip (not in CurseForge allow-list): ${name}`);
      continue;
    }
    fs.copyFileSync(path.join(srcDir, name), path.join(staging, name));
  }
  if (!fs.existsSync(path.join(staging, "ForeverLAN.toc")) || !fs.existsSync(path.join(staging, "ForeverLAN.lua"))) {
    throw new Error("ForeverLAN.toc / ForeverLAN.lua missing from staging");
  }
}

function assertStorefrontCopy(tocText, readmeText) {
  const notes = (tocText.match(/^##\s*Notes:\s*(.+)$/m) || [])[1] || "";
  if (/telemetry/i.test(notes)) {
    throw new Error('TOC Notes must not say "telemetry" (CurseForge storefront wording)');
  }
  if (!/SavedVariables|never connects|disk/i.test(notes)) {
    throw new Error("TOC Notes must state local SavedVariables / disk / offline intent");
  }
  const opening = readmeText.split(/\r?\n/).slice(0, 12).join("\n");
  if (/telemetry/i.test(opening)) {
    throw new Error('README opening must not lead with "telemetry"');
  }
  if (!/never connects to the Internet/i.test(readmeText)) {
    throw new Error('README must include the phrase "never connects to the Internet"');
  }
  if (!/not (included|part of this CurseForge|in this CurseForge)/i.test(readmeText)) {
    throw new Error("README must state companion/dashboard are not in the CurseForge package");
  }
}

function zipAddon(version) {
  const zipName = `ForeverLAN-${version}.zip`;
  const zipPath = path.join(outRoot, zipName);
  fs.rmSync(zipPath, { force: true });
  // Zip so the archive root is ForeverLAN/ (CurseForge expectation).
  const ps = `
    $dest = ${JSON.stringify(zipPath)}
    if (Test-Path $dest) { Remove-Item $dest -Force }
    Compress-Archive -Path ${JSON.stringify(staging)} -DestinationPath $dest -Force
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  return zipPath;
}

function assertNoForbidden(dir) {
  const forbidden = [
    "node_modules",
    "collector",
    "agent",
    "runtime",
    "party.json",
    "config.json",
    "lanToken",
    "ForeverLAN_Party.lua",
    "host",
    "INSTALL.bat",
    "node.exe",
    "CURSEFORGE_LISTING.md",
  ];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const lower = name.toLowerCase();
      for (const bad of forbidden) {
        if (lower === bad.toLowerCase() || lower.includes("lantoken")) {
          throw new Error(`Forbidden path in CurseForge package: ${path.join(cur, name)}`);
        }
      }
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
    }
  }
}

function ensureAvatar400() {
  const srcPng = path.join(outRoot, "foreverlan-icon.png");
  const dest = path.join(outRoot, "foreverlan-avatar-400.png");
  if (!fs.existsSync(srcPng)) {
    console.warn("[prepare-curseforge] foreverlan-icon.png missing — skip 400×400 avatar");
    return null;
  }
  const ps = `
    Add-Type -AssemblyName System.Drawing
    $src = ${JSON.stringify(srcPng)}
    $dest = ${JSON.stringify(dest)}
    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap 400, 400
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, 400, 400)
    $g.Dispose()
    $img.Dispose()
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  return dest;
}

syncInterface();
const toc = fs.readFileSync(path.join(srcDir, "ForeverLAN.toc"), "utf8");
const readme = fs.readFileSync(path.join(srcDir, "README.md"), "utf8");
const version = readVersion(toc);
assertStorefrontCopy(toc, readme);
fs.mkdirSync(outRoot, { recursive: true });
copyAddon();
assertNoForbidden(staging);
const zipPath = zipAddon(version);
assertNoForbidden(staging);
const avatar = ensureAvatar400();

console.log("CurseForge addon package ready:");
console.log(" ", staging);
console.log(" ", zipPath);
console.log(" version", version);
if (avatar) console.log(" avatar", avatar);
console.log(" Paste listing from CURSEFORGE_LISTING.md (not packed into the zip).");
