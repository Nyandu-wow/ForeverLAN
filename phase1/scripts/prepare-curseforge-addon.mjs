/**
 * Build an addon-only CurseForge zip from the canonical source.
 *
 *   node scripts/prepare-curseforge-addon.mjs
 *
 * Output:
 *   phase1/dist/curseforge/ForeverLAN-0.1.xx.zip
 *   phase1/dist/curseforge/ForeverLAN/   (unpacked mirror)
 *
 * Contains ONLY the WoW addon folder — never collector, agent, tokens, or host.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1 = path.resolve(__dirname, "..");
const srcDir = path.join(phase1, "addon", "ForeverLAN");
const outRoot = path.join(phase1, "dist", "curseforge");
const staging = path.join(outRoot, "ForeverLAN");

function readVersion(tocText) {
  const m = tocText.match(/^##\s*Version:\s*(.+)$/m);
  return (m && m[1].trim()) || "0.0.0";
}

function syncInterface() {
  execFileSync(process.execPath, [path.join(phase1, "scripts", "sync-addon-interface.mjs")], {
    cwd: phase1,
    stdio: "inherit",
  });
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
  for (const name of fs.readdirSync(srcDir)) {
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
    "host",
    "INSTALL.bat",
    "node.exe",
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

syncInterface();
const toc = fs.readFileSync(path.join(srcDir, "ForeverLAN.toc"), "utf8");
const version = readVersion(toc);
fs.mkdirSync(outRoot, { recursive: true });
copyAddon();
assertNoForbidden(staging);
const zipPath = zipAddon(version);
assertNoForbidden(staging);

console.log("CurseForge addon package ready:");
console.log(" ", staging);
console.log(" ", zipPath);
console.log(" version", version);
