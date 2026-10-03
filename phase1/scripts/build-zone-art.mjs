/**
 * Build distinctive local zone art (SVG) so the heatmap never depends on external CDNs.
 * Run: node scripts/build-zone-art.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "host", "public", "zones");

const ZONES = {
  "dun-morogh": { sky: "#6a8aa8", mid: "#c9d6e0", ground: "#8fa0ae", accent: "#e8f0f6", motif: "snow" },
  anvilmar: { sky: "#5a7088", mid: "#b8c4ce", ground: "#7a8a98", accent: "#dfe8f0", motif: "snow" },
  "elwynn-forest": { sky: "#7aa868", mid: "#c5d98a", ground: "#6b8f3a", accent: "#e8f0b8", motif: "forest" },
  "northshire-abbey": { sky: "#7aa868", mid: "#c5d98a", ground: "#6b8f3a", accent: "#e8f0b8", motif: "forest" },
  goldshire: { sky: "#7aa868", mid: "#c5d98a", ground: "#6b8f3a", accent: "#e8f0b8", motif: "forest" },
  westfall: { sky: "#c4a86a", mid: "#e0c888", ground: "#9a7a3a", accent: "#f0e0a8", motif: "plains" },
  duskwood: { sky: "#2a3040", mid: "#3a4858", ground: "#1a2030", accent: "#6a7088", motif: "dark" },
  "loch-modan": { sky: "#6a9ab0", mid: "#8ab8c8", ground: "#4a7a58", accent: "#c8e0e8", motif: "lake" },
  wetlands: { sky: "#4a7080", mid: "#5a8890", ground: "#3a5a48", accent: "#88a8a8", motif: "lake" },
  "redridge-mountains": { sky: "#c87858", mid: "#e0a078", ground: "#8a4030", accent: "#f0c8a0", motif: "red" },
  "burning-steppes": { sky: "#c05030", mid: "#e07840", ground: "#502010", accent: "#f0a060", motif: "fire" },
  "searing-gorge": { sky: "#a84828", mid: "#c86838", ground: "#401808", accent: "#e08850", motif: "fire" },
  teldrassil: { sky: "#3a2868", mid: "#5a4890", ground: "#2a1848", accent: "#a090d0", motif: "night" },
  darnassus: { sky: "#4a3878", mid: "#6a58a0", ground: "#3a2860", accent: "#b0a0e0", motif: "night" },
  shadowglen: { sky: "#3a2868", mid: "#5a4890", ground: "#2a1848", accent: "#a090d0", motif: "night" },
  darkshore: { sky: "#1a3048", mid: "#2a4868", ground: "#102030", accent: "#6888a8", motif: "coast" },
  ashenvale: { sky: "#386050", mid: "#588870", ground: "#284838", accent: "#88b898", motif: "forest" },
  durotar: { sky: "#c87840", mid: "#e0a060", ground: "#8a4820", accent: "#f0c888", motif: "desert" },
  orgrimmar: { sky: "#c06030", mid: "#d88850", ground: "#602818", accent: "#e8a870", motif: "desert" },
  "razor-hill": { sky: "#c87840", mid: "#e0a060", ground: "#8a4820", accent: "#f0c888", motif: "desert" },
  "valley-of-trials": { sky: "#c87840", mid: "#e0a060", ground: "#8a4820", accent: "#f0c888", motif: "desert" },
  mulgore: { sky: "#88a868", mid: "#b8d090", ground: "#688848", accent: "#d8e8b0", motif: "plains" },
  "thunder-bluff": { sky: "#88a868", mid: "#b8d090", ground: "#688848", accent: "#d8e8b0", motif: "plains" },
  "bloodhoof-village": { sky: "#88a868", mid: "#b8d090", ground: "#688848", accent: "#d8e8b0", motif: "plains" },
  "tirisfal-glades": { sky: "#687888", mid: "#8898a0", ground: "#485860", accent: "#a8b8c0", motif: "plague" },
  "deathknell": { sky: "#687888", mid: "#8898a0", ground: "#485860", accent: "#a8b8c0", motif: "plague" },
  brill: { sky: "#687888", mid: "#8898a0", ground: "#485860", accent: "#a8b8c0", motif: "plague" },
  undercity: { sky: "#506070", mid: "#708090", ground: "#304050", accent: "#90a0b0", motif: "plague" },
  "silverpine-forest": { sky: "#506868", mid: "#708888", ground: "#304848", accent: "#90a8a8", motif: "dark" },
  "the-barrens": { sky: "#c89850", mid: "#e0b870", ground: "#906830", accent: "#f0d898", motif: "desert" },
  barrens: { sky: "#c89850", mid: "#e0b870", ground: "#906830", accent: "#f0d898", motif: "desert" },
  "stonetalon-mountains": { sky: "#8898a0", mid: "#a8b8c0", ground: "#687880", accent: "#c8d8e0", motif: "mountain" },
  "thousand-needles": { sky: "#d0a868", mid: "#e8c888", ground: "#a07838", accent: "#f8e0a8", motif: "desert" },
  desolace: { sky: "#908070", mid: "#b0a090", ground: "#605040", accent: "#d0c0b0", motif: "plague" },
  "dustwallow-marsh": { sky: "#609080", mid: "#80b0a0", ground: "#407060", accent: "#a0d0c0", motif: "lake" },
  feralas: { sky: "#408060", mid: "#60a080", ground: "#286048", accent: "#90c8a8", motif: "forest" },
  tanaris: { sky: "#e0c070", mid: "#f0d890", ground: "#c0a040", accent: "#fff0b0", motif: "desert" },
  "ungoro-crater": { sky: "#50a060", mid: "#70c080", ground: "#308040", accent: "#a0e0b0", motif: "jungle" },
  silithus: { sky: "#c0b070", mid: "#d8c890", ground: "#908050", accent: "#f0e0b0", motif: "desert" },
  winterspring: { sky: "#90b0d0", mid: "#c0d8e8", ground: "#7090a8", accent: "#e8f4fc", motif: "snow" },
  felwood: { sky: "#506040", mid: "#708058", ground: "#304028", accent: "#90a870", motif: "plague" },
  moonglade: { sky: "#406888", mid: "#6890b0", ground: "#285068", accent: "#a0c8e0", motif: "night" },
  kalimdor: { sky: "#c89850", mid: "#70a070", ground: "#806030", accent: "#e0c888", motif: "continent" },
  "eastern-kingdoms": { sky: "#7090b0", mid: "#90b080", ground: "#506070", accent: "#c0d8e0", motif: "continent" },
  ironforge: { sky: "#708090", mid: "#a0b0c0", ground: "#505860", accent: "#d0dce8", motif: "city" },
  "stormwind-city": { sky: "#6890b8", mid: "#90b0d0", ground: "#486888", accent: "#c8dcf0", motif: "city" },
  stormwind: { sky: "#6890b8", mid: "#90b0d0", ground: "#486888", accent: "#c8dcf0", motif: "city" },
  kharanos: { sky: "#6a8aa8", mid: "#c9d6e0", ground: "#8fa0ae", accent: "#e8f0f6", motif: "snow" },
  dolanaar: { sky: "#3a2868", mid: "#5a4890", ground: "#2a1848", accent: "#a090d0", motif: "night" },
};

function motifs(motif, accent) {
  if (motif === "snow") {
    return `<circle cx="40" cy="36" r="18" fill="${accent}" opacity=".35"/><circle cx="120" cy="44" r="26" fill="${accent}" opacity=".28"/><circle cx="200" cy="32" r="20" fill="${accent}" opacity=".32"/>
      <path d="M0 95 L40 70 L80 95 L120 60 L160 95 L200 55 L240 95 L280 65 L320 95 V140 H0 Z" fill="${accent}" opacity=".45"/>`;
  }
  if (motif === "forest") {
    return `<path d="M50 110 L70 60 L90 110 Z" fill="${accent}" opacity=".4"/><path d="M110 115 L135 50 L160 115 Z" fill="${accent}" opacity=".5"/><path d="M190 110 L215 55 L240 110 Z" fill="${accent}" opacity=".35"/>`;
  }
  if (motif === "night") {
    return `<circle cx="250" cy="35" r="22" fill="${accent}" opacity=".55"/><circle cx="60" cy="40" r="3" fill="${accent}"/><circle cx="100" cy="28" r="2" fill="${accent}"/><circle cx="140" cy="45" r="2.5" fill="${accent}"/><circle cx="180" cy="22" r="2" fill="${accent}"/>
      <path d="M0 100 Q80 70 160 100 T320 100 V140 H0 Z" fill="${accent}" opacity=".25"/>`;
  }
  if (motif === "coast") {
    return `<path d="M0 80 Q80 100 160 75 T320 90 V140 H0 Z" fill="${accent}" opacity=".35"/><path d="M0 100 Q100 120 200 95 T320 110 V140 H0 Z" fill="${accent}" opacity=".25"/>`;
  }
  if (motif === "desert" || motif === "plains") {
    return `<path d="M0 90 Q60 70 120 95 T240 85 T320 100 V140 H0 Z" fill="${accent}" opacity=".35"/><ellipse cx="200" cy="70" rx="40" ry="8" fill="${accent}" opacity=".2"/>`;
  }
  if (motif === "lake") {
    return `<ellipse cx="160" cy="95" rx="90" ry="28" fill="${accent}" opacity=".4"/><ellipse cx="160" cy="95" rx="60" ry="16" fill="${accent}" opacity=".25"/>`;
  }
  if (motif === "fire" || motif === "red") {
    return `<path d="M80 120 L100 50 L120 120 Z" fill="${accent}" opacity=".5"/><path d="M150 120 L175 40 L200 120 Z" fill="${accent}" opacity=".6"/><path d="M220 120 L245 55 L270 120 Z" fill="${accent}" opacity=".45"/>`;
  }
  if (motif === "city") {
    return `<rect x="70" y="55" width="28" height="60" fill="${accent}" opacity=".35"/><rect x="110" y="40" width="36" height="75" fill="${accent}" opacity=".45"/><rect x="160" y="50" width="30" height="65" fill="${accent}" opacity=".4"/><rect x="210" y="35" width="42" height="80" fill="${accent}" opacity=".5"/>`;
  }
  if (motif === "continent") {
    return `<ellipse cx="120" cy="80" rx="70" ry="40" fill="${accent}" opacity=".3"/><ellipse cx="210" cy="90" rx="55" ry="35" fill="${accent}" opacity=".25"/>`;
  }
  if (motif === "jungle") {
    return `<path d="M40 120 Q60 40 80 120" stroke="${accent}" stroke-width="8" fill="none" opacity=".4"/><path d="M120 120 Q145 30 170 120" stroke="${accent}" stroke-width="10" fill="none" opacity=".45"/><path d="M220 120 Q245 45 270 120" stroke="${accent}" stroke-width="8" fill="none" opacity=".4"/>`;
  }
  if (motif === "plague" || motif === "dark") {
    return `<circle cx="80" cy="70" r="25" fill="${accent}" opacity=".2"/><circle cx="180" cy="55" r="35" fill="${accent}" opacity=".18"/><circle cx="260" cy="80" r="20" fill="${accent}" opacity=".22"/>`;
  }
  if (motif === "mountain") {
    return `<path d="M20 120 L90 40 L160 120 Z" fill="${accent}" opacity=".4"/><path d="M120 120 L200 30 L280 120 Z" fill="${accent}" opacity=".5"/>`;
  }
  return "";
}

function svgFor(slug, palette) {
  const { sky, mid, ground, accent, motif } = palette;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140" width="320" height="140" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g-${slug}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky}"/>
      <stop offset="55%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${ground}"/>
    </linearGradient>
  </defs>
  <rect width="320" height="140" fill="url(#g-${slug})"/>
  ${motifs(motif, accent)}
  <rect width="320" height="140" fill="#000" opacity=".18"/>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const [slug, palette] of Object.entries(ZONES)) {
  fs.writeFileSync(path.join(outDir, `${slug}.svg`), svgFor(slug, palette), "utf8");
  n += 1;
}
// default fallback
fs.writeFileSync(
  path.join(outDir, `_default.svg`),
  svgFor("default", { sky: "#5a4a30", mid: "#8a7040", ground: "#3a2a18", accent: "#c9a24a", motif: "plains" }),
  "utf8"
);
console.log(`Wrote ${n + 1} zone thumbs → ${outDir}`);
