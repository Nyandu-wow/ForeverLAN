/**
 * Multi-character SavedVariablesPerCharacter + CurseForge package smoke.
 * Run: node scripts/smoke-addon-multichar.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  readSavedVariablesSnapshot,
  collectEventsFromForeverLANDB,
  collectEventsFromSavedVariablesText,
  findSavedVariableFiles,
} from "../collector/savedvars.js";
import {
  eventSafelyBelongsToPlayer,
  bucketSafelyBelongsToPlayer,
  migrateAccountQueue,
  charKeyFromParts,
} from "./lib/migration-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase1 = path.resolve(__dirname, "..");
const tmp = path.join(phase1, ".cache", "smoke-addon-multichar");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

function luaEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function eventLua(ev) {
  const parts = Object.entries(ev).map(([k, v]) => {
    if (typeof v === "number") return `["${k}"] = ${v}`;
    if (typeof v === "boolean") return `["${k}"] = ${v ? "true" : "false"}`;
    return `["${k}"] = "${luaEscape(v)}"`;
  });
  return `{ ${parts.join(", ")} }`;
}

function writeSv(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : body + "\n", "utf8");
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("ok ", name);
}

console.log("\n[1] Conservative legacy migration (Alex collision)");

const river = {
  guid: "Player-1-BIGG",
  fullName: "Alex River",
  firstName: "Alex",
  lastName: "River",
  realm: "Forever",
  charKey: "Alex River-Forever",
};
const brook = {
  guid: "Player-1-DOST",
  fullName: "Alex Brook",
  firstName: "Alex",
  lastName: "Brook",
  realm: "Forever",
  charKey: "Alex Brook-Forever",
};

const legacyFlat = [
  {
    id: "bigg-1",
    type: "LOGIN",
    character: "Alex River",
    realm: "Forever",
    guid: "Player-1-BIGG",
  },
  {
    id: "dost-1",
    type: "LOGIN",
    character: "Alex Brook",
    realm: "Forever",
    guid: "Player-1-DOST",
  },
  { id: "ambig-1", type: "DING", character: "Alex" },
  { id: "orphan-1", type: "PING" },
];

test("GUID match migrates", () => {
  assert.equal(
    eventSafelyBelongsToPlayer({ id: "x", guid: "Player-1-BIGG", character: "Alex" }, river),
    true
  );
});

test("exact unique full name migrates", () => {
  assert.equal(
    eventSafelyBelongsToPlayer(
      { id: "x", character: "Alex River", realm: "Forever" },
      river
    ),
    true
  );
});

test("ambiguous short name Alex does NOT migrate to either alt", () => {
  assert.equal(eventSafelyBelongsToPlayer({ id: "a", character: "Alex" }, river), false);
  assert.equal(eventSafelyBelongsToPlayer({ id: "a", character: "Alex" }, brook), false);
});

test("missing character does not migrate", () => {
  assert.equal(eventSafelyBelongsToPlayer({ id: "o", type: "PING" }, river), false);
});

test("schema-2 short bucket Alex is NOT claimed by surnamed alts", () => {
  assert.equal(bucketSafelyBelongsToPlayer("Alex", river), false);
  assert.equal(bucketSafelyBelongsToPlayer("Alex", brook), false);
  assert.equal(bucketSafelyBelongsToPlayer("__legacy__", river), false);
  assert.equal(bucketSafelyBelongsToPlayer("Alex River-Forever", river), true);
  assert.equal(bucketSafelyBelongsToPlayer("Alex River", river), true);
});

test("River login takes only safe events; ambiguous stay on account", () => {
  const accountDb = {
    pending: legacyFlat.map((e) => ({ ...e })),
    characters: {
      Alex: { pending: [{ id: "bucket-short", character: "Alex", type: "LOGIN" }] },
      "Alex River-Forever": {
        pending: [{ id: "bucket-bigg", character: "Alex River", type: "LOGIN" }],
      },
    },
  };
  const { charDb, accountDb: left } = migrateAccountQueue(accountDb, { pending: [] }, river);
  const ids = charDb.pending.map((e) => e.id).sort();
  assert.deepEqual(ids, ["bigg-1", "bucket-bigg"]);
  assert.ok(left.pending.some((e) => e.id === "ambig-1"));
  assert.ok(left.pending.some((e) => e.id === "dost-1"));
  assert.ok(left.pending.some((e) => e.id === "orphan-1"));
  assert.ok(left.characters.Alex);
  assert.equal(left.characters["Alex River-Forever"], undefined);
});

test("short bucket orphans reclaim by event identity (even after migrated flag)", () => {
  const accountDb = {
    pending: [],
    characters: {
      "Alex-ClassicBetaPvP": {
        pending: [
          {
            id: "orphan-bigg",
            character: "Alex River",
            realm: "Forever",
            guid: "Player-1-BIGG",
            type: "LOGIN",
          },
          { id: "orphan-ambig", character: "Alex", type: "DING" },
          {
            id: "orphan-dost",
            character: "Alex Brook",
            realm: "Forever",
            type: "LOGIN",
          },
        ],
      },
    },
  };
  const charDb = { pending: [], migrated_from_account: true };
  const { charDb: out, accountDb: left, skipped } = migrateAccountQueue(
    accountDb,
    charDb,
    river
  );
  assert.equal(skipped, true);
  assert.deepEqual(
    out.pending.map((e) => e.id),
    ["orphan-bigg"]
  );
  assert.ok(left.characters["Alex-ClassicBetaPvP"]);
  const remain = left.characters["Alex-ClassicBetaPvP"].pending.map((e) => e.id).sort();
  assert.deepEqual(remain, ["orphan-ambig", "orphan-dost"]);
});

test("Brook login takes only Brook; still leaves ambiguous", () => {
  const accountDb = {
    pending: legacyFlat.map((e) => ({ ...e })),
    characters: {},
  };
  const { charDb, accountDb: left } = migrateAccountQueue(accountDb, { pending: [] }, brook);
  assert.deepEqual(
    charDb.pending.map((e) => e.id),
    ["dost-1"]
  );
  assert.ok(left.pending.some((e) => e.id === "ambig-1"));
  assert.ok(left.pending.some((e) => e.id === "bigg-1"));
});

test("migration is idempotent — second pass skips and does not duplicate", () => {
  const accountDb = {
    pending: legacyFlat.map((e) => ({ ...e })),
  };
  const first = migrateAccountQueue(accountDb, { pending: [] }, river);
  assert.equal(first.charDb.migrated_from_account, true);
  const n = first.charDb.pending.length;
  const second = migrateAccountQueue(accountDb, first.charDb, river);
  assert.equal(second.skipped, true);
  assert.equal(second.charDb.pending.length, n);
});

test("collector still reads retained ambiguous legacy on account SV", () => {
  const ambig = { v: 1, id: "ambig-keep", ts: 1, type: "DING", character: "Alex", source: "addon" };
  writeSv(
    path.join(tmp, "account-legacy.lua"),
    `ForeverLANDB = {\n  ["pending"] = {\n    ${eventLua(ambig)},\n  },\n}\n`
  );
  const snap = readSavedVariablesSnapshot(path.join(tmp, "account-legacy.lua"));
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.events[0].id, "ambig-keep");
});

test("same full name but a different GUID (recreated character) does NOT migrate", () => {
  const oldChar = {
    id: "old-bigg-1",
    type: "PLAYER_DIED",
    character: "Alex River",
    realm: "Forever",
    guid: "Player-1-OLDBIGG",
  };
  assert.equal(eventSafelyBelongsToPlayer(oldChar, river), false);
  const accountDb = { pending: [{ ...oldChar }] };
  const { charDb } = migrateAccountQueue(accountDb, { pending: [] }, river);
  assert.equal(charDb.pending.length, 0);
  assert.equal(accountDb.pending.length, 1, "stays on the account store for the collector");
});

test("Lua source still implements the rules this mirror tests (drift tripwire)", () => {
  const lua = fs
    .readFileSync(path.join(phase1, "addon", "ForeverLAN", "ForeverLAN.lua"), "utf8")
    .replace(/\r\n/g, "\n");
  const start = lua.indexOf("local function eventSafelyBelongsToPlayer");
  assert(start >= 0, "eventSafelyBelongsToPlayer missing from ForeverLAN.lua");
  const end = lua.indexOf("\nend\n", start);
  assert(end > start, "could not find the end of eventSafelyBelongsToPlayer");
  const body = lua.slice(start, end);
  const flat = body.replace(/\s+/g, " ");
  assert(flat.includes("return ev.guid == player.guid"), "GUID decides whenever both sides have one");
  assert(flat.includes('not evChar:find("%s") and player.lastName ~= ""'), "a first name never matches a surnamed character");
  assert(flat.includes("evRealm ~= pRealm"), "realm mismatch blocks migration");
  assert(!/lanNameKey|nameKey\(/.test(body), "no first-token matching in event identity");
  assert(lua.includes("local function parseForeverName"), "Forever name parser present");
  assert(!/if foreverNames then/.test(lua), "surname is not gated on RegionalUniqueNamesEnabled");
});

console.log("\n[2] Schema 3 ForeverLANCharDB isolation");

test("Character A CharDB and Character B CharDB do not mix", () => {
  const aEv = {
    v: 1,
    id: "guidA-1-1",
    ts: 100,
    type: "LOGIN",
    character: "Alex",
    source: "addon",
  };
  const bEv = {
    v: 1,
    id: "guidB-1-1",
    ts: 200,
    type: "LOGIN",
    character: "Sam",
    source: "addon",
  };

  const aFile = path.join(tmp, "Account", "acct", "Realm", "Alex", "SavedVariables", "ForeverLAN.lua");
  const bFile = path.join(tmp, "Account", "acct", "Realm", "Sam", "SavedVariables", "ForeverLAN.lua");
  writeSv(
    aFile,
    `ForeverLANCharDB = {\n  ["schema"] = 3,\n  ["pending"] = {\n    ${eventLua(aEv)},\n  },\n}\n`
  );
  writeSv(
    bFile,
    `ForeverLANCharDB = {\n  ["schema"] = 3,\n  ["pending"] = {\n    ${eventLua(bEv)},\n  },\n}\n`
  );

  const aSnap = readSavedVariablesSnapshot(aFile);
  const bSnap = readSavedVariablesSnapshot(bFile);
  assert.equal(aSnap.ok, true);
  assert.equal(bSnap.ok, true);
  assert.deepEqual(
    aSnap.events.map((e) => e.id),
    ["guidA-1-1"]
  );
  assert.deepEqual(
    bSnap.events.map((e) => e.id),
    ["guidB-1-1"]
  );
  assert.ok(!aSnap.events.some((e) => e.character === "Sam"));
  assert.ok(!bSnap.events.some((e) => e.character === "Alex"));
});

test("findSavedVariableFiles discovers per-character paths", () => {
  const client = path.join(tmp, "client");
  const acct = path.join(client, "WTF", "Account", "acct1");
  fs.mkdirSync(path.join(acct, "SavedVariables"), { recursive: true });
  writeSv(path.join(acct, "SavedVariables", "ForeverLAN.lua"), `ForeverLANDB = {\n  ["settings"] = {\n  },\n}\n`);
  const charSv = path.join(acct, "SomeRealm", "Alex", "SavedVariables", "ForeverLAN.lua");
  writeSv(
    charSv,
    `ForeverLANCharDB = {\n  ["pending"] = {\n    ${eventLua({
      v: 1,
      id: "char-only",
      ts: 1,
      type: "DING",
      character: "Alex",
      source: "addon",
    })},\n  },\n}\n`
  );
  const found = findSavedVariableFiles(client).map((p) => path.normalize(p));
  assert.ok(found.some((p) => p.endsWith(path.normalize(path.join("SavedVariables", "ForeverLAN.lua")))));
  assert.ok(found.some((p) => p.includes(path.normalize(path.join("SomeRealm", "Alex")))));
  assert.equal(found.length, 2);
});

test("legacy account ForeverLANDB still parses", () => {
  const ev = {
    v: 1,
    id: "legacy-1",
    ts: 10,
    type: "DING",
    character: "Casey",
    source: "addon",
  };
  writeSv(
    path.join(tmp, "legacy.lua"),
    `ForeverLANDB = {\n  ["pending"] = {\n    ${eventLua(ev)},\n  },\n}\n`
  );
  const snap = readSavedVariablesSnapshot(path.join(tmp, "legacy.lua"));
  assert.equal(snap.ok, true);
  assert.equal(snap.events[0].id, "legacy-1");
});

test("file with both CharDB + leftover account pending merges/dedupes", () => {
  const ev = {
    v: 1,
    id: "same-id",
    ts: 1,
    type: "LOGIN",
    character: "Jordan",
    source: "addon",
  };
  const text = `ForeverLANCharDB = {
  ["pending"] = { ${eventLua(ev)}, },
}
ForeverLANDB = {
  ["pending"] = { ${eventLua(ev)}, },
}
`;
  const { events } = collectEventsFromSavedVariablesText(text);
  assert.equal(events.length, 1);
});

console.log("\n[3] Push export in CharDB");

test("CharDB export + pending same ids → one event", () => {
  const ev = {
    v: 1,
    id: "push-1",
    ts: 99,
    type: "LOGIN",
    character: "Alex",
    source: "addon",
  };
  const exportStr = `FOREVERLAN_CLIP|{"events":[${JSON.stringify(ev)}]}`;
  writeSv(
    path.join(tmp, "push.lua"),
    `ForeverLANCharDB = {
  ["schema"] = 3,
  ["export"] = "${luaEscape(exportStr)}",
  ["pending"] = { ${eventLua(ev)}, },
}
`
  );
  const snap = readSavedVariablesSnapshot(path.join(tmp, "push.lua"));
  assert.equal(snap.ok, true);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.events[0].id, "push-1");
});

test("schema-2 characters{} buckets still readable", () => {
  const aEv = {
    v: 1,
    id: "bucket-a",
    ts: 1,
    type: "LOGIN",
    character: "Alex",
    source: "addon",
  };
  const { events } = collectEventsFromForeverLANDB({
    schema: 2,
    characters: {
      "Alex-Realm": { pending: { 1: aEv } },
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "bucket-a");
});

console.log("\n[3b] character_key + account export hygiene");

test("char keys distinguish Forever surnamed alts", () => {
  const a = charKeyFromParts("Alex River", "ClassicBetaPvP");
  const b = charKeyFromParts("Alex Brook", "ClassicBetaPvP");
  const c = charKeyFromParts("Alex Ford", "ClassicBetaPvP");
  assert.equal(a, "Alex River-ClassicBetaPvP");
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, "Alex-ClassicBetaPvP");
});

test("account export skipped when per-character CharDB siblings exist", () => {
  const accountRoot = path.join(tmp, "hygiene-wow", "WTF", "Account", "H");
  const accountSv = path.join(accountRoot, "SavedVariables", "ForeverLAN.lua");
  const charSv = path.join(accountRoot, "Forever", "Alex-Ford", "SavedVariables", "ForeverLAN.lua");
  const soup = [
    { id: "soup-1", type: "LOGIN", ts: 1, character: "Alex River" },
    { id: "soup-2", type: "LOGIN", ts: 2, character: "Alex Brook" },
  ];
  const exportStr = `FOREVERLAN_CLIP|${JSON.stringify({ events: soup })}`;
  writeSv(
    accountSv,
    `ForeverLANDB = {
  ["schema"] = 3,
  ["version"] = "0.1.31",
  ["export"] = "${luaEscape(exportStr)}",
  ["pending"] = {
    ${eventLua({ id: "ambig-keep", type: "DING", ts: 3, character: "Alex" })},
  },
}
`
  );
  writeSv(
    charSv,
    `ForeverLANCharDB = {
  ["schema"] = 3,
  ["pending"] = { ${eventLua({ id: "char-only", type: "LOGIN", ts: 4, character: "Alex Ford" })}, },
}
`
  );
  const snap = readSavedVariablesSnapshot(accountSv);
  assert.equal(snap.ok, true);
  assert.equal(snap.skipAccountExport, true);
  const ids = snap.events.map((e) => e.id).sort();
  assert.deepEqual(ids, ["ambig-keep"], "account export soup must be ignored; ambiguous pending kept");
  assert.ok(!ids.includes("soup-1"));
  assert.ok(!ids.includes("soup-2"));
});

test("account characters{} ignored when CharDB siblings exist (pending + export)", () => {
  const accountRoot = path.join(tmp, "hygiene-buckets", "WTF", "Account", "H2");
  const accountSv = path.join(accountRoot, "SavedVariables", "ForeverLAN.lua");
  const charSv = path.join(accountRoot, "Forever", "Alt", "SavedVariables", "ForeverLAN.lua");
  const soup = [{ id: "bucket-export-1", type: "LOGIN", ts: 1, character: "Alex River" }];
  const exportStr = `FOREVERLAN_CLIP|${JSON.stringify({ events: soup })}`;
  writeSv(
    accountSv,
    `ForeverLANDB = {
  ["schema"] = 2,
  ["pending"] = {
    ${eventLua({ id: "ambig-root", type: "DING", ts: 3, character: "Alex" })},
    ${eventLua({ id: "full-root", type: "LOGIN", ts: 4, character: "Alex Ford" })},
  },
  ["characters"] = {
    ["Alex River-Forever"] = {
      ["export"] = "${luaEscape(exportStr)}",
      ["pending"] = { ${eventLua({ id: "bucket-pending-1", type: "DING", ts: 2, character: "Alex River" })}, },
    },
  },
}
`
  );
  writeSv(charSv, `ForeverLANCharDB = { ["schema"] = 3, ["pending"] = { }, }\n`);
  const snap = readSavedVariablesSnapshot(accountSv);
  assert.equal(snap.skipAccountExport, true);
  const ids = snap.events.map((e) => e.id).sort();
  // characters{} ignored; surnamed root pending ignored; bare Alex kept
  assert.deepEqual(ids, ["ambig-root"]);
});

console.log("\n[4] CurseForge addon-only package");

test("prepare-curseforge-addon builds zip with only addon files", () => {
  execFileSync(process.execPath, [path.join(phase1, "scripts", "prepare-curseforge-addon.mjs")], {
    cwd: phase1,
    stdio: "inherit",
  });
  const toc = fs.readFileSync(path.join(phase1, "addon", "ForeverLAN", "ForeverLAN.toc"), "utf8");
  const ver = (toc.match(/^##\s*Version:\s*(.+)$/m) || [])[1].trim();
  const zipPath = path.join(phase1, "dist", "curseforge", `ForeverLAN-${ver}.zip`);
  assert.ok(fs.existsSync(zipPath), `missing ${zipPath}`);
  assert.ok(/SavedVariablesPerCharacter:\s*ForeverLANCharDB/.test(toc));
  assert.ok(/SavedVariables:\s*ForeverLANDB/.test(toc));

  const extract = path.join(tmp, "unzip");
  fs.rmSync(extract, { recursive: true, force: true });
  fs.mkdirSync(extract, { recursive: true });
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(extract)} -Force`,
    ],
    { stdio: "inherit" }
  );
  const lua = fs.readFileSync(path.join(extract, "ForeverLAN", "ForeverLAN.lua"), "utf8");
  assert.ok(/ForeverLANCharDB/.test(lua));
  assert.ok(/SV_SCHEMA\s*=\s*3/.test(lua));
  assert.ok(!/lanToken\s*=/.test(lua));
});

test("toc version matches changelog latest", () => {
  const toc = fs.readFileSync(path.join(phase1, "addon", "ForeverLAN", "ForeverLAN.toc"), "utf8");
  const ver = (toc.match(/^##\s*Version:\s*(.+)$/m) || [])[1].trim();
  const cl = fs.readFileSync(path.join(phase1, "addon", "ForeverLAN", "CHANGELOG.md"), "utf8");
  assert.ok(cl.includes(`## ${ver}`), `CHANGELOG missing ## ${ver}`);
  const latest = (cl.match(/^##\s+(\d+\.\d+\.\d+)/m) || [])[1];
  assert.equal(ver, latest, "TOC version must match first CHANGELOG heading");
});

test("toc Interface matches Forever exactly (16001 band, not 160001/16999 ceiling)", () => {
  const toc = fs.readFileSync(path.join(phase1, "addon", "ForeverLAN", "ForeverLAN.toc"), "utf8");
  const iface = (toc.match(/^##\s*Interface:\s*(.+)$/m) || [])[1] || "";
  const nums = iface.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  assert.ok(
    nums.some((n) => n >= 16000 && n < 17000 && String(n).length === 5),
    `Forever Interface missing in: ${iface}`
  );
  assert.ok(!nums.includes(160001), "160001 is the old mistyped Interface");
  assert.ok(!nums.includes(16999), "16999 ceiling is rejected by Forever — use exact client Interface");
  assert.ok(/AllowLoadGameType:\s*camelot/i.test(toc), "base toc should AllowLoadGameType camelot");
  const camelot = path.join(phase1, "addon", "ForeverLAN", "ForeverLAN_Camelot.toc");
  assert.ok(fs.existsSync(camelot), "ForeverLAN_Camelot.toc required for Forever client");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
console.log("smoke-addon-multichar: PASS");
