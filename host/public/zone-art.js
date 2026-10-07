/* Zone card artwork for the weekend heatmap — local static assets only.
 * Sources: warcraft.wiki.gg zone / loading-screen stills (downloaded for LAN offline use). */

const ZONE_ART = {
  "Dun Morogh": "/public/assets/zones/dun-morogh.jpg",
  "Darkshore": "/public/assets/zones/darkshore.jpg",
  "Teldrassil": "/public/assets/zones/teldrassil.jpg",
  "Stormwind City": "/public/assets/zones/stormwind-city.jpg",
  "Ironforge": "/public/assets/zones/ironforge.jpg",
  "Anvilmar": "/public/assets/zones/anvilmar.jpg",
  "Loch Modan": "/public/assets/zones/loch-modan.jpg",
  "Elwynn Forest": "/public/assets/zones/elwynn-forest.jpg",
  "Duskwood": "/public/assets/zones/duskwood.jpg",
  "Kalimdor": "/public/assets/zones/kalimdor.jpg",
  "Darnassus": "/public/assets/zones/darnassus.jpg",
  "Westfall": "/public/assets/zones/westfall.jpg",
  // Common aliases / nearby names from the log
  "Coldridge Valley": "/public/assets/zones/anvilmar.jpg",
  "Kharanos": "/public/assets/zones/dun-morogh.jpg",
  "Goldshire": "/public/assets/zones/elwynn-forest.jpg",
  "Northshire Abbey": "/public/assets/zones/elwynn-forest.jpg",
  "Northshire Valley": "/public/assets/zones/elwynn-forest.jpg",
  "Shadowglen": "/public/assets/zones/teldrassil.jpg",
  "Dolanaar": "/public/assets/zones/teldrassil.jpg",
  "Stormwind": "/public/assets/zones/stormwind-city.jpg",
};

const ZONE_ART_FALLBACK = "/public/assets/zones/zone-fallback.jpg";

const ZONE_ART_BY_KEY = (() => {
  const map = Object.create(null);
  for (const [name, url] of Object.entries(ZONE_ART)) {
    map[String(name).trim().toLowerCase()] = url;
  }
  return map;
})();

function zoneArtUrl(zoneName) {
  const key = String(zoneName || "").trim().toLowerCase();
  if (!key) return ZONE_ART_FALLBACK;
  const hit = ZONE_ART_BY_KEY[key];
  if (hit) return hit;
  if (typeof location !== "undefined" && /localhost|127\.0\.0\.1/.test(location.hostname)) {
    console.warn(`[ForeverLAN] Missing zone art for "${zoneName}" — using fallback`);
  }
  return ZONE_ART_FALLBACK;
}

function zoneCardMediaHtml(zoneName) {
  const name = String(zoneName || "").trim();
  const url = zoneArtUrl(name);
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<img class="zone-thumb" src="${esc(url)}" alt=""
    onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${ZONE_ART_FALLBACK}';}" />
  <div class="zone-overlay" aria-hidden="true"></div>`;
}

window.ForeverLanZones = {
  ZONE_ART,
  ZONE_ART_FALLBACK,
  zoneArtUrl,
  zoneCardMediaHtml,
  // legacy helpers kept for any older callers
  zoneThumbUrl: zoneArtUrl,
  zoneThumbHtml: (zoneName) =>
    `<div class="zone-thumb-wrap">${zoneCardMediaHtml(zoneName)}</div>`,
};
