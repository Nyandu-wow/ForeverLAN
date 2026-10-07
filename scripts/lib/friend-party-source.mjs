/**
 * Resolve weekend ForeverLAN_Party.lua for friend / Deck packs.
 * Preference: .local.lua (gitignored) → config.json roster → empty public stub.
 */
import fs from "node:fs";
import path from "node:path";

function luaString(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderPartyLuaFromConfig(cfg) {
  const roster = Array.isArray(cfg.lanRoster) ? cfg.lanRoster.filter(Boolean) : [];
  const aliasesIn = cfg.lanRosterAliases && typeof cfg.lanRosterAliases === "object" ? cfg.lanRosterAliases : {};
  const rosterLines = roster.map((n) => `    ${luaString(n)},`).join("\n");
  const aliasLines = Object.entries(aliasesIn)
    .map(([k, v]) => `    ${String(k).toLowerCase()} = ${luaString(v)},`)
    .join("\n");
  return [
    "-- Generated for friend INSTALL pack from local config.json (not committed).",
    "ForeverLAN_Party = {",
    "  roster = {",
    rosterLines,
    "  },",
    "  aliases = {",
    aliasLines,
    "  },",
    "}",
    "",
  ].join("\n");
}

/**
 * @param {string} root repo root
 * @param {object} cfg host config.json
 * @returns {{ label: string, write: (destPath: string) => void }}
 */
export function resolveFriendPartySource(root, cfg = {}) {
  const localPath = path.join(root, "friend-client", "ForeverLAN_Party.local.lua");
  if (fs.existsSync(localPath)) {
    return {
      label: "ForeverLAN_Party.local.lua",
      write(destPath) {
        fs.copyFileSync(localPath, destPath);
      },
    };
  }
  const roster = Array.isArray(cfg.lanRoster) ? cfg.lanRoster.filter(Boolean) : [];
  if (roster.length) {
    const text = renderPartyLuaFromConfig(cfg);
    return {
      label: "config.json lanRoster",
      write(destPath) {
        fs.writeFileSync(destPath, text, "utf8");
      },
    };
  }
  const publicPath = path.join(root, "friend-client", "ForeverLAN_Party.lua");
  return {
    label: "ForeverLAN_Party.lua (empty public stub)",
    write(destPath) {
      fs.copyFileSync(publicPath, destPath);
    },
  };
}
