/**
 * Forever LAN Alliance / Horde theme switch (localStorage, all tabs).
 * Pair with early <html data-faction> boot snippet in each page <head>.
 */
(function () {
  const KEY = "forever-lan-faction";

  function normalize(v) {
    return v === "horde" ? "horde" : "alliance";
  }

  function current() {
    return normalize(document.documentElement.getAttribute("data-faction"));
  }

  function apply(faction) {
    const next = normalize(faction);
    document.documentElement.setAttribute("data-faction", next);
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {
      /* private mode */
    }
    syncButtons();
  }

  function syncButtons() {
    const f = current();
    document.querySelectorAll("[data-faction-btn]").forEach((btn) => {
      const on = btn.getAttribute("data-faction-btn") === f;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function mount() {
    if (document.getElementById("factionSwitch")) {
      syncButtons();
      return;
    }
    const nav = document.querySelector(".chrome .nav");
    const chrome = document.querySelector(".chrome");
    if (!nav && !chrome) return;

    const wrap = document.createElement("div");
    wrap.className = "faction-switch";
    wrap.id = "factionSwitch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Faction theme");
    wrap.innerHTML =
      '<button type="button" data-faction-btn="alliance" aria-pressed="false">ALLIANCE</button>' +
      '<button type="button" data-faction-btn="horde" aria-pressed="false">HORDE</button>';
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-faction-btn]");
      if (!btn) return;
      apply(btn.getAttribute("data-faction-btn"));
    });

    if (nav) nav.appendChild(wrap);
    else chrome.appendChild(wrap);
    syncButtons();
  }

  // Honor storage if boot snippet was missing.
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "horde" || stored === "alliance") {
      document.documentElement.setAttribute("data-faction", stored);
    } else if (!document.documentElement.getAttribute("data-faction")) {
      document.documentElement.setAttribute("data-faction", "alliance");
    }
  } catch (_) {
    if (!document.documentElement.getAttribute("data-faction")) {
      document.documentElement.setAttribute("data-faction", "alliance");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.ForeverFaction = { apply, current };
})();
