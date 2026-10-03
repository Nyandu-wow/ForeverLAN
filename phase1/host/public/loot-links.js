/* Wowhead Forever item links from loot events. */

function slugifyItemName(name) {
  return String(name || "item")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

function itemIdFromLink(link) {
  if (link == null) return null;
  if (typeof link === "number" && Number.isFinite(link)) return Math.floor(link);
  const m = String(link).match(/item:(\d+)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function wowheadItemUrl(itemId, itemName) {
  const id = Number(itemId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const slug = slugifyItemName(itemName);
  return `https://www.wowhead.com/forever/item=${id}/${slug}`;
}

function lootLinkHtml(item, { className = "loot-link" } = {}) {
  if (!item) return "";
  const name = item.item_name || item.name || "item";
  const id = item.item_id || itemIdFromLink(item.item_link);
  const url = item.wowhead_url || wowheadItemUrl(id, name);
  const quality = item.item_quality || item.quality;
  const qClass = quality === 4 || quality === "epic" ? "epic" : quality === 3 || quality === "rare" ? "rare" : "";
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  if (!url) return `<span class="${esc(className)} ${qClass}">${esc(name)}</span>`;
  return `<a class="${esc(className)} ${qClass}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`;
}

window.ForeverLanLoot = { slugifyItemName, itemIdFromLink, wowheadItemUrl, lootLinkHtml };
