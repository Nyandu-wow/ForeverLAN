/**
 * Legacy milestone layer smoke.
 * Run: node scripts/smoke-legacy.mjs
 */
import assert from "node:assert/strict";
import {
  buildLegacyMilestones,
  buildPlayerLegacy,
  detectLevelLegacyCrossings,
  detectProfessionLegacyCrossings,
  isLegacyProfessionName,
  levelJourney,
  professionJourney,
} from "../host/legacy-milestones.js";
import { announceFromActivity } from "../host/announcer.js";

assert.equal(isLegacyProfessionName("Tailoring"), true);
assert.equal(isLegacyProfessionName("Herbalism"), false);
assert.equal(isLegacyProfessionName("Mining"), false);

{
  const j = levelJourney(44);
  assert.equal(j[0].status, "verified"); // 25
  assert.equal(j[1].status, "in_progress"); // 45
  assert.equal(j[1].remaining, 1);
  assert.equal(j[2].status, "in_progress");
  console.log("ok  level journey");
}

{
  const crosses = detectLevelLegacyCrossings(44, 45, "Alex", "Priest");
  assert.equal(crosses.length, 1);
  assert.equal(crosses[0].threshold, 45);
  assert.deepEqual(detectLevelLegacyCrossings(null, 45, "Alex"), []);
  console.log("ok  level crossings");
}

{
  const pj = professionJourney({ name: "Tailoring", rank: 200, max_rank: 300 });
  assert.ok(pj);
  assert.equal(pj.milestones[0].status, "verified"); // 150
  assert.equal(pj.milestones[1].status, "in_progress"); // 225
  assert.equal(pj.milestones[1].remaining, 25);
  assert.equal(professionJourney({ name: "Herbalism", rank: 225 }), null);
  const pc = detectProfessionLegacyCrossings(220, 226, "Alchemy", "Sam");
  assert.equal(pc.length, 1);
  assert.equal(pc[0].threshold, 225);
  console.log("ok  profession journey / crossings");
}

{
  const board = buildLegacyMilestones([
    {
      character: "Casey",
      class: "Warrior",
      level: 19,
      professions: [{ name: "Blacksmithing", rank: 40, max_rank: 75, kind: "primary" }],
    },
    {
      character: "Alex Vale",
      class: "Mage",
      level: 4,
      professions: [],
    },
  ]);
  assert.ok(board.players.length >= 2);
  assert.ok(Array.isArray(board.unsupported));
  assert.equal(board.honesty.points, "untracked");
  const casey = board.players.find((p) => p.character === "Casey");
  assert.equal(casey.verified_levels, 0); // under 25
  assert.equal(casey.next.label, "Level 25");
  console.log("ok  board under-25");
}

{
  const board = buildLegacyMilestones([
    {
      character: "Jordan",
      class: "Rogue",
      level: 46,
      professions: [
        { name: "Engineering", rank: 226, max_rank: 300, kind: "primary" },
        { name: "Mining", rank: 300, max_rank: 300, kind: "primary" },
      ],
    },
  ]);
  const p = board.players[0];
  assert.equal(p.verified_levels, 2); // 25 + 45
  assert.equal(p.verified_professions, 2); // 150 + 225 Eng; Mining ignored
  assert.ok(board.awards.some((a) => a.title === "BUILDING A LEGACY"));
  assert.ok(board.awards.some((a) => a.title === "PROFESSIONAL LEGACY"));
  console.log("ok  verified awards", board.awards.map((a) => a.title).join(", "));
}

{
  const v = announceFromActivity({
    kind: "MOMENT",
    character: "Alex River",
    text: "LEGACY DING — Alex River reached Legacy Level 45.",
    ts: "2026-11-07T12:00:00Z",
  });
  assert.equal(v.category, "LEGACY_DING");
  assert.match(v.headline + v.subline, /45/);
  assert.match(v.headline + v.subline, /RIVER|LEGACY/i);
  const v2 = announceFromActivity({
    kind: "MOMENT",
    text: "LEGACY MILESTONE — Sam reached Tailoring 225.",
    ts: "2026-11-07T12:01:00Z",
  });
  assert.equal(v2.category, "LEGACY_PROF");
  assert.match(v2.headline + v2.subline, /225/);
  assert.match(v2.headline + v2.subline, /Tailoring|LONG GAME|LEGACY/i);
  console.log("ok  announcer legacy");
}

{
  const solo = buildPlayerLegacy({ character: "X", level: null });
  assert.ok(solo.levels.every((m) => m.status === "locked"));
  console.log("ok  missing level → locked/untracked");
}

console.log("\nlegacy smoke OK");
