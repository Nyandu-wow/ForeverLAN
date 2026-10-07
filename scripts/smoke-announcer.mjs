/**
 * Announcer voice smoke tests.
 * Run: node scripts/smoke-announcer.mjs
 */
import assert from "node:assert/strict";
import {
  announceFromActivity,
  announceRacePulse,
  announceHeadline,
  parseActivityFacts,
  announcerHash,
  decorateActivityAnnouncements,
} from "../host/announcer.js";
import { buildRacePulse } from "../host/control-room.js";

function assertNoFabrication(voiced, sourceText) {
  const nums = String(sourceText).match(/\d+/g) || [];
  const out = `${voiced.headline || ""} ${voiced.subline || ""} ${voiced.compact || ""}`;
  for (const n of out.match(/\d+/g) || []) {
    assert.ok(nums.includes(n), `fabricated number ${n} not in source: ${sourceText} → ${out}`);
  }
}

// deterministic hash
{
  assert.equal(announcerHash("abc"), announcerHash("abc"));
  assert.notEqual(announcerHash("abc"), announcerHash("abd"));
  console.log("ok  hash stable");
}

// level-up
{
  const a = {
    kind: "DING",
    character: "Sam",
    text: "Sam reached level 14",
    ts: "2026-11-07T12:00:00Z",
  };
  const v = announceFromActivity(a);
  assert.match(v.headline, /DING|LEVEL|SAM|ANOTHER/i);
  assert.ok(v.subline);
  assert.match(`${v.headline} ${v.subline}`, /14/);
  assertNoFabrication(v, a.text);
  console.log("ok  ding", v.headline, "/", v.subline);
}

// lead change moment
{
  const a = {
    kind: "MOMENT",
    character: "Casey",
    text: "Casey takes the lead in the race to 60.",
    ts: "2026-11-07T12:01:00Z",
  };
  const v = announceFromActivity(a);
  assert.equal(v.category, "LEAD_CHANGE");
  assert.match(v.headline, /LEAD|ESCAPED|CASEY|NEW LEADER/i);
  console.log("ok  lead change", v.headline);
}

// death
{
  const a = {
    kind: "DEATH",
    character: "Alex Brook",
    text: "Alex Brook died",
    ts: "2026-11-07T12:02:00Z",
  };
  const v = announceFromActivity(a);
  assert.equal(v.category, "DEATH");
  assert.match(v.headline, /DEATH|FALLEN|SPIRITS|ALEX/i);
  console.log("ok  death", v.headline);
}

// corpse run
{
  const a = {
    kind: "MOMENT",
    character: "Alex Brook",
    text: "Alex Brook finished a 14m 32s corpse run.",
    ts: "2026-11-07T12:03:00Z",
  };
  const v = announceFromActivity(a);
  assert.equal(v.category, "CORPSE_RUN");
  assert.match(`${v.headline} ${v.subline}`, /14m 32s/);
  assertNoFabrication(v, a.text);
  console.log("ok  corpse", v.headline, "/", v.subline);
}

// long stall
{
  const a = {
    kind: "MOMENT",
    character: "Alex Vale",
    text: "Alex Vale hasn't dinged in 44 hours — still 4.",
    ts: "2026-11-07T12:04:00Z",
  };
  const facts = parseActivityFacts(a);
  assert.equal(facts.hours, 44);
  assert.equal(facts.level, 4);
  const v = announceFromActivity(a);
  assert.equal(v.category, "LEVEL_STALL");
  assert.match(`${v.headline} ${v.subline}`, /44/);
  assert.match(`${v.headline} ${v.subline}`, /4/);
  assert.match(`${v.headline} ${v.subline}`, /VALE/i);
  assertNoFabrication(v, a.text);
  // deterministic across calls
  const v2 = announceFromActivity(a);
  assert.equal(v.headline, v2.headline);
  assert.equal(v.subline, v2.subline);
  console.log("ok  stall", v.headline, "/", v.subline);
}

// missing data → neutral factual
{
  const a = { kind: "MOMENT", text: "Something mysterious happened.", ts: "2026-11-07T12:05:00Z" };
  const v = announceFromActivity(a);
  assert.ok(v.headline);
  assert.match(v.headline, /SOMETHING MYSTERIOUS|MOMENT|NOTED/i);
  console.log("ok  fallback", v.headline);
}

// race pulse swing voiced
{
  const pulse = buildRacePulse([
    { character: "Casey", level: 19 },
    { character: "Jordan", level: 14 },
  ]);
  assert.equal(pulse.kind, "BIG_SWING");
  const voiced = announceRacePulse(pulse);
  assert.match(voiced.headline, /CASEY|\+5/i);
  assert.match(voiced.detail || "", /14|19|Jordan|rude|comeback|gap/i);
  console.log("ok  race pulse", voiced.headline, "/", voiced.detail);
}

// race pulse tie
{
  const voiced = announceRacePulse(
    buildRacePulse([
      { character: "Alex", level: 12 },
      { character: "Sam", level: 12 },
    ])
  );
  assert.match(voiced.headline, /TIED|EVEN/i);
  console.log("ok  tie", voiced.headline);
}

// shared-zone gathering is not voiced as a plain zone change
{
  const a = {
    kind: "MOMENT",
    text: "2 levelers in Dun Morogh — Alex River, Sam Hill.",
    ts: "2026-11-07T12:06:00Z",
  };
  const v = announceFromActivity(a);
  assert.equal(v.category, "GATHERING");
  assert.doesNotMatch(v.headline, /ZONE CHANGE/i);
  assert.match(v.headline, /SAME ZONE|PILES IN|TOGETHER/i);
  assert.match(v.subline, /Alex River/);
  assert.match(v.subline, /Sam Hill/);
  console.log("ok  gathering", v.headline);
}

// headline helper
{
  const h = announceHeadline({
    kind: "DING",
    text: "Sam reached level 10",
    sourceText: "Sam reached level 10",
    character: "Sam",
    score: 45,
    ts: "2026-11-07T12:00:00Z",
  });
  assert.ok(h.text);
  assert.ok(h.subline);
  console.log("ok  headline helper", h.text);
}

// decorate activity
{
  const rows = decorateActivityAnnouncements([
    {
      kind: "DING",
      character: "Jordan",
      text: "Jordan reached level 15",
      ts: "2026-11-07T13:00:00Z",
    },
  ]);
  assert.ok(rows[0].announce?.headline);
  assert.ok(rows[0].announce?.compact);
  console.log("ok  decorate", rows[0].announce.compact);
}

console.log("\nannouncer smoke OK");
