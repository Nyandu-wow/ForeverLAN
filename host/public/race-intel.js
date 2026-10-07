/* Race trajectory + weekend hall. Step stairs only — no curve loops. */
(function () {
  const CLASS = {
    PRIEST: "#f0ebe3",
    ROGUE: "#fff569",
    WARRIOR: "#c79c6e",
    MAGE: "#69ccf0",
    HUNTER: "#abd473",
    WARLOCK: "#9482c9",
    DRUID: "#ff7d0a",
    PALADIN: "#f58cba",
    SHAMAN: "#0070de",
  };

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function colorOf(cls) {
    return CLASS[String(cls || "").toUpperCase()] || "#e8c56a";
  }

  function clock(iso) {
    try {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return "";
      const tz = window.__foreverLanTz;
      const dayOpts = { weekday: "short" };
      const timeOpts = { hour12: false, hour: "2-digit", minute: "2-digit" };
      if (tz) {
        dayOpts.timeZone = tz;
        timeOpts.timeZone = tz;
      }
      const day = d.toLocaleDateString("en-GB", dayOpts);
      const time = d.toLocaleTimeString("en-GB", timeOpts);
      return `${day} ${time}`;
    } catch {
      return "";
    }
  }

  function axisLabel(ms, spanMs) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    const tz = window.__foreverLanTz;
    const dayOpts = { weekday: "short" };
    const timeOpts = { hour12: false, hour: "2-digit", minute: "2-digit" };
    if (tz) {
      dayOpts.timeZone = tz;
      timeOpts.timeZone = tz;
    }
    const day = d.toLocaleDateString("en-GB", dayOpts);
    const time = d.toLocaleTimeString("en-GB", timeOpts);
    if (spanMs > 36 * 60 * 60 * 1000) return `${day} ${time}`;
    if (spanMs > 3 * 60 * 60 * 1000) return time;
    return time;
  }

  /** Chron order + no level drops. Keeps hold segments (same level, later ts). */
  function sanitizePoints(raw) {
    const sorted = [...(raw || [])]
      .filter((p) => p?.ts && p.level > 0 && Number.isFinite(new Date(p.ts).getTime()))
      .sort((a, b) => new Date(a.ts) - new Date(b.ts) || a.level - b.level);
    const out = [];
    for (const p of sorted) {
      const t = new Date(p.ts).getTime();
      const last = out[out.length - 1];
      if (last) {
        if (t < new Date(last.ts).getTime()) continue;
        if (p.level < last.level) continue;
        if (p.level === last.level) {
          last.ts = p.ts;
          if (p.zone) last.zone = p.zone;
          continue;
        }
      }
      out.push({ ts: p.ts, level: p.level, zone: p.zone || null });
    }
    return out;
  }

  /**
   * Step-after stairs: hold level until the next ding, then jump up.
   * Time only ever moves right — no Catmull loops.
   */
  function stepStairs(pts, xOf, yOf) {
    if (!pts.length) return "";
    let x = xOf(pts[0].ts);
    let y = yOf(pts[0].level);
    let d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const nx = xOf(pts[i].ts);
      const ny = yOf(pts[i].level);
      // Skip zero-width H (same timestamp cluster) — vertical only.
      if (nx > x + 0.35) d += ` H${nx.toFixed(1)}`;
      if (Math.abs(ny - y) > 0.2) d += ` V${ny.toFixed(1)}`;
      x = Math.max(x, nx);
      y = ny;
    }
    return d;
  }

  function shortName(name) {
    const s = String(name || "").trim();
    if (!s) return "?";
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 8);
    return `${parts[0].slice(0, 6)} ${parts[parts.length - 1].slice(0, 1)}.`;
  }

  function renderTrajectory(root, trajectory, opts = {}) {
    if (!root) return;
    const levelCap = Math.max(1, Math.min(60, Number(opts.levelCap) || 60));
    const series = (trajectory && trajectory.series) || [];
    const markers = (trajectory && trajectory.markers) || [];
    const prepared = series
      .map((s) => ({
        character: s.character,
        class: s.class,
        points: sanitizePoints(s.points),
      }))
      .filter((s) => s.points.length);
    if (!prepared.length) {
      root.innerHTML = '<div class="empty">The race line appears after the first dings.</div>';
      return;
    }

    // Race standings order for legend + end caps (current tip level).
    prepared.sort((a, b) => {
      const la = a.points[a.points.length - 1].level;
      const lb = b.points[b.points.length - 1].level;
      if (lb !== la) return lb - la;
      return String(a.character).localeCompare(String(b.character));
    });

    let minT = Infinity;
    let maxT = -Infinity;
    let minL = Infinity;
    let maxL = -Infinity;
    const domain = trajectory && trajectory.domain;
    // Only trust domain when from < to (pre-LAN beta used to ship inverted windows).
    let domainFromMs = NaN;
    let domainToMs = NaN;
    if (domain?.from && domain?.to) {
      domainFromMs = new Date(domain.from).getTime();
      domainToMs = new Date(domain.to).getTime();
      if (Number.isFinite(domainFromMs) && Number.isFinite(domainToMs) && domainFromMs < domainToMs) {
        minT = domainFromMs;
        maxT = domainToMs;
      } else {
        domainFromMs = NaN;
        domainToMs = NaN;
      }
    } else {
      if (domain?.from) {
        const t = new Date(domain.from).getTime();
        if (Number.isFinite(t)) minT = t;
      }
      if (domain?.to) {
        const t = new Date(domain.to).getTime();
        if (Number.isFinite(t)) maxT = t;
      }
    }
    for (const s of prepared) {
      for (const p of s.points) {
        const t = new Date(p.ts).getTime();
        if (!Number.isFinite(t)) continue;
        // When a valid domain is set, ignore ancient outliers left of the window.
        if (Number.isFinite(domainFromMs) && t < domainFromMs - 60 * 1000) continue;
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
        minL = Math.min(minL, p.level);
        maxL = Math.max(maxL, p.level);
      }
    }
    if (!Number.isFinite(minT) || minT === Infinity) {
      root.innerHTML = '<div class="empty">The race line appears after the first dings.</div>';
      return;
    }
    if (!Number.isFinite(maxT) || maxT === -Infinity) maxT = minT;
    if (maxT <= minT) maxT = minT + 60 * 60 * 1000;
    // Useful level band (1 → at least leader+2, goal hint at weekend cap).
    minL = Math.max(1, Math.floor(minL) - 1);
    maxL = Math.max(maxL + 1, minL + 4);
    const showGoal = maxL < levelCap;
    if (showGoal) maxL = Math.min(levelCap, Math.max(maxL, Math.ceil(maxL / 5) * 5));

    const W = 1000;
    const H = 280;
    const pad = { l: 44, r: 56, t: 18, b: 38 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const spanMs = maxT - minT;
    const xOf = (ts) => {
      const t = new Date(ts).getTime();
      const clamped = Math.min(maxT, Math.max(minT, t));
      return pad.l + ((clamped - minT) / spanMs) * plotW;
    };
    const yOf = (level) => pad.t + (1 - (level - minL) / (maxL - minL)) * plotH;

    const yTicks = [];
    const yStep = maxL - minL > 24 ? 10 : maxL - minL > 10 ? 5 : 1;
    for (let lvl = Math.ceil(minL / yStep) * yStep; lvl <= maxL; lvl += yStep) {
      yTicks.push(lvl);
    }

    const xTicks = [];
    const tickCount = spanMs > 48 * 3600 * 1000 ? 6 : 5;
    for (let i = 0; i < tickCount; i++) {
      xTicks.push(minT + (spanMs * i) / (tickCount - 1));
    }

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Level over time — race stairs">`;
    svg += `<defs>
      <filter id="trajGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.6" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

    // Plot well
    svg += `<rect class="traj-well" x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" />`;

    for (const lvl of yTicks) {
      const y = yOf(lvl);
      svg += `<line class="traj-grid" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" />`;
      svg += `<text class="traj-axis" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${Math.round(lvl)}</text>`;
    }

    for (const t of xTicks) {
      const x = xOf(t);
      svg += `<line class="traj-grid-v" x1="${x}" y1="${pad.t}" x2="${x}" y2="${H - pad.b}" />`;
      svg += `<text class="traj-axis" x="${x}" y="${H - 12}" text-anchor="middle">${esc(axisLabel(t, spanMs))}</text>`;
    }

    // Finish / goal line
    if (showGoal || maxL >= levelCap) {
      const goalY = yOf(Math.min(levelCap, maxL));
      svg += `<line class="traj-goal" x1="${pad.l}" y1="${goalY}" x2="${W - pad.r}" y2="${goalY}" />`;
      svg += `<text class="traj-goal-label" x="${W - pad.r + 6}" y="${goalY + 4}">${levelCap}</text>`;
    }

    const hit = [];
    // Draw trailing pack first so the leader paints on top.
    const drawOrder = [...prepared].reverse();
    for (const s of drawOrder) {
      const col = colorOf(s.class);
      const pts = s.points;
      if (!pts.length) continue;
      const d = stepStairs(pts, xOf, yOf);
      svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter" opacity="0.22" />`;
      svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" filter="url(#trajGlow)" opacity="0.98" />`;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const prev = pts[i - 1];
        const isDing = !prev || prev.level !== p.level;
        const isEnd = i === pts.length - 1;
        if (!isDing && !isEnd) continue;
        const x = xOf(p.ts);
        const y = yOf(p.level);
        if (isDing && !isEnd) {
          svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${col}" stroke="rgba(0,0,0,0.65)" stroke-width="1" />`;
        }
        hit.push({
          x,
          y,
          character: s.character,
          class: s.class,
          level: p.level,
          zone: p.zone,
          ts: p.ts,
          marker: null,
        });
      }
    }

    // End caps: place badge at current tip (leader #1 on top of stack).
    const endLabels = [];
    prepared.forEach((s, placeIdx) => {
      const tip = s.points[s.points.length - 1];
      if (!tip) return;
      const col = colorOf(s.class);
      const x = xOf(tip.ts);
      const y = yOf(tip.level);
      const place = placeIdx + 1;
      const r = place === 1 ? 11 : 9;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${col}" stroke="rgba(0,0,0,0.7)" stroke-width="1.4" />`;
      svg += `<text class="traj-place" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${place}</text>`;
      endLabels.push({ x: x + r + 5, y: y + 4, text: shortName(s.character) });
    });
    // Tips at the same level/time would print names on top of each other — stack them.
    const LABEL_GAP = 13;
    endLabels.sort((a, b) => a.y - b.y || a.x - b.x);
    for (let i = 1; i < endLabels.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = endLabels[j];
        const b = endLabels[i];
        if (Math.abs(a.x - b.x) < 150 && b.y - a.y < LABEL_GAP) b.y = a.y + LABEL_GAP;
      }
    }
    for (const l of endLabels) {
      const y = Math.min(H - 4, l.y);
      svg += `<text class="traj-end-name" x="${l.x.toFixed(1)}" y="${y.toFixed(1)}">${esc(l.text)}</text>`;
    }

    for (const m of markers) {
      const x = xOf(m.ts);
      const y = yOf(m.level);
      svg += `<polygon points="${x},${y - 8} ${x + 6.5},${y} ${x},${y + 8} ${x - 6.5},${y}" fill="none" stroke="var(--gold, #e8c56a)" stroke-width="1.5" />`;
      const near = hit.find(
        (h) => h.character === m.character && Math.abs(new Date(h.ts) - new Date(m.ts)) < 2000
      );
      if (near) near.marker = m.label;
      else {
        hit.push({
          x,
          y,
          character: m.character,
          level: m.level,
          zone: null,
          ts: m.ts,
          marker: m.label,
        });
      }
    }

    svg += `</svg>`;

    const legend = prepared
      .map((s, i) => {
        const tip = s.points[s.points.length - 1];
        return `<span class="lg${i === 0 ? " lead" : ""}"><b>${i + 1}</b><i style="background:${colorOf(s.class)}"></i><em>${esc(
          s.character
        )}</em><span class="lv">L${esc(tip.level)}</span></span>`;
      })
      .join("");

    root.innerHTML = `<div class="traj-legend">${legend}</div><div class="traj-plot">${svg}<div class="traj-tip" hidden></div></div>`;

    const plot = root.querySelector(".traj-plot");
    const tip = root.querySelector(".traj-tip");
    const svgEl = root.querySelector("svg");

    function clientToSvg(clientX, clientY) {
      const ctm = svgEl.getScreenCTM();
      if (!ctm) return null;
      const pt = svgEl.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      return pt.matrixTransform(ctm.inverse());
    }

    function svgToPlot(x, y) {
      const ctm = svgEl.getScreenCTM();
      if (!ctm) return null;
      const pt = svgEl.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const screen = pt.matrixTransform(ctm);
      const plotRect = plot.getBoundingClientRect();
      return { left: screen.x - plotRect.left, top: screen.y - plotRect.top };
    }

    plot.addEventListener("mousemove", (e) => {
      const local = clientToSvg(e.clientX, e.clientY);
      if (!local) {
        tip.hidden = true;
        return;
      }
      let best = null;
      let bestD = 40;
      for (const h of hit) {
        const dist = Math.hypot(h.x - local.x, h.y - local.y);
        if (dist < bestD) {
          best = h;
          bestD = dist;
        }
      }
      if (!best) {
        tip.hidden = true;
        return;
      }
      tip.hidden = false;
      const zone = best.zone ? `<div>${esc(best.zone)}</div>` : "";
      const mark = best.marker ? `<div class="mk">${esc(best.marker)}</div>` : "";
      tip.innerHTML = `<div class="who">${esc(best.character)} · L${esc(best.level)}</div><div>${esc(
        clock(best.ts)
      )}</div>${zone}${mark}`;
      const pos = svgToPlot(best.x, best.y);
      if (!pos) {
        tip.hidden = true;
        return;
      }
      const tipW = tip.offsetWidth || 120;
      const tipH = tip.offsetHeight || 48;
      const plotWpx = plot.clientWidth;
      let left = pos.left;
      let top = pos.top - 10;
      left = Math.min(plotWpx - tipW / 2 - 4, Math.max(tipW / 2 + 4, left));
      top = Math.max(tipH + 4, top);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });
    plot.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  }

  function renderHall(root, hall) {
    if (!root) return;
    const list = hall || [];
    if (!list.length) {
      root.innerHTML = '<div class="empty">Weekend trophies appear once the race has a story.</div>';
      return;
    }
    root.innerHTML = list
      .map((a, idx) => {
        const levels = (a.levels || [])
          .map(
            (f) =>
              `<span class="lvl" title="${esc(f.character)}">${esc(f.level)} ${esc(
                String(f.character || "")
              )}</span>`
          )
          .join("");
        const honesty = a.honesty
          ? `<div class="h">${esc(honestyChip(a.honesty))}</div>`
          : "";
        const hasEv = a.evidence && (a.evidence.observed?.length || a.evidence.derived?.length);
        const btn = hasEv
          ? `<button type="button" class="ev-btn" data-ev-idx="${idx}">Evidence</button>`
          : "";
        return `<div class="award${a.shame ? " shame" : ""}" data-award-idx="${idx}"><div class="t">${esc(
          a.title
        )}</div>${
          a.flavour ? `<div class="f">${esc(a.flavour)}</div>` : ""
        }<div class="d">${esc(a.detail || "")}</div>${honesty}${
          levels ? `<div class="lvls">${levels}</div>` : ""
        }${btn}<div class="ev-panel" hidden></div></div>`;
      })
      .join("");

    root.querySelectorAll(".ev-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-ev-idx"));
        const a = list[idx];
        const card = btn.closest(".award");
        const panel = card?.querySelector(".ev-panel");
        if (!panel || !a?.evidence) return;
        if (!panel.hidden) {
          panel.hidden = true;
          panel.innerHTML = "";
          btn.textContent = "Evidence";
          return;
        }
        const bits = [];
        if (a.evidence.observed?.length) {
          bits.push(`<div class="ev-h">LOGGED</div>`);
          for (const row of a.evidence.observed) {
            bits.push(`<div class="ev-row"><span>${esc(row.label)}</span><b>${esc(String(row.value ?? "—"))}</b></div>`);
          }
        }
        if (a.evidence.derived?.length) {
          bits.push(`<div class="ev-h">COUNTED</div>`);
          for (const row of a.evidence.derived) {
            bits.push(
              `<div class="ev-row"><span>${esc(row.label)}</span><b>${esc(String(row.value ?? "—"))}</b>${
                row.formula ? `<div class="ev-f">${esc(row.formula)}</div>` : ""
              }</div>`
            );
          }
        }
        panel.innerHTML = bits.join("");
        panel.hidden = false;
        btn.textContent = "Hide";
      });
    });
  }

  function honestyLabel(raw) {
    const k = String(raw || "")
      .trim()
      .toLowerCase();
    if (k === "observed") return "Logged";
    if (k === "derived") return "Counted";
    if (k === "inferred") return "Guessed";
    if (!k) return "";
    return String(raw);
  }

  function honestyChip(raw) {
    const label = honestyLabel(raw);
    return label ? label.toUpperCase() : "";
  }

  window.ForeverLanIntel = { renderTrajectory, renderHall, honestyLabel, honestyChip };
})();
