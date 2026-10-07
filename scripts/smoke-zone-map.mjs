/**
 * Zone choropleth smoke tests: traced geometry, heat aggregation, SVG output, zone_visits fold.
 * Run: node scripts/smoke-zone-map.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LanSession } from "../host/lan-session.js";
import { FIXTURE_LAN_ROSTER } from "./fixtures/weekend-roster.mjs";
import { zonesFromBoard } from "../host/board-catalog.js";
import "../host/public/zone-map.js";

const ZM = globalThis.ForeverZoneMap;
const here = path.dirname(fileURLToPath(import.meta.url));
const geo = JSON.parse(fs.readFileSync(path.join(here, "../host/public/data/maps/world-zones.json"), "utf8"));
const idx = ZM.indexGeometry(geo);
const now = Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString();

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// --- geometry: real polygons, inside their verified zone rect, label inside own zone only ---
{
  assert.ok(geo.zones.length >= 40, "traced zones present");
  const names = new Set();
  const margin = 0.006;
  for (const z of geo.zones) {
    assert.ok(!names.has(z.zoneName), `duplicate ${z.zoneName}`);
    names.add(z.zoneName);
    assert.ok(geo.continents[z.continent], `${z.zoneName} continent`);
    for (const ring of [z.polygon, ...(z.extraPolygons || [])]) {
      assert.ok(ring.length >= 3, `${z.zoneName} ring has >= 3 points`);
      for (const [u, v] of ring) assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${z.zoneName} normalized`);
    }
    assert.ok(ringArea(z.polygon) > 0.0003, `${z.zoneName} has area`);
    // A traced outline, not a marker: many vertices.
    assert.ok(z.polygon.length >= 12, `${z.zoneName} outline has detail (${z.polygon.length} pts)`);
    if (z.mapRect) {
      const [l, t, r, b] = bbox(z.polygon);
      const [rl, rt, rr, rb] = z.mapRect;
      assert.ok(l >= rl - margin && t >= rt - margin && r <= rr + margin && b <= rb + margin, `${z.zoneName} within its zone rect`);
    }
    const [lu, lv] = z.labelAt;
    assert.equal(ZM.zoneAtPoint(idx, z.continent, lu, lv)?.zoneName, z.zoneName, `${z.zoneName} label inside own polygon only`);
  }
  console.log(`ok  geometry: ${geo.zones.length} traced zones valid`);
}

// --- real telemetry positions land in the right polygon ---
{
  const toMap = (continent, wx, wy) => {
    const t = geo.continents[continent].worldToMap;
    return [t.x0 + t.xk * wx, t.y0 + t.yk * wy];
  };
  // Fixtures are self-position samples whose zone label matched the polygon (party
  // roster can report a stale zone while standing elsewhere — those are not geometry bugs).
  const fixtures = [
    ["Eastern Kingdoms", 388.8, -6057.9, "Dun Morogh"],
    ["Eastern Kingdoms", -526.6, -5592.5, "Dun Morogh"],
    ["Eastern Kingdoms", -832.3, -5022.4, "Dun Morogh"], // Ironforge, folded into Dun Morogh
    ["Eastern Kingdoms", -2953.9, -5392.7, "Loch Modan"],
    ["Eastern Kingdoms", 29, -9459, "Elwynn Forest"],
    ["Eastern Kingdoms", 517, -10000, "Elwynn Forest"],
    ["Eastern Kingdoms", 746, -10268, "Duskwood", "edge"], // river channel on the Westfall border
    ["Eastern Kingdoms", -592.5, -732.8, "Hillsbrad Foothills"],
    ["Eastern Kingdoms", -375, -216.2, "Alterac Mountains"],
    ["Kalimdor", 963.5, 9803.7, "Teldrassil"],
    ["Kalimdor", 494, 6423, "Darkshore"],
  ];
  // Some painted borders are rivers up to ~8 px wide; a position mid-river may fall either side.
  const pxToRing = (ring, u, v) => {
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0] * 1002, ay = ring[j][1] * 668, bx = ring[i][0] * 1002, by = ring[i][1] * 668;
      const px = u * 1002, py = v * 668, dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return best;
  };
  for (const [cont, wx, wy, want, edge] of fixtures) {
    const [u, v] = toMap(cont, wx, wy);
    const got = ZM.zoneAtPoint(idx, cont, u, v)?.zoneName;
    if (edge && got !== want) {
      const d = pxToRing(idx.byName.get(want.toLowerCase()).polygon, u, v);
      assert.ok(d <= 5, `(${wx}, ${wy}) border case: ${d.toFixed(1)} px from ${want}`);
    } else {
      assert.equal(got, want, `(${wx}, ${wy}) → ${want}`);
    }
  }
  const cx = (n) => bbox(idx.byName.get(n.toLowerCase()).polygon);
  assert.ok(cx("Westfall")[2] <= cx("Duskwood")[0] + 0.01, "Westfall west of Duskwood");
  assert.ok(cx("Westfall")[1] >= cx("Elwynn Forest")[1], "Westfall south of Elwynn's top edge");
  assert.ok((cx("Westfall")[0] + cx("Westfall")[2]) / 2 < (cx("Elwynn Forest")[0] + cx("Elwynn Forest")[2]) / 2, "Westfall west of Elwynn");
  assert.ok(cx("Loch Modan")[0] > cx("Dun Morogh")[0], "Loch Modan east of Dun Morogh");
  console.log(`ok  ${fixtures.length} logged positions hit the right zone polygon`);
}

// --- deterministic fake activity: heat, fold, fail closed ---
const row = (zone, who, visits, extra = {}) => ({ zone, who, characters: who.length, visits, dings: 0, deaths: 0, ...extra });
const baseRows = [
  row("Dun Morogh", ["Alex River", "Sam Hill"], 6),
  row("Ironforge", ["Jordan Vale"], 2),
  row("Loch Modan", ["Alex River"], 2),
  row("Elwynn Forest", ["Casey Brook"], 3),
  row("Westfall", ["Casey Brook"], 1),
  row("Duskwood", ["Casey Brook"], 1),
  row("Zephras Isle", ["Sam Hill"], 2),
  row("Riverglades", ["Sam Hill"], 1),
  row("Gnomeregan Space Port", ["Sam Hill"], 1),
];
const fillOf = (svg, zone) => {
  const m = svg.match(new RegExp(`data-zone="${zone}" d="[^"]*" fill="([^"]+)"`));
  assert.ok(m, `${zone} drawn`);
  return m[1];
};
{
  const act = ZM.aggregateZoneActivity(baseRows, idx);
  const dm = act.mapped.get("Dun Morogh");
  assert.equal(dm.uniquePlayers, 3, "Ironforge players fold into Dun Morogh");
  assert.equal(dm.visits, 8);
  assert.equal(dm.heat, 11, "heat = unique players + entries");
  assert.deepEqual(dm.parts.map((p) => p.name), ["Ironforge"]);
  assert.equal(act.mapped.get("Westfall").heat, 2);
  assert.ok(!act.mapped.has("Ironforge"));
  assert.deepEqual(act.unmapped.map((u) => u.zone).sort(), ["Gnomeregan Space Port", "Riverglades", "Zephras Isle"]);
  assert.ok(act.unmapped.find((u) => u.zone === "Zephras Isle").reason.includes("starter island"));
  assert.ok(ZM.heatIntensity(0) === 0 && ZM.heatIntensity(ZM.HEAT_FULL * 10) === 1);

  for (const view of ["world", "Eastern Kingdoms", "Kalimdor"]) {
    const svg = ZM.renderSvg(idx, act, view, null);
    assert.ok(!/<circle|<ellipse|<rect/.test(svg), `${view}: no circle/ellipse/rect markers`);
    assert.ok(!/data-zone="(Zephras Isle|Riverglades|Gnomeregan Space Port)"/.test(svg), `${view}: unmapped zones not drawn`);
    assert.match(svg, /viewBox="0 0 1002 668"/);
    assert.ok(!/<svg[^>]*\swidth=/.test(svg) && !/<svg[^>]*\sheight=/.test(svg), "SVG scales with its container");
    assert.ok(svg.includes('class="zm-border"'), "borders drawn");
  }
  const ekSvg = ZM.renderSvg(idx, act, "Eastern Kingdoms", null);
  assert.equal(fillOf(ekSvg, "Wetlands"), ZM.FOG_FILL, "no activity → fog, still drawn");
  assert.notEqual(fillOf(ekSvg, "Dun Morogh"), ZM.FOG_FILL);
  console.log("ok  heat aggregation, fold, fail-closed, SVG markers");
}

// --- increasing Dun Morogh changes only Dun Morogh ---
{
  const before = ZM.renderSvg(idx, ZM.aggregateZoneActivity(baseRows, idx), "world", null);
  const busier = baseRows.map((r) => (r.zone === "Dun Morogh" ? { ...r, visits: r.visits + 9 } : r));
  const after = ZM.renderSvg(idx, ZM.aggregateZoneActivity(busier, idx), "world", null);
  const changed = geo.zones.map((z) => z.zoneName).filter((n) => fillOf(before, n) !== fillOf(after, n));
  assert.deepEqual(changed, ["Dun Morogh"]);
  assert.notEqual(ZM.activityKey(baseRows), ZM.activityKey(busier), "memo key changes with activity");
  console.log("ok  Dun Morogh +9 entries recolours only Dun Morogh");
}

// --- continents share one world frame ---
{
  const ek = geo.continents["Eastern Kingdoms"].worldView;
  const kal = geo.continents.Kalimdor.worldView;
  for (const wv of [ek, kal]) assert.ok(wv.scale > 0.7 && wv.scale < 1.0, "world scale sane");
  assert.ok(Math.abs(ek.scale - kal.scale) / ek.scale < 0.1, "continents drawn at similar scale");
  const worldBox = (cont, wv) => {
    const b = bbox(geo.zones.filter((z) => z.continent === cont).flatMap((z) => z.polygon));
    return [wv.scale * b[0] + wv.tx, wv.scale * b[1] + wv.ty, wv.scale * b[2] + wv.tx, wv.scale * b[3] + wv.ty];
  };
  const k = worldBox("Kalimdor", kal), e = worldBox("Eastern Kingdoms", ek);
  assert.ok(k[2] < e[0], "Kalimdor sits west of the Eastern Kingdoms without overlap");
  for (const b of [k, e]) assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1, "inside world art");
  console.log("ok  world view: both continents in one frame");
}

// --- LanSession zone_visits → catalog visits ---
{
  const session = new LanSession({ roster: FIXTURE_LAN_ROSTER });
  const zoneEv = (id, ts, zone) => ({
    id,
    ts,
    type: "PLAYER_ZONE_CHANGED",
    source: "addon",
    character: "Alex River",
    guid: "Player-1-N",
    level: 8,
    zone,
    is_self: true,
    online: true,
    host_received_at: iso(ts),
  });
  session.rebuildFromEvents([
    zoneEv("v1", now - 400, "Dun Morogh"),
    zoneEv("v2", now - 300, "Dun Morogh"),
    zoneEv("v3", now - 200, "Loch Modan"),
    zoneEv("v4", now - 100, "Dun Morogh"),
  ]);
  const board = session.getPublicState();
  const ny = board.players.find((p) => p.character === "Alex River");
  assert.deepEqual(ny.zone_visits, { "Dun Morogh": 2, "Loch Modan": 1 }, "repeat of same zone not counted");
  const zones = zonesFromBoard(board);
  const dm = zones.find((z) => z.zone === "Dun Morogh");
  assert.equal(dm.visits, 2);
  assert.equal(dm.visits_by["Alex River"], 2);
  assert.equal(zones.find((z) => z.zone === "Loch Modan").visits, 1);
  console.log("ok  LanSession zone_visits → catalog visits");
}

console.log("smoke-zone-map: all passed");
