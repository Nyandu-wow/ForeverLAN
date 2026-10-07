#!/usr/bin/env node
/**
 * Trace real zone boundary polygons from the Forever client continent map art.
 *
 *   npm i --no-save sharp        (build-time only; the dashboard does not need it)
 *   node scripts/maps/trace-zone-polygons.mjs [--debug]
 *
 * The classic continent textures (1002x668) paint every zone as its own region
 * separated by dark border strokes. For each continent we:
 *   1. classify land (warm parchment) vs sea / lakes (cool blue-grey),
 *   2. compute a border-stroke cost (local darkness),
 *   3. run a seeded priority-flood watershed: one label per zone, seeded at
 *      known town positions projected with the telemetry-fitted world->map
 *      transform, so regions meet on the painted borders,
 *   4. trace each label's outer boundary along pixel edges and simplify it.
 * The continents are then fitted (isotropic scale + offset) onto the world art
 * so both share one world-view coordinate system.
 *
 * Output: host/public/data/maps/world-zones.json (committed, static).
 * Debug overlays (with --debug): .cache/maps/*.png (git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ART_DIR = path.join(root, "host", "public", "assets", "maps");
const OUT = path.join(root, "host", "public", "data", "maps", "world-zones.json");
const DEBUG_DIR = path.join(root, ".cache", "maps");
const debug = process.argv.includes("--debug");
/** Land = box-averaged (red - blue) warmth; sea, lakes and the hatched sea band are cool. */
const LAND_R = +(process.env.LAND_R || 3);
const LAND_WARM = +(process.env.LAND_WARM || 35);
const SEA_WARM = +(process.env.SEA_WARM || 25);
const VOID_MAX_WARM = +(process.env.VOID_MAX_WARM || 60);
const WATER_WARM = +(process.env.WATER_WARM || 15);

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is required for tracing: npm i --no-save sharp");
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(path.join(here, "zone-seeds.json"), "utf8"));

async function loadArt(file) {
  const { data, info } = await sharp(path.join(ART_DIR, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

function boxMean(src, W, H, R) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) {
      s += src[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
      out[y * W + x] =
        (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) /
        ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function classify({ data, W, H }, landWarm = LAND_WARM, seaWarm = SEA_WARM, voidMaxWarm = VOID_MAX_WARM) {
  const N = W * H;
  const L = new Float32Array(N);
  const warm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    L[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
    warm[i] = data[i * 3] - data[i * 3 + 2];
  }
  const warmBox = boxMean(warm, W, H, LAND_R);
  const warmFine = boxMean(warm, W, H, 1);
  const l1 = boxMean(L, W, H, 1);
  const l6 = boxMean(L, W, H, 6);
  const land = new Uint8Array(N);
  const sea = new Uint8Array(N);
  const voidOk = new Uint8Array(N);
  const cost = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    land[i] = warmBox[i] > landWarm ? 1 : 0;
    // Open sea by area, plus thin painted rivers/lakes (pale blue between border strokes).
    sea[i] = warmBox[i] < seaWarm || warmFine[i] < WATER_WARM ? 1 : 0;
    voidOk[i] = warmBox[i] < voidMaxWarm ? 1 : 0;
    cost[i] = Math.max(0, Math.min(255, Math.round((l6[i] - l1[i]) * 4)));
  }
  return { land, sea, voidOk, cost };
}

/**
 * Seeded priority-flood watershed. Zone labels may only claim land pixels;
 * the VOID label (sea, frame, unassigned regions) may claim everything except
 * clearly painted land, so the sea takes the hatched coastal band and lettering
 * that straddles the coast, but cannot come ashore.
 */
function watershed(W, H, land, voidOk, cost, seeds, VOID, rects) {
  const N = W * H;
  const inRect = (label, q) => {
    const r = rects[label];
    if (!r) return true;
    const x = q % W, y = (q / W) | 0;
    return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  };
  const lab = new Int16Array(N).fill(-1);
  const voidSeeded = new Uint8Array(N);
  const buckets = Array.from({ length: 256 }, () => []);
  for (const s of seeds) {
    const r = s.zone === "frame" ? 0 : s.pinned ? 1 : 3;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (s.label === VOID) voidSeeded[i] = 1;
        if ((!land[i] && s.label !== VOID) || lab[i] >= 0) continue;
        lab[i] = s.label;
        buckets[0].push(i);
      }
  }
  // Geodesic assignment (Dijkstra): each pixel joins the seed with the cheapest path, where a step
  // costs 1 + (stroke darkness)^2. A gap in a painted border still costs the whole walk from a far
  // seed, so textured zones keep their area instead of being flooded through one weak spot.
  const dist = new Float64Array(N).fill(Infinity);
  const heap = new MinHeap();
  for (const b of buckets) for (const i of b) { dist[i] = 0; heap.push(0, i); }
  const stepCost = new Float32Array(256);
  for (let c = 0; c < 256; c++) stepCost[c] = 1 + (c / 20) ** 2;
  while (heap.size) {
    const [d, p] = heap.pop();
    if (d > dist[p]) continue;
    const x = p % W;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
      if (q < 0 || q >= N) continue;
      if (lab[p] === VOID ? !voidOk[q] && !voidSeeded[q] : !land[q]) continue;
      if (!inRect(lab[p], q)) continue;
      const nd = d + stepCost[cost[q]];
      if (nd < dist[q]) {
        dist[q] = nd;
        lab[q] = lab[p];
        heap.push(nd, q);
      }
    }
  }
  return lab;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function components(mask, W, H) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  const list = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = list.length;
    const stack = [s];
    comp[s] = id;
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
        if (q < 0 || q >= N || !mask[q] || comp[q] >= 0) continue;
        comp[q] = id;
        stack.push(q);
      }
    }
    list.push({ id, n });
  }
  return { comp, list };
}

/**
 * Outer boundary of a pixel component as pixel-corner vertices.
 * Every exposed pixel side becomes a directed edge with the interior on its right;
 * edges are chained into loops and the loop with the largest area is the outer ring
 * (smaller loops are holes such as lakes, which belong to the zone).
 */
function traceOuter(mask, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const key = (x, y) => y * (W + 1) + x;
  const out = new Map(); // vertex -> list of [toX, toY, dir]
  const add = (x1, y1, x2, y2, dir) => {
    const k = key(x1, y1);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([x2, y2, dir]);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y, 0); // top, east
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1); // right, south
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2); // bottom, west
      if (!inside(x - 1, y)) add(x, y + 1, x, y, 3); // left, north
    }
  let best = [], bestArea = 0;
  for (const [k0, list0] of out) {
    while (list0.length) {
      const sx = k0 % (W + 1), sy = Math.floor(k0 / (W + 1));
      const ring = [[sx, sy]];
      let [nx, ny, dir] = list0.pop();
      for (let guard = 0; guard < 4 * W * H; guard++) {
        if (nx === sx && ny === sy) break;
        ring.push([nx, ny]);
        const opts = out.get(key(nx, ny));
        if (!opts || !opts.length) break;
        // At pinch vertices prefer the left turn so 8-touching pixels stay in one ring.
        let pick = -1;
        for (const d of [(dir + 3) % 4, dir, (dir + 1) % 4]) {
          pick = opts.findIndex((e) => e[2] === d);
          if (pick >= 0) break;
        }
        if (pick < 0) pick = 0;
        [nx, ny, dir] = opts.splice(pick, 1)[0];
      }
      const a = Math.abs(ringArea(ring));
      if (a > bestArea) { bestArea = a; best = ring; }
    }
  }
  return best;
}

function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  // Douglas-Peucker on a closed ring: split at the two farthest points.
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; b = i; }
  }
  const dp = (seg) => {
    if (seg.length < 3) return seg;
    const [p, q] = [seg[0], seg[seg.length - 1]];
    const vx = q[0] - p[0], vy = q[1] - p[1];
    const len = Math.hypot(vx, vy) || 1;
    let idx = 0, dmax = 0;
    for (let i = 1; i < seg.length - 1; i++) {
      const d = Math.abs((seg[i][0] - p[0]) * vy - (seg[i][1] - p[1]) * vx) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= eps) return [p, q];
    const left = dp(seg.slice(0, idx + 1));
    const right = dp(seg.slice(idx));
    return left.slice(0, -1).concat(right);
  };
  const ring1 = dp(pts.slice(a, b + 1));
  const ring2 = dp(pts.slice(b).concat([pts[0]]));
  return ring1.slice(0, -1).concat(ring2.slice(0, -1));
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Pixel deepest inside the mask (pole of inaccessibility on the pixel grid). */
function deepestPixel(mask, W, H) {
  const N = W * H;
  const D = new Float32Array(N);
  for (let i = 0; i < N; i++) D[i] = mask[i] ? 1e9 : 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!D[i]) continue;
      const up = y > 0 ? D[i - W] : 0, lf = x > 0 ? D[i - 1] : 0;
      D[i] = Math.min(D[i], up + 1, lf + 1);
    }
  let best = 0, bi = 0;
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!D[i]) continue;
      const dn = y < H - 1 ? D[i + W] : 0, rt = x < W - 1 ? D[i + 1] : 0;
      D[i] = Math.min(D[i], dn + 1, rt + 1);
      if (D[i] > best) { best = D[i]; bi = i; }
    }
  return [bi % W + 0.5, ((bi / W) | 0) + 0.5];
}

const r4 = (n) => Math.round(n * 1e4) / 1e4;

/** Zone map extent [left Y, right Y, top X, bottom X] -> continent [u0, v0, u1, v1]. */
function zoneRectUV([left, right, top, bottom], t) {
  return [t.x0 + t.xk * left, t.y0 + t.yk * top, t.x0 + t.xk * right, t.y0 + t.yk * bottom];
}

async function traceContinent(name, cont) {
  const art = await loadArt(cont.art);
  const { W, H } = art;
  const cc = cont.classify || {};
  const { land, sea, voidOk, cost } = classify(art, cc.landWarm ?? LAND_WARM, cc.seaWarm ?? SEA_WARM, cc.voidMaxWarm ?? VOID_MAX_WARM);
  const t = cont.worldToMap;
  const zones = cfg.zones.filter((z) => z.continent === name);
  const costBox = boxMean(Float32Array.from(cost), W, H, 3);
  // A seed that lands on a painted detail (letters, peaks, a crater rim) gets boxed in;
  // move it to the calmest land pixel nearby.
  const snap = (x0, y0) => {
    let best = null;
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        if (dx * dx + dy * dy > 64) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!land[i] || sea[i]) continue;
        const score = costBox[i] + 0.4 * Math.hypot(dx, dy);
        if (!best || score < best.score) best = { x, y, score };
      }
    return best || { x: x0, y: y0 };
  };
  const seeds = [];
  zones.forEach((z, k) => {
    // "logged": [X, Y] positions the client reported inside this zone - exact, never snapped.
    const pts = [...z.wow.map((p) => [p, false]), ...(z.logged || []).map((p) => [p, true])];
    for (const [[X, Y], pinned] of pts) {
      const u = t.x0 + t.xk * Y; // world_x (telemetry) = WoW Y
      const v = t.y0 + t.yk * X; // world_y (telemetry) = WoW X
      const x = Math.round(u * W), y = Math.round(v * H);
      const p = pinned ? { x, y } : snap(x, y);
      seeds.push({ label: k, x: p.x, y: p.y, zone: z.zoneName, pinned });
    }
  });
  const VOID = zones.length; // sea and lakes
  const UNASSIGNED = VOID + 1; // frame and painted land with no Forever zone: grows like a zone, never output
  for (const s of seeds) {
    if (!land[s.y * W + s.x]) console.warn(`  ! seed for ${s.zone} at px ${s.x},${s.y} is not on land`);
  }
  for (const vs of cont.voidSeeds || []) seeds.push({ label: UNASSIGNED, x: vs.px[0], y: vs.px[1], zone: vs.label });
  // The parchment frame is warm like land and touches the continent tips; grow it from the image
  // edge with zone rules so it meets the zones on the dark coastline instead of being claimed.
  for (let x = 0; x < W; x += 3) seeds.push({ label: UNASSIGNED, x, y: 2, zone: "frame" }, { label: UNASSIGNED, x, y: H - 3, zone: "frame" });
  for (let y = 0; y < H; y += 3) seeds.push({ label: UNASSIGNED, x: 2, y, zone: "frame" }, { label: UNASSIGNED, x: W - 3, y, zone: "frame" });
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) if (sea[y * W + x]) seeds.push({ label: VOID, x, y, zone: "frame" });
  // Zones may only grow on the painted continent: strong-land regions that hold a zone seed,
  // widened a few px so border strokes and pale coast strips are included.
  const strong = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) strong[i] = voidOk[i] ? 0 : 1;
  const sc = components(strong, W, H);
  const keep = new Set();
  for (const s of seeds) if (s.label !== VOID && strong[s.y * W + s.x]) keep.add(sc.comp[s.y * W + s.x]);
  let domain = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) domain[i] = keep.has(sc.comp[i]) ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const prev = domain.slice();
    for (let i = 0; i < W * H; i++) {
      if (prev[i]) continue;
      const x = i % W;
      if ((x > 0 && prev[i - 1]) || (x < W - 1 && prev[i + 1]) || prev[i - W] || prev[i + W]) domain[i] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) domain[i] = domain[i] && land[i] ? 1 : 0;
  const RECT_MARGIN = 2;
  const rects = zones.map((z) => {
    if (!z.worldRect) return null;
    const r = zoneRectUV(z.worldRect, t);
    return [r[0] * W - RECT_MARGIN, r[1] * H - RECT_MARGIN, r[2] * W + RECT_MARGIN, r[3] * H + RECT_MARGIN];
  });
  const lab = watershed(W, H, domain, voidOk, cost, seeds, VOID, rects);

  const out = [];
  const union = new Uint8Array(W * H);
  zones.forEach((z, k) => {
    const mask = new Uint8Array(W * H);
    let n = 0;
    for (let i = 0; i < W * H; i++) if (lab[i] === k) { mask[i] = 1; n++; }
    if (!n) {
      console.warn(`  ! ${z.zoneName}: no pixels`);
      return;
    }
    const { comp, list } = components(mask, W, H);
    const parts = list.filter((c) => c.n >= 40).sort((a, b) => b.n - a.n);
    const polys = parts.map((c) => {
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) if (comp[i] === c.id) { m[i] = 1; union[i] = 1; }
      const ring = simplify(traceOuter(m, W, H), 0.75);
      return { ring, area: Math.abs(ringArea(ring)), mask: m };
    });
    const main = polys[0];
    if (!main) {
      console.warn(`  ! ${z.zoneName}: only fragments (${n} px)`);
      return;
    }
    const [lx, ly] = deepestPixel(main.mask, W, H);
    out.push({
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      continent: name,
      mapId: cont.mapId,
      levels: z.levels || null,
      polygon: main.ring.map(([x, y]) => [r4(x / W), r4(y / H)]),
      extraPolygons: polys.slice(1).map((p) => p.ring.map(([x, y]) => [r4(x / W), r4(y / H)])),
      labelAt: [r4(lx / W), r4(ly / H)],
      mapRect: z.worldRect ? zoneRectUV(z.worldRect, t).map(r4) : null,
      pixelArea: n,
    });
    console.log(`  ${z.zoneName.padEnd(22)} ${String(n).padStart(6)} px  ${main.ring.length} pts${polys.length > 1 ? ` +${polys.length - 1} part(s)` : ""}`);
  });
  return { art, out, union, seeds, lab, zones };
}

/** Fit continent art onto the world art: world = s * continent + (tx, ty), in pixels. */
async function fitToWorld(union, cont, W, H) {
  const world = await loadArt("azeroth-world.webp");
  // The world art's sea is a warm parchment wash (warmth 30-70); its continents read 130+.
  const { land: rawLand } = classify(world, 95);
  const land = new Uint8Array(world.W * world.H);
  const FRAME = 30;
  for (let y = FRAME; y < world.H - FRAME; y++)
    for (let x = FRAME; x < world.W - FRAME; x++) land[y * world.W + x] = rawLand[y * world.W + x];
  // The continent on the world art = every sizeable land blob inside its window.
  const { comp: blobs, list } = components(land, world.W, world.H);
  const [wa, wb, wc, wd] = cont.worldViewWindow;
  const bigBlobs = new Set(list.filter((c) => c.n >= 150).map((c) => c.id));
  const target = 1;
  const comp = new Int32Array(world.W * world.H);
  for (let i = 0; i < world.W * world.H; i++) {
    const x = i % world.W, y = (i / world.W) | 0;
    comp[i] = bigBlobs.has(blobs[i]) && x >= wa && x <= wc && y >= wb && y <= wd ? target : 0;
  }
  const isLand = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < world.W && yi < world.H && comp[yi * world.W + xi] === target;
  };
  let wx0 = 1e9, wy0 = 1e9, wx1 = -1, wy1 = -1;
  for (let y = 0; y < world.H; y++)
    for (let x = 0; x < world.W; x++)
      if (comp[y * world.W + x] === target) {
        wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); wy0 = Math.min(wy0, y); wy1 = Math.max(wy1, y);
      }
  const pts = [];
  let cx0 = 1e9, cy0 = 1e9, cx1 = -1, cy1 = -1;
  for (let i = 0; i < W * H; i += 7)
    if (union[i]) {
      const x = i % W, y = (i / W) | 0;
      pts.push([x, y]);
      cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y);
    }
  const wpts = [];
  for (let i = 0; i < world.W * world.H; i += 5) if (comp[i] === target) wpts.push([i % world.W, (i / world.W) | 0]);
  const inUnion = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < H && union[yi * W + xi] === 1;
  };
  // Symmetric overlap: continent zones must land on world land AND world land must map back onto zones.
  const score = (s, tx, ty) => {
    let a = 0, b = 0;
    for (const [x, y] of pts) if (isLand(s * x + tx, s * y + ty)) a++;
    for (const [x, y] of wpts) if (inUnion((x - tx) / s, (y - ty) / s)) b++;
    return (a / pts.length + b / wpts.length) / 2;
  };
  console.log(`  world land bbox ${wx0},${wy0}..${wx1},${wy1}; continent zone bbox ${cx0},${cy0}..${cx1},${cy1}`);
  if (debug) {
    const img = Buffer.alloc(world.W * world.H * 3);
    for (let i = 0; i < world.W * world.H; i++) {
      const v = comp[i] === target ? [255, 200, 80] : land[i] ? [120, 90, 40] : [20, 40, 80];
      img[i * 3] = v[0]; img[i * 3 + 1] = v[1]; img[i * 3 + 2] = v[2];
    }
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    await sharp(img, { raw: { width: world.W, height: world.H, channels: 3 } }).png().toFile(path.join(DEBUG_DIR, `world-land-${cont.mapId}.png`));
  }
  let s0 = (wy1 - wy0) / (cy1 - cy0);
  let best = { s: s0, tx: wx0 - s0 * cx0, ty: wy0 - s0 * cy0 };
  best.score = score(best.s, best.tx, best.ty);
  for (const step of [8, 4, 2, 1, 0.5]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [ds, dx, dy] of [[0.01, 0, 0], [-0.01, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const c = { s: best.s + ds * step / 4, tx: best.tx + dx * step, ty: best.ty + dy * step };
        c.score = score(c.s, c.tx, c.ty);
        if (c.score > best.score + 1e-6) { best = c; improved = true; }
      }
    }
  }
  return { scale: r4(best.s), tx: r4(best.tx / world.W), ty: r4(best.ty / world.H), landOverlap: r4(best.score) };
}

async function debugOverlay(name, res) {
  const { art, out, seeds } = res;
  const { W, H } = art;
  const S = 2;
  const color = (k) => `hsl(${(k * 137) % 360} 90% 55%)`;
  const paths = out
    .map((z, k) => {
      const d = [z.polygon, ...z.extraPolygons]
        .map((ring) => "M" + ring.map(([x, y]) => `${(x * W * S).toFixed(1)},${(y * H * S).toFixed(1)}`).join("L") + "Z")
        .join("");
      const rect = z.mapRect
        ? `<rect x="${z.mapRect[0] * W * S}" y="${z.mapRect[1] * H * S}" width="${(z.mapRect[2] - z.mapRect[0]) * W * S}" height="${(z.mapRect[3] - z.mapRect[1]) * H * S}" fill="none" stroke="${color(k)}" stroke-dasharray="6 4" stroke-width="1.2"/>`
        : "";
      return rect + `<path d="${d}" fill="${color(k)}" fill-opacity="0.35" stroke="#000" stroke-width="1.5"/>` +
        `<text x="${z.labelAt[0] * W * S}" y="${z.labelAt[1] * H * S}" font-size="13" font-family="Arial" font-weight="bold" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="middle">${z.zoneName}</text>`;
    })
    .join("");
  const dots = seeds.filter((s) => s.zone !== "frame").map((s) => `<circle cx="${s.x * S}" cy="${s.y * S}" r="3" fill="#f0f" stroke="#000"/>`).join("");
  const svg = `<svg width="${W * S}" height="${H * S}" xmlns="http://www.w3.org/2000/svg">${paths}${dots}</svg>`;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  await sharp(path.join(ART_DIR, cfg.continents[name].art))
    .resize(W * S, H * S)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(path.join(DEBUG_DIR, `${cfg.continents[name].art.replace(".webp", "")}-zones.png`));
}

const result = {
  version: 1,
  about:
    "Zone boundary polygons traced from the Forever beta client's continent map art (1002x668). " +
    "Geometry is reference data, not telemetry. Regenerate with scripts/maps/trace-zone-polygons.mjs.",
  provenance: {
    art: "host/public/assets/maps/*.webp - Forever beta client map textures (Blizzard Entertainment, see NOTICE). Not MIT.",
    method:
      "Seeded watershed on the painted zone borders; seeds at known town positions projected with the telemetry-fitted world->map transform. No third-party boundary data was used.",
    accuracy: "Borders follow the painted strokes to about 1-2 px of the 1002x668 art; where the art's own continent label covers a border the split is approximate.",
  },
  coordinateSystem:
    "polygon/labelAt are normalized [u,v] in 0..1 of the continent art (u right, v down) - the same space as C_Map continent positions (map_x/map_y on mapId 1415/1414). " +
    "worldView maps continent [u,v] onto the world art: [s*u + tx, s*v + ty].",
  continents: {},
  zones: [],
  foldIntoZone: Object.fromEntries(Object.entries(cfg.foldIntoZone).filter(([k]) => k !== "about")),
  noGeometry: Object.fromEntries(Object.entries(cfg.noGeometry).filter(([k]) => k !== "about")),
};

for (const [name, cont] of Object.entries(cfg.continents)) {
  console.log(`${name}:`);
  const res = await traceContinent(name, cont);
  const worldView = cont.worldView || (await fitToWorld(res.union, cont, res.art.W, res.art.H));
  if (cont.worldView) console.log(`  world view (locked): scale ${worldView.scale}, offset ${worldView.tx},${worldView.ty}`);
  else console.log(`  world view fit: scale ${worldView.scale}, offset ${worldView.tx},${worldView.ty}, land overlap ${worldView.landOverlap}`);
  result.continents[name] = {
    mapId: cont.mapId,
    art: `/public/assets/maps/${cont.art}`,
    width: res.art.W,
    height: res.art.H,
    worldToMap: { x0: cont.worldToMap.x0, xk: cont.worldToMap.xk, y0: cont.worldToMap.y0, yk: cont.worldToMap.yk },
    worldView,
  };
  if (cont.worldViewPins) result.continents[name].worldViewPins = cont.worldViewPins;
  result.zones.push(...res.out.map(({ pixelArea, ...z }) => z));
  if (debug) await debugOverlay(name, res);
}
result.worldArt = { art: "/public/assets/maps/azeroth-world.webp", width: 1002, height: 668 };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result) + "\n");
console.log(`wrote ${path.relative(root, OUT)} (${result.zones.length} zones, ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
