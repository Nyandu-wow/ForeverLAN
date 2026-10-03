/** Stamp wowRoot into party.json after INSTALL finds the client. */
import fs from "node:fs";
import path from "node:path";

const partyPath = process.argv[2];
const wowClient = process.argv[3];
if (!partyPath || !wowClient) process.exit(1);

const party = JSON.parse(fs.readFileSync(partyPath, "utf8"));
const clientFolder = path.basename(wowClient);
const wowRoot = path.dirname(wowClient);
party.wowRoot = wowRoot;
party.clientFolder = clientFolder;
fs.writeFileSync(partyPath, JSON.stringify(party, null, 2), "utf8");
