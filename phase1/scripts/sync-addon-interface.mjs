/**
 * Internal — collector/pack builds call this. Matches TOC Interface to the live client exactly.
 */
import {
  ensureInstalledAddonInterface,
  parseInterfaceLine,
  resolveClientDir,
  targetInterfaces,
  addonSourceDir,
  FOREVER_DEFAULT,
} from "../lib/addon-interface.js";
import fs from "node:fs";
import path from "node:path";

const checkOnly = process.argv.includes("--check");
const clientDir = resolveClientDir();
const target = targetInterfaces(clientDir);
const baseToc = path.join(addonSourceDir(), "ForeverLAN.toc");
const current = fs.existsSync(baseToc) ? parseInterfaceLine(fs.readFileSync(baseToc, "utf8")) : [];
const foreverCurrent = current.find((n) => n >= 16000 && n < 17000) || 0;

console.log(`[sync-addon-interface] client=${clientDir || "(not found)"}`);
console.log(
  `[sync-addon-interface] target=${target.forever}, ${target.mainline} (${target.source})`
);
console.log(
  `[sync-addon-interface] source forever=${foreverCurrent || "(none)"} (default ${FOREVER_DEFAULT})`
);

if (checkOnly) {
  process.exit(foreverCurrent === target.forever ? 0 : 1);
}

const result = ensureInstalledAddonInterface(clientDir, { patchSource: true });
console.log(
  result.changed
    ? `[sync-addon-interface] updated → ${target.forever}`
    : `[sync-addon-interface] already ${target.forever}`
);
