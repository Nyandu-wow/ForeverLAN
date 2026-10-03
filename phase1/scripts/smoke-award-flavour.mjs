/**
 * Quick regression: map addict title + Tier B flavour coverage.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { flavourLine, TIER_A, TIER_B } from "../host/prize-pool.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sess = readFileSync(join(root, "host/lan-session.js"), "utf8");

assert(
  /key:\s*"map_addict"[\s\S]{0,120}title:\s*"WHO NEEDS A MAP\?"/.test(sess),
  "map_addict must use WHO NEEDS A MAP? (not LOST)"
);
assert(!/title:\s*"LOST"/.test(sess), "orphan LOST award title must be gone");

for (const title of [...TIER_A, ...TIER_B]) {
  const line = flavourLine(title, { character: "Alex" });
  assert(line && line.length > 3, `missing flavour for ${title}`);
}

console.log(`flavour OK · Tier A ${TIER_A.length} · Tier B ${TIER_B.length}`);
console.log("smoke-award-flavour: PASS");
