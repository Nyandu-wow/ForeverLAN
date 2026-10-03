/**
 * One-shot: push current ForeverLANDB.positionProbe into the host event stream.
 */
import { readPositionProbeEvents } from "../collector/savedvars.js";

const sv =
  "C:/Games/FOREVER/World of Warcraft/_classic_beta_/WTF/Account/2044385#1/SavedVariables/ForeverLAN.lua";
const host = process.env.FOREVERLAN_HOST_URL || "http://127.0.0.1:8765";

const events = readPositionProbeEvents(sv);
console.log("probe events", events.length);
for (const ev of events) {
  // Attach guid from known cast if possible — host will key by character name
  const res = await fetch(`${host}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ev),
  });
  console.log(ev.character, ev.position?.accuracy, res.status);
}
