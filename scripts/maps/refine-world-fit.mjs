/**
 * World-art collage fit: Kalimdor mainland + Teldrassil pin; EK south + EK north pin.
 * The painted Azeroth map is NOT a scaled continent map (Teldrassil floats; EK is split).
 *
 * node scripts/maps/refine-world-fit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const geoPath = path.join(root, "host/public/data/maps/world-zones.json");
const seedsPath = path.join(here, "zone-seeds.json");
const artDir = path.join(root, "host/public/assets/maps");
const outDir = path.join(root, ".cache/maps");
fs.mkdirSync(outDir, { recursive: true });

const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
const seeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
const ART_W = 1002, ART_H = 668;

function zonePt(name) {
  const z = geo.zones.find((z) => z.zoneName === name);
  if (!z?.labelAt) throw new Error(name);
  return [z.labelAt[0] * ART_W, z.labelAt[1] * ART_H];
}

function fitPairs(pairs) {
  const pts = pairs.map((p) => {
    const [cx, cy] = zonePt(p.zone);
    return { zone: p.zone, cx, cy, wx: p.world[0], wy: p.world[1] };
  });
  const n = pts.length;
  const mean = (k) => pts.reduce((a, p) => a + p[k], 0) / n;
  const mcx = mean("cx"), mcy = mean("cy"), mwx = mean("wx"), mwy = mean("wy");
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.cx - mcx) * (p.wx - mwx) + (p.cy - mcy) * (p.wy - mwy);
    den += (p.cx - mcx) ** 2 + (p.cy - mcy) ** 2;
  }
  const s = num / den;
  const tx = mwx - s * mcx, ty = mwy - s * mcy;
  let err = 0;
  for (const p of pts) err += Math.hypot(s * p.cx + tx - p.wx, s * p.cy + ty - p.wy);
  return { scale: s, tx, ty, err: err / n };
}

function pack(wv) {
  return {
    scale: Math.round(wv.scale * 1e4) / 1e4,
    tx: Math.round((wv.tx / ART_W) * 1e4) / 1e4,
    ty: Math.round((wv.ty / ART_H) * 1e4) / 1e4,
    landOverlap: Math.round(Math.max(0, 1 - (wv.err || 0) / 40) * 1e4) / 1e4,
  };
}

function pinZones(scale, zoneNames, worldTargets) {
  // Average translation that maps each zone labelAt → its world target at fixed scale.
  let tx = 0, ty = 0;
  for (let i = 0; i < zoneNames.length; i++) {
    const [cx, cy] = zonePt(zoneNames[i]);
    tx += worldTargets[i][0] - scale * cx;
    ty += worldTargets[i][1] - scale * cy;
  }
  tx /= zoneNames.length;
  ty /= zoneNames.length;
  return { scale, tx, ty, err: 0 };
}

const kal = fitPairs([
  { zone: "Darkshore", world: [170, 210] },
  { zone: "Ashenvale", world: [215, 270] },
  { zone: "The Barrens", world: [255, 370] },
  { zone: "Durotar", world: [300, 340] },
  { zone: "Mulgore", world: [215, 410] },
  { zone: "Tanaris", world: [270, 520] },
  { zone: "Winterspring", world: [280, 195] },
  { zone: "Un'Goro Crater", world: [235, 485] },
  { zone: "Silithus", world: [180, 515] },
  { zone: "Feralas", world: [185, 445] },
  { zone: "Desolace", world: [175, 370] },
  { zone: "Stonetalon Mountains", world: [195, 320] },
]);
console.log("Kal mainland err", kal.err.toFixed(1));

const [tcx, tcy] = zonePt("Teldrassil");
const tel = { scale: kal.scale, tx: 164 - kal.scale * tcx, ty: 103 - kal.scale * tcy, err: 0 };

const ekSouth = fitPairs([
  { zone: "Wetlands", world: [800, 300] },
  { zone: "Dun Morogh", world: [760, 350] },
  { zone: "Loch Modan", world: [815, 355] },
  { zone: "Elwynn Forest", world: [755, 440] },
  { zone: "Westfall", world: [715, 460] },
  { zone: "Duskwood", world: [760, 480] },
  { zone: "Redridge Mountains", world: [800, 445] },
  { zone: "Stranglethorn Vale", world: [745, 540] },
  { zone: "Burning Steppes", world: [790, 400] },
  { zone: "Searing Gorge", world: [765, 385] },
  { zone: "Badlands", world: [830, 400] },
  { zone: "Swamp of Sorrows", world: [820, 490] },
  { zone: "Blasted Lands", world: [820, 530] },
]);
console.log("EK south err", ekSouth.err.toFixed(1));

const ekNorthZones = [
  "Tirisfal Glades",
  "Silverpine Forest",
  "Hillsbrad Foothills",
  "Alterac Mountains",
  "Arathi Highlands",
  "The Hinterlands",
  "Western Plaguelands",
  "Eastern Plaguelands",
];
const ekNorthWorld = [
  [730, 160],
  [710, 225],
  [770, 245],
  [785, 215],
  [820, 270],
  [845, 230],
  [800, 175],
  [850, 170],
];
const ekNorth = pinZones(ekSouth.scale, ekNorthZones, ekNorthWorld);
// refine north with its own scale too
const ekNorthFit = fitPairs(ekNorthZones.map((z, i) => ({ zone: z, world: ekNorthWorld[i] })));
console.log("EK north err", ekNorthFit.err.toFixed(1));

geo.continents.Kalimdor.worldView = pack(kal);
geo.continents.Kalimdor.worldViewPins = { Teldrassil: pack(tel) };

geo.continents["Eastern Kingdoms"].worldView = pack(ekSouth);
geo.continents["Eastern Kingdoms"].worldViewPins = Object.fromEntries(
  ekNorthZones.map((z) => [z, pack(ekNorthFit)])
);

seeds.continents.Kalimdor.worldView = geo.continents.Kalimdor.worldView;
seeds.continents.Kalimdor.worldViewPins = geo.continents.Kalimdor.worldViewPins;
seeds.continents["Eastern Kingdoms"].worldView = geo.continents["Eastern Kingdoms"].worldView;
seeds.continents["Eastern Kingdoms"].worldViewPins = geo.continents["Eastern Kingdoms"].worldViewPins;

const { data, info } = await sharp(path.join(artDir, "azeroth-world.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const img = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  img[i * 4] = (data[i * 4] * 0.55) | 0;
  img[i * 4 + 1] = (data[i * 4 + 1] * 0.55) | 0;
  img[i * 4 + 2] = (data[i * 4 + 2] * 0.55) | 0;
  img[i * 4 + 3] = 255;
}
const put = (x, y, rgb) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
};
function drawZone(z, wv, rgb) {
  const s = wv.scale, tx = wv.tx * ART_W, ty = wv.ty * ART_H;
  for (const ring of [z.polygon, ...(z.extraPolygons || [])]) {
    for (let i = 0; i < ring.length; i++) {
      const [u0, v0] = ring[i], [u1, v1] = ring[(i + 1) % ring.length];
      const x0 = s * u0 * ART_W + tx, y0 = s * v0 * ART_H + ty;
      const x1 = s * u1 * ART_W + tx, y1 = s * v1 * ART_H + ty;
      const n = Math.max(1, Math.hypot(x1 - x0, y1 - y0) | 0);
      for (let t = 0; t <= n; t++) put(Math.round(x0 + ((x1 - x0) * t) / n), Math.round(y0 + ((y1 - y0) * t) / n), rgb);
    }
  }
}
for (const z of geo.zones) {
  const cont = geo.continents[z.continent];
  const wv = cont.worldViewPins?.[z.zoneName] || cont.worldView;
  const rgb = z.continent === "Kalimdor" ? [80, 220, 255] : [255, 210, 60];
  drawZone(z, wv, rgb);
}
await sharp(img, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(outDir, "world-fit-pinned.png"));

fs.writeFileSync(geoPath, JSON.stringify(geo) + "\n");
let out = JSON.stringify(seeds, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, n) => `[${n.split(/,\s+/).join(", ")}]`);
fs.writeFileSync(seedsPath, out + "\n");
console.log("Kal", geo.continents.Kalimdor.worldView, "Tel", geo.continents.Kalimdor.worldViewPins.Teldrassil);
console.log("EK south", geo.continents["Eastern Kingdoms"].worldView);
console.log("EK north pin sample", geo.continents["Eastern Kingdoms"].worldViewPins["Tirisfal Glades"]);
console.log("wrote world-fit-pinned.png");
