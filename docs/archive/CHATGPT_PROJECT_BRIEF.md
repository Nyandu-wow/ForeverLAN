# Forever LAN — ChatGPT project brief

**How to use this file:** Paste this whole document into a ChatGPT Project / custom GPT knowledge, or as the first message. When asking for help, say which layer you mean (`addon` / `collector` / `host` / `dashboard` / `friend pack`) and paste any relevant snippet. Prefer proposing changes that respect the **locks** below.

**Owner:** product host. **Repo:** local Forever LAN workspace (`FOREVER`).  
**Brief date:** 2026-09-30 · Addon version in tree: **0.1.38**

---

## 1. What this product is

**Forever LAN** is a **one-weekend, local LAN companion** for a World of Warcraft: **Forever** leveling party at a friend's house.

- the host PC = **host** (dashboard + event ingest).
- Friends install a zip (addon + silent agent). They play; telemetry flows to the host board.
- Product vibe: **ESPN race control + Strava personal stats + Mario Party chaos**, WoW flavor.
- **Not** a SaaS, not anti-cheat, not multi-weekend analytics, not cloud.

**Roster lock (unless the host changes it):** Alex · Sam · Jordan · Casey

---

## 2. Hard locks (do not violate)

| Lock | Meaning |
|------|---------|
| One weekend / one dataset | No multi-run history, accounts, cloud DB, persistent profiles |
| Rebuild from events | Prefer deriving views from `host-events.jsonl` over new persistence |
| Original timestamps | `ev.ts` = when it happened in-game; never rewrite to ingest time |
| Friday → Saturday catch-up | Friends may play before host is up; backlog drains first, then live |
| Discovery ≠ collection | Agent collects + queues offline; `/discover` only finds host for egress |
| Honesty labels | **Logged** (observed) / **Counted** (derived) / **Guessed** (inferred) — never present counted/guessed as raw logs |
| No invented WoW data | e.g. no XP/hour, no hidden power stats Forever blocks |
| Mid-weekend friend freeze | Friend addon + agent + `lanToken` stay FINAL once weekend starts; host/dashboard may still hot-update |
| Trust model | LAN party tool; each client syncs the character they play; combat log = enrichment, not a second identity |

---

## 3. Architecture (pipeline)

```text
WoW Forever client
  ├─ ForeverLAN addon → ForeverLANCharDB.pending (SavedVariablesPerCharacter)
  │     ForeverLANDB = account settings + legacy/migration leftovers
  │     flush to disk only on logout OR Push LAN → C_UI.Reload()
  └─ optional /combatlog → Logs/WoWCombatLog-*.txt (continuous)

        ↓
Local collector (friend agent or host PC)
  → durable outbox.jsonl (if host down)
  → POST /events (x-foreverlan-token)  [catch-up header when lagging]

        ↓
Host (Node) on the host PC :8765
  → data/host-events.jsonl (+ sqlite index)
  → LanSession rebuild sorted by ev.ts
  → GET /lan + SSE → dashboard (Live, Characters, Deaths, Explore, Timeline, Wrap, Professions)
```

**Critical WoW constraints (never assume otherwise):**

- Addons **cannot** HTTP / TCP.
- **No ForceSave** for SavedVariables — disk write only on logout or UI reload.
- `C_UI.Reload()` needs a **hardware gesture** (Push LAN button / keybind).
- `/combatlog` must be typed by the player (addon cannot enable LoggingCombat).
- Clipboard automation is blocked.

**Push LAN** = disk flush for the local collector (not a host send):

1. Snapshot CharDB `pending` → `ForeverLANCharDB.export`
2. **Keep pending** across reload (crash-safe until the collector has seen the SV)
3. `C_UI.Reload()` so WoW writes SavedVariables to disk (account + per-character)
4. Collector reads account + per-character SV → durable `outbox.jsonl` → `POST /events` when the host is up

The addon never knows whether the host received anything. Stable `event.id` + host `409` handle duplicates. Badge count resets via `last_flush_at` even though pending is retained.

Queue cap: **1500** pending; under pressure drops low-value types first; soft warn ~1200; full-cap reminder explains drops. Toggle: options → Push LAN reminders.

**Unavoidable loss:** events after the last SV disk write if WoW crashes before Push/logout/reload. Once the collector has the SV, the outbox is durable across host downtime.

---

## 4. Repo map (where code lives)

Working tree at the repo root (active):

| Path | Role |
|------|------|
| `addon/ForeverLAN/` | WoW addon (`ForeverLAN.lua` + `.toc`) — source of truth |
| `collector/` | Reads SV + combat log → outbox → POST host |
| `host/` | `server.js`, `lan-session.js`, analytics, SSE |
| `host/public/` | Dashboard HTML/CSS/JS |
| `friend-client/` | INSTALL.bat / Steam Deck agent packaging |
| `friend-pack/` | Addon copy bundled into friend zips |
| `scripts/` | `start-weekend.bat`, `restart-host.bat`, prepare zips, smoke tests |
| `data/` | Local run data (jsonl etc.; may point via config `dataDir`) |
| `CLIENT_CONTRACT.md` | **Frozen** HTTP ingest contract for friends |
| `CAPABILITY_MATRIX.md` | What Forever client APIs actually expose (VERIFIED vs UNAVAILABLE) |
| `DATA_COLLECTION.md` | Offline-first + timestamp rules |
| `HOSTING.md` | Weekend host runbook |
| `TRANSPORT.md` | Why Push LAN / combat log hybrid exists |
| `ROADMAP.md` | Phases / ops map (may lag status — prefer §5 below) |

**Dashboard pages (MVP accepted):** Live · Characters · Deaths · Explore · Timeline · Wrap  
**Also shipped:** dedicated **Professions** board (`professions.html`) — Profession Party.

Live = primary control-room (who’s ahead, catching up, just happened, dying, attention).  
Wrap = Hall of Shame/Fame **above the fold**.

---

## 5. Current status (2026-09-29)

| Area | Status |
|------|--------|
| MVP dashboard | **Accepted** |
| Telemetry pipeline | Working |
| Friday → Saturday catch-up | Working / design locked |
| Phase 4 friend pack / LAN hosting | **Active beta** — rebuild Windows + Steam Deck zips as code changes |
| Phase 3 storytelling | Deferred until after the LAN |
| CurseForge / LAN DNS productization | Parked |
| Profession Party Slice A | Shipped — `PLAYER_PROFESSIONS` → coverage / skill-ups / board awards |
| Profession Party Slice B | Shipped — auto `PLAYER_CRAFT` from self `CHAT_MSG_TRADESKILLS` (no craft button) |
| Gather professions telemetry | Not confirmed yet — do not invent |
| Addon | **0.1.38** — ForeverLANCharDB per-character queue; ForeverLANDB account/migration; conservative GUID/exact-identity migrate |
| Persistence hardening | Collector SV race-tolerant poll + outbox partial-line recovery + safe rewrite |

**Beta rule:** packs are rebuildable baselines, not a freeze. When friends already run a given zip, keep `CLIENT_CONTRACT.md` + `lanToken` stable unless you intentionally ship a new friend zip. Host/dashboard may change freely under that contract.

---

## 6. Frozen client contract (friend agents)

Do **not** break these without an intentional new friend zip (not mid-weekend):

- `POST /events` — JSON; requires `id` + `type`; auth `x-foreverlan-token` (or Bearer)
- Success: `201` created, `409` duplicate (= OK), `200` ignored smoke
- `ts` = unix seconds (original); host never rewrites
- Catch-up: header `x-foreverlan-mode: catch-up` **or** `ts` older than ~120s
- Unknown fields / unknown `type` → accept & store
- Body ≤ 1 MiB
- `GET /discover`, `GET /health` — extra keys OK
- **Same `lanToken` all weekend**

Safe mid-weekend: dashboard HTML/CSS/JS, host analytics/labels, new **derived** metrics from existing events, host restart (`restart-host.bat`).

Unsafe: change token, new required fields/headers, wipe live `host-events.jsonl`, redistributing zips with a new token.

---

## 7. Event honesty & important event types

**Logged (examples):** LOGIN/LOGOUT, level/ding, death/rez, zone/instance, distance/jumps, professions snapshots, quests/buffs/money, combat time, loot, combat-log death enrichment, `PLAYER_CRAFT`.

**Counted (examples):** pace/lead/comeback, session duration, corpse-run duration, death streaks, Hall awards, Profession Party board awards.

**Profession Party (host-derived, some `board_only`):** e.g. DOUBLE DIP, OPEN SEAT (coverage tiles), ONE-MAN INDUSTRY, THE FACTORY / CRAFTSMAN from craft volume — see `buildProfessionParty` in `host/lan-session.js`. Do not invent Forever-only commerce/campsite APIs.

When proposing metrics: check `CAPABILITY_MATRIX.md`. If status is UNAVAILABLE / UNVERIFIED, say so — do not fake it.

---

## 8. How the host runs things (ops)

**Host weekend:** firewall once → `scripts\start-weekend.bat` → confirm `/health` + `/discover` on port **8765**.  
**Friend zips:** `prepare-friend-zip.bat` / `prepare-steamdeck-zip.bat` → private send (token inside).  
**Hot host fix:** `restart-host.bat` — do not change token.  
**Backup / reset:** `backup-weekend-data.bat` / `reset-weekend-data.bat` (reset only when intentional, host stopped).

WoW Addon deploy path on the host machine (dev):  
`C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\ForeverLAN\`  
Copy from `addon/ForeverLAN/` then `/reload` in-game.

---

## 9. How ChatGPT should help

**Do:**

- Stay inside one-weekend LAN scope.
- Separate **addon** vs **collector** vs **host** vs **dashboard** advice.
- Label ideas Logged / Counted / Guessed.
- Prefer small, shippable diffs; cite files by path.
- Respect mid-weekend freeze for friends.
- When unsure about Forever APIs → probe / matrix first, never invent.

**Don’t:**

- Propose accounts, cloud analytics, WAN tunnels, multi-weekend history, Ace3 “because everyone uses it,” or ForceSave myths.
- Treat combat log as primary identity for players.
- Gate collection on host discovery.
- Expand CurseForge / LAN DNS unless the host asks.
- Paste huge speculative redesigns of the whole pipeline.

**When the host pastes a task:** ask (or infer) which layer; propose a minimal plan; then concrete file-level changes. If he wants code, write it in the style of existing `ForeverLAN.lua` / `lan-session.js` / public HTML.

---

## 10. Mini system prompt (optional paste)

```text
You are helping build Forever LAN: a one-weekend local LAN companion for WoW Forever. the host PC hosts the dashboard; friends run an addon + silent collector. One dataset, original event timestamps, Friday→Saturday offline catch-up. Discovery never gates collection. Honesty: Logged / Counted / Guessed. No SaaS, accounts, cloud DB, or invented WoW APIs. Mid-weekend: host/dashboard may change; friend addon + lanToken stay frozen. Pipeline: addon SV (+ optional combatlog) → collector outbox → POST /events → host jsonl → /lan SSE dashboard. Push LAN (or logout) flushes SavedVariables; there is no ForceSave. Prefer rebuilding views from events. Current focus: Phase 4 friend packs + host runbook; Profession Party Slice A/B shipped; gather telemetry not confirmed. Check CAPABILITY_MATRIX before claiming Forever can expose something.
```

---

## 11. Suggested first questions for ChatGPT

1. “Given CLIENT_CONTRACT, can I add field X to events without a new friend zip?”
2. “Design a Counted metric for Wrap from existing death events only.”
3. “Review this addon Lua for queue-cap reminder spam / combat safety.”
4. “Draft host-only dashboard copy for Profession Party without claiming gather data.”
5. “Weekend runbook checklist for the host before friends arrive Friday.”

---

## 12. Related docs to upload if ChatGPT supports multi-file knowledge

Priority order if you can attach more than this brief:

1. `CLIENT_CONTRACT.md`
2. `CAPABILITY_MATRIX.md`
3. `DATA_COLLECTION.md`
4. `HOSTING.md`
5. `TRANSPORT.md`
6. `.cursor/rules/forever-lan-brief.mdc` (same product identity as §1–2)
7. `.cursor/rules/forever-lan-status.mdc` (keep status in sync when it changes)

This single brief is enough to start; the others reduce hallucination on contracts and Forever API limits.
