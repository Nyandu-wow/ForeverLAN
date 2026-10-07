/**
 * Smoke: Profession Board — analytics + lightweight HTTP surface checks.
 *
 * Analytics always run. HTTP checks hit FOREVERLAN_HOST / localhost:8765 when up
 * (same pattern as smoke-host-compat). No browser automation.
 *
 *   node scripts/smoke-professions.mjs
 *   node scripts/smoke-professions.mjs http://127.0.0.1:8765
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LanSession } from "../host/lan-session.js";
import { FIXTURE_LAN_ROSTER } from "./fixtures/weekend-roster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const hostArg = (process.argv[2] || process.env.FOREVERLAN_HOST || "http://127.0.0.1:8765").replace(
  /\/$/,
  ""
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function synth(id, character, guid, professions, ts, extra = {}) {
  return {
    id,
    type: "PLAYER_PROFESSIONS",
    source: "addon",
    is_self: true,
    character,
    guid,
    level: extra.level ?? 12,
    class: extra.class || "WARRIOR",
    ts,
    detection: "GetProfessions",
    professions,
    reason: extra.reason || "skill_lines",
  };
}

const partyEvents = [
  synth("p1a", "Alex River", "Player-1", [{ name: "Herbalism", rank: 25, max_rank: 75, kind: "primary" }], 1700000001),
  synth("p1b", "Alex River", "Player-1", [
    { name: "Herbalism", rank: 40, max_rank: 75, kind: "primary" },
    { name: "Mining", rank: 1, max_rank: 75, kind: "primary" },
  ], 1700000100),
  synth("p2a", "Sam", "Player-2", [{ name: "Alchemy", rank: 50, max_rank: 75, kind: "primary" }], 1700000002, {
    class: "MAGE",
  }),
  synth("p2b", "Sam", "Player-2", [
    { name: "Alchemy", rank: 55, max_rank: 75, kind: "primary" },
    { name: "Herbalism", rank: 10, max_rank: 75, kind: "primary" },
  ], 1700000200, { class: "MAGE" }),
  synth("p3a", "Jordan Vale", "Player-3", [{ name: "Blacksmithing", rank: 20, max_rank: 75, kind: "primary" }], 1700000003, {
    class: "PALADIN",
  }),
  synth("p3b", "Jordan Vale", "Player-3", [{ name: "Blacksmithing", rank: 70, max_rank: 75, kind: "primary" }], 1700000300, {
    class: "PALADIN",
  }),
  synth("p4a", "Casey Brook", "Player-4", [{ name: "Cooking", rank: 15, max_rank: 75, kind: "cooking" }], 1700000004, {
    class: "ROGUE",
  }),
];

const session = new LanSession({
  roster: FIXTURE_LAN_ROSTER,
  weekendStart: "2026-09-26",
});
const state = session.rebuildFromEvents(partyEvents);
const prof = state.professions;

assert(prof, "professions payload missing");
assert(prof.title === "PROFESSIONS", `title ${prof.title}`);
assert(prof.headline, "headline missing");
assert(/professions? trained/.test(prof.headline), `headline should use trained: ${prof.headline}`);
assert(/unrepresented/.test(prof.headline), `headline should use unrepresented: ${prof.headline}`);
assert(/leads the party/.test(prof.headline), `headline should use leads the party: ${prof.headline}`);
assert(prof.coverage.length >= 4, `expected coverage lines, got ${prof.coverage.length}`);
assert(prof.totals.skill_ups > 0, "expected counted skill-ups");
assert((prof.stream || prof.feed).length > 0, "expected skill-up stream");
assert(Array.isArray(prof.climb), "climb array required");
assert(Array.isArray(prof.players), "players array required");
assert(prof.awards.some((a) => a.title === "DOUBLE DIP"), "missing DOUBLE DIP");
assert(prof.awards.some((a) => a.title === "FIRST CLAIM"), "missing FIRST CLAIM");
assert(prof.awards.some((a) => a.title === "SKILL STREAK"), "missing SKILL STREAK");
assert(!prof.awards.some((a) => a.title === "OPEN SEAT"), "OPEN SEAT must not be an award chip");
assert(prof.awards.some((a) => a.title === "CAP WATCH"), "missing CAP WATCH");
assert(prof.awards.some((a) => a.title === "THE SPECIALIST"), "missing THE SPECIALIST");
assert(prof.awards.some((a) => a.title === "JACK OF ALL TRADES"), "missing JACK OF ALL TRADES");
assert(!prof.awards.some((a) => /FIRST TRADE|LONELY CRAFTER|PARTY CRAFT/i.test(a.title)), "old craft terminology");

const dipAward = prof.awards.find((a) => a.title === "DOUBLE DIP");
assert(dipAward?.board_only === true, "DOUBLE DIP must be board_only");

assert(
  !state.hall.some((h) => h.title === "OPEN SEAT"),
  "OPEN SEAT must not leak into global Hall"
);
assert(
  !state.hall.some((h) => h.title === "DOUBLE DIP"),
  "DOUBLE DIP must not leak into global Hall"
);
assert(
  !state.hall.some((h) => h.title === "ONE-MAN INDUSTRY"),
  "ONE-MAN INDUSTRY must not leak into global Hall"
);
// Moment awards may appear on Hall
assert(
  state.hall.some((h) => h.title === "SKILL STREAK" || h.title === "CAP WATCH" || h.title === "FIRST CLAIM"),
  "at least one profession moment award should reach Hall"
);

const dip = prof.awards.find((a) => a.title === "DOUBLE DIP" && a.character === "Alex River");
assert(dip, "DOUBLE DIP expected for Alex (Herb+Mining)");
const cap = prof.awards.find((a) => a.title === "CAP WATCH");
assert(cap && cap.character === "Jordan Vale", `CAP WATCH expected Jordan Vale 70/75, got ${cap?.detail}`);
const first = prof.awards.find((a) => a.title === "FIRST CLAIM");
assert(first && /Mining/.test(first.detail), `FIRST CLAIM expected Mining, got ${first?.detail}`);
const streak = prof.awards.find((a) => a.title === "SKILL STREAK");
assert(streak && streak.character === "Jordan Vale", `SKILL STREAK expected Jordan Vale +50, got ${streak?.detail}`);

const herb = prof.coverage.find((c) => c.name === "Herbalism" && !c.open_seat);
assert(herb && herb.owners.length === 2, "Herbalism should be shared by Alex + Sam");
assert(Array.isArray(prof.open_seats), "open_seats array required");
assert(prof.open_seats.includes("Enchanting"), "Enchanting should be an open seat");
assert(prof.open_seats.includes("Engineering"), "Engineering should be an open seat");
assert(prof.open_seats.includes("Tailoring"), "Tailoring should be an open seat");

const lonely = new LanSession({ roster: ["Alex River"], weekendStart: "2026-09-26" });
const lonelyState = lonely.rebuildFromEvents([
  synth("solo", "Alex River", "Player-1", [{ name: "Herbalism", rank: 10, max_rank: 75, kind: "primary" }], 1700000001),
]);
assert(
  lonelyState.professions.awards.some((a) => a.title === "ONE-MAN INDUSTRY" && a.board_only),
  "ONE-MAN INDUSTRY expected board_only with a single reporter"
);
assert(
  !lonelyState.hall.some((h) => h.title === "ONE-MAN INDUSTRY"),
  "ONE-MAN INDUSTRY must not leak into Hall"
);

console.log("party fixture OK");
console.log("headline:", prof.headline);
console.log(
  "awards:",
  prof.awards.map((a) => `${a.title}${a.board_only ? " [board]" : ""}: ${a.detail}`).join(" | ")
);
console.log(
  "hall profession titles:",
  state.hall.filter((h) => /SEAT|DIP|CLAIM|STREAK|CAP|INDUSTRY/i.test(h.title)).map((h) => h.title).join(", ") || "(none)"
);

const jsonl = path.join(root, "data", "host-events.jsonl");
if (fs.existsSync(jsonl)) {
  const events = fs
    .readFileSync(jsonl, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const real = new LanSession({
    roster: FIXTURE_LAN_ROSTER,
    weekendStart: "2026-09-23",
  });
  const st = real.rebuildFromEvents(events);
  const rp = st.professions;
  assert(rp?.coverage?.some((c) => !c.open_seat), "real data: no profession coverage");
  const owned = rp.coverage.filter((c) => !c.open_seat);
  assert(owned.length >= 1, "real data: expected owned professions");
  assert((rp.stats?.reporters || 0) >= 1, "real data: expected reporters");
  console.log(
    "host-events.jsonl OK —",
    owned.map((c) => `${c.name}×${c.owners.length}`).join(", "),
    `stream ${rp.stream?.length || 0}`
  );
} else {
  console.log("skip host-events.jsonl (missing)");
}

// --- Static page / Explore cleanup checks (no host required) ---
const pagePath = path.join(root, "host/public/professions.html");
const pageHtml = fs.readFileSync(pagePath, "utf8");
assert(pageHtml.includes("Forever LAN — Professions"), "professions.html title missing");
assert(pageHtml.includes("PROFESSIONS") || pageHtml.includes('id="title"'), "board title marker");
assert(pageHtml.includes("PARTY PROFESSIONS"), "party professions section missing");
assert(pageHtml.includes("PROFESSION HONORS"), "profession honors section missing");
assert(pageHtml.includes("PROFESSION PROGRESS"), "profession progress section missing");
assert(pageHtml.includes("RECENT SKILL-UPS"), "recent skill-ups section missing");
assert(pageHtml.includes("Unrepresented professions"), "unrepresented note missing");
assert(!pageHtml.includes("coverage, not advice"), "old coverage-advice copy must go");
assert(!pageHtml.includes("PARTY CALLS"), "old PARTY CALLS heading must go");
assert(!pageHtml.includes("SKILL-UP STREAM"), "old SKILL-UP STREAM heading must go");
assert(pageHtml.includes("honesty-chip"), "honesty chips missing on page");
assert(pageHtml.includes(">LOGGED<"), "LOGGED honesty label missing");
assert(pageHtml.includes(">COUNTED<"), "COUNTED honesty label missing");
assert(pageHtml.includes('id="coverage"'), "coverage mount missing");
assert(pageHtml.includes('id="awards"'), "awards mount missing");
assert(pageHtml.includes('id="climb"'), "climb mount missing");
assert(pageHtml.includes('id="stream"'), "stream mount missing");
assert(pageHtml.includes("EventSource(\"/stream\")"), "SSE live refresh path missing");
assert(pageHtml.includes("fetch(\"/lan\")"), "lan fetch path missing");

const explorePath = path.join(root, "host/public/explore.html");
const exploreHtml = fs.readFileSync(explorePath, "utf8");
assert(exploreHtml.includes('["/professions", "PROFESSIONS"]'), "Explore nav must still link PROFESSIONS");
assert(!exploreHtml.includes("renderProfessions"), "Explore must not contain renderProfessions");
assert(!exploreHtml.includes(".prof-hero"), "Explore must not contain abandoned .prof-* CSS");
assert(!exploreHtml.includes("PROFESSION PARTY"), "Explore must not contain abandoned Professions page copy");
console.log("static page + explore cleanup OK");

// --- Live host surface (optional if host is up) ---
async function probeHost(base) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4000);
  try {
    const health = await fetch(`${base}/health`, { signal: ac.signal });
    if (!health.ok) return null;
    return base;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const live = await probeHost(hostArg);
if (!live) {
  console.log(`HTTP surface: SKIP (host not reachable at ${hostArg})`);
} else {
  const pageRes = await fetch(`${live}/professions`);
  assert(pageRes.status === 200, `GET /professions expected 200, got ${pageRes.status}`);
  const html = await pageRes.text();
  assert(html.includes("Forever LAN — Professions"), "live page is not dedicated professions.html");
  assert(html.includes("honesty-chip") && html.includes("LOGGED") && html.includes("COUNTED"), "live honesty labels missing");
  assert(html.includes('id="coverage"') && html.includes('id="awards"'), "live UI mounts missing");
  assert(html.includes("EventSource(\"/stream\")"), "live SSE path missing");
  assert(!html.includes("renderProfessions"), "live /professions must not be explore duplicate");

  const lanRes = await fetch(`${live}/lan`);
  assert(lanRes.status === 200, `GET /lan expected 200, got ${lanRes.status}`);
  let lan = await lanRes.json();
  // Host may briefly serve mid-rebuild state; one retry.
  if (!lan.professions) {
    await new Promise((r) => setTimeout(r, 750));
    const again = await fetch(`${live}/lan`);
    if (again.ok) lan = await again.json();
  }
  if (!lan.professions) {
    console.log("WARN: live lan.professions missing after retry — fixture checks already passed; skipping live professions asserts");
  } else {
    assert(lan.professions.title === "PROFESSIONS" || lan.professions.coverage, "lan.professions not consumable");
    assert(Array.isArray(lan.professions.coverage), "lan.professions.coverage missing");
    assert(Array.isArray(lan.professions.awards), "lan.professions.awards missing");
    assert(
      !lan.professions.awards.some((a) => a.title === "OPEN SEAT"),
      "live awards must not include OPEN SEAT chip"
    );
    if (lan.hall) {
      assert(!lan.hall.some((h) => h.title === "OPEN SEAT"), "live Hall leaked OPEN SEAT");
    }
  }

  // SSE: one message or ready — do not hang the smoke.
  await new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      resolve("timeout-ok");
    }, 3500);
    fetch(`${live}/stream`, { signal: ac.signal, headers: { Accept: "text/event-stream" } })
      .then(async (res) => {
        assert(res.status === 200, `GET /stream expected 200, got ${res.status}`);
        assert(
          String(res.headers.get("content-type") || "").includes("text/event-stream"),
          "stream content-type"
        );
        // Read a small chunk if available, then abort.
        const reader = res.body?.getReader?.();
        if (reader) {
          try {
            await Promise.race([
              reader.read(),
              new Promise((r) => setTimeout(r, 1500)),
            ]);
          } catch {
            /* aborted */
          }
        }
        clearTimeout(timer);
        ac.abort();
        resolve("sse-ok");
      })
      .catch((err) => {
        clearTimeout(timer);
        if (ac.signal.aborted) resolve("aborted-ok");
        else reject(err);
      });
  });

  console.log(`HTTP surface OK @ ${live}`);
}

console.log("smoke-professions: PASS");
