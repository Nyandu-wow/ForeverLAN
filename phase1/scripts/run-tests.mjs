/**
 * Offline regression suite — no WoW, no LAN, never touches the weekend log.
 * (smoke-host-e2e boots its own loopback host on a temp data dir, beacon off.)
 *   node scripts/run-tests.mjs        (npm test)
 *
 * Checks against the real running host stay separate: smoke-host-compat.mjs,
 * smoke-friend-ingest.mjs, stress-host-pipeline.mjs --http-only.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "smoke-board-catalog.mjs",
  "smoke-board-reads.mjs",
  "test-persistence.mjs",
  "smoke-addon-multichar.mjs",
  "stress-reliability.mjs",
  "smoke-professions.mjs",
  "smoke-legacy.mjs",
  "smoke-award-flavour.mjs",
  "smoke-announcer.mjs",
  "smoke-control-room.mjs",
  "smoke-presence.mjs",
  "smoke-host-e2e.mjs",
  "test-remote-security.mjs",
];

const results = [];
for (const file of SUITES) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(here, file)], {
    cwd: path.resolve(here, ".."),
    encoding: "utf8",
    // smoke-professions probes a live host when one is up; keep it offline here.
    env: { ...process.env, FOREVERLAN_HOST: "http://127.0.0.1:9" },
  });
  const ok = run.status === 0;
  results.push({ file, ok, ms: Date.now() - started });
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}  (${Date.now() - started} ms)`);
  if (!ok) {
    process.stdout.write(run.stdout.split("\n").slice(-25).join("\n"));
    process.stderr.write(run.stderr.split("\n").slice(-25).join("\n"));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);
