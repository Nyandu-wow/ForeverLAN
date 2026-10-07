# Forever LAN — Roadmap

**Single source of truth** for product phases, weekend operations, and scope. Implementation details live in linked docs — this file is the map, not the design dump.

Forever LAN is a **local, self-hosted** leveling-LAN companion for **one WoW: Forever weekend** — ESPN / race control for the party, not a cloud analytics SaaS.

SaaS-style UI patterns are fine when they help. Architecture stays on the LAN host.

**Build order:** finish the **dashboard MVP** first. Friend install package + hosting distribution come **after** MVP (Phase 4 parked).

**Client model (later):** friends get a one-click install (addon + silent agent → host). Scaffolding exists under `friend-client/` but is frozen until MVP is accepted.

| Doc | Role |
|-----|------|
| [`DATA_COLLECTION.md`](DATA_COLLECTION.md) | Offline-first pipeline, timestamps, catch-up |
| [`HOSTING.md`](HOSTING.md) | LAN host notes (parked packaging) |
| [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) | What the Forever client actually exposes |
| [`docs/archive/PHASE0_TELEMETRY_REPORT.md`](docs/archive/PHASE0_TELEMETRY_REPORT.md) | Phase 0 probe report (archive) |
| [`docs/archive/PHASE1.md`](docs/archive/PHASE1.md) | Historical spike notes (archive) |

Working tree: `addon`, `collector`, `host` (active). `friend-client` parked.

---

## Scope lock

- One LAN weekend · one dataset · one event log
- Roster allowlist only (`config.json` → `lanRoster`)
- No multi-run history · no cloud database · no public WAN
- Offline-first · original game event timestamps preserved
- Honest observed vs inferred data · keep it simple
- **MVP first** — no packaging/hosting expansion until the dashboard MVP is done

---

## Weekend operating model

This is a first-class requirement for the real event.

### Who runs what

```text
Each friend PC                            the host PC (LAN host)
─────────────────                         ───────────────────────
Double-click INSTALL.bat (once)
  ├─ ForeverLAN addon → WoW AddOns
  └─ silent agent (Startup)               node host/server.js
       └─ finds host on LAN                 ← POST /events (token)
       └─ SV + combat log → push            UDP beacon + GET /discover
                                            foreverlan.sqlite / jsonl
                                            Live / Wrap / SSE
```

- **Friends:** unzip → `INSTALL.bat` → enable addon. No terminals, no websites, no JSON editing.
- **the host:** `node scripts/prepare-friend-pack.mjs` → zip `dist/ForeverLAN-Friends` → send privately (contains token).
- **One host** gathers everyone’s events into **one** weekend log.
- Friends may open the dashboard in a browser if they want; they are not required to for data collection.

### Friday

- Players can play **before** the Forever LAN host/dashboard is online.
- Each friend’s addon queues events locally (`ForeverLANDB` SavedVariables).
- The silent agent (if already installed) buffers to local outbox when the host is unreachable.
- Data survives WoW reload/logout (after SV write), PC restart (if SV was written), and temporary host/network absence.
- Original occurrence time stays on the event (`ev.ts` from addon `time()` or combat-log line clock).
- **Push LAN** (or logout) is required for SavedVariables to hit disk — there is no ForceSave API.

### Saturday

- Start the Forever LAN **host** on the host PC (firewall open; beacon + `/discover` on).
- Friend agents discover the host and drain outboxes as **catch-up**; Friday stamps stay Friday.
- Live collection continues afterward (`ingest_mode: live`).
- Board, trajectory, Wrap clocks use **event time**, not ingest time.

### After the weekend

- The **same single dataset** feeds Wrap / any Phase 3 chapters / replay.
- No multi-run database. No splitting the weekend into separate “runs.”

### Host reachability (for agents)

| Piece | State |
|-------|--------|
| `POST /events` + token | Delivered |
| `GET /discover` + UDP LAN beacon | Delivered |
| Friend agent auto-find (beacon → subnet scan) | Delivered |
| Host firewall TCP 8765 Private | **Done** |
| Optional fixed `hostUrl` in party.json | Supported via `friendHostUrl` in config when preparing pack |

Cloudflare public tunnel remains **out of product scope**.

### Catch-up caveat (honest)

- **Addon SavedVariables + each friend’s agent outbox** are the reliable Friday→Saturday path.
- Combat-log **historical** replay is limited: if an agent first opens a combat-log file larger than ~256KB, it tails from EOF and does **not** backfill the whole file. Prefer `/combatlog` while the agent is running, or rely on addon death/zone events after Push/logout.

---

## Non-goals / product rules

Do not regress these (including in future Cursor prompts):

| Rule | Meaning |
|------|---------|
| One weekend, one log | No run ids, no History nav, no scattered datasets |
| LAN only | No cloud DB, no automatic Internet upload, no public inbound ports / port forwarding |
| No public tunnel as product | Cloudflare Tunnel docs may exist; do **not** expand them as the intended model |
| Offline-first | Dashboard down must not erase Friday play |
| Timestamp honesty | `ev.ts` authoritative; ingest time is ops-only |
| Data honesty | Label derived metrics; never invent death causes, skill scores, or unobserved facts |
| No XP/hour | Forever does not expose usable XP progress for this product |
| No generic skill score | Pace/sessions are approximate and labeled |
| Roster noise off | Non-allowlist characters stay off Live / Characters |
| No big platform before the weekend | Only event-critical fixes pre-event |

---

## Definition of success for the weekend

Success means all of the following that the repo already supports:

1. All **four** roster characters appear on Live from **their own** clients pushing (Alex, Sam, Jordan, Casey — extend via `lanRoster`).
2. Each friend used plug-and-play install; host receives their `POST /events`.
3. Friday events survive until Saturday ingest (SV write + per-friend outbox).
4. Catch-up keeps **original** timestamps on the board / trajectory / Wrap.
5. Live events continue after catch-up without wiping earlier data.
6. Duplicate event `id`s are ignored (HTTP 409) — re-Push / re-drain is safe.
7. Dashboard stays usable during play (Live glanceable; Characters / Timeline / Wrap for drilldown).
8. Host is reachable on the **LAN** for friend agents (auto-discover or IP) — no public Internet required.
9. Wrap can summarize what was actually recorded (race, hall, compact weekend story).
10. Raw event log remains on disk (`host-events.jsonl` + sqlite) for Phase 3.
11. Friends never needed a manual CMD / config tutorial to contribute data.

---

## Phase 0 — Forever client probes

**Status:** Complete (baseline)

**Purpose:** Establish what the WoW: Forever beta client actually exposes before building product assumptions.

**Delivered:** Probe report and ongoing capability tracking.

**Remaining:** Re-check after client patches when something product-critical looks broken (see matrix).

**Definition of Done:** Install paths, combat-log / WTF layout, and “what we can prove” are documented; product work does not invent unavailable APIs.

**Out of scope:** Full capability matrix copy-paste here — use [`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) and [`docs/archive/PHASE0_TELEMETRY_REPORT.md`](docs/archive/PHASE0_TELEMETRY_REPORT.md).

---

## Phase 1 — Telemetry pipeline

**Status:** Complete (operational pipeline)

**Purpose:** Offline-first path from game → durable local store → host APIs.

**Delivered / remaining**

| Piece | State |
|-------|--------|
| Addon ForeverLAN `0.1.12` (`addon`) | Delivered — SV pending, Push LAN / logout flush |
| Collector — SV poll, combat-log tail, `outbox.jsonl` | Delivered |
| Optional clipboard poll | Code still present; Forever blocks `CopyToClipboard` — **not** the primary path |
| Host `POST /events` → `host-events.jsonl` + `foreverlan.sqlite` | Delivered |
| LIVE vs CATCH-UP (`X-ForeverLAN-Mode` / lag) | Delivered |
| Idempotent event `id` (duplicate → 409) | Delivered |
| Multi-collector → one host | Delivered in code — collectors POST with the shared `lanToken` |
| Session board `/lan` + SSE `/stream` | Delivered |
| Friend plug-and-play agent + LAN auto-discover | Delivered — persistent rediscover + collector respawn ([`friend-client/`](friend-client/)) |

**Definition of Done (operational):**

- Events can accumulate on each friend PC while the host is down and drain later.
- Ingest never replaces `ev.ts` with receive time.
- Catch-up rebuild sorts by original `ev.ts`.
- Re-sending the same event id does not duplicate rows.
- Multiple collectors can push into one weekend log.
- Operator can run host + collector from the repo root per [`DATA_COLLECTION.md`](DATA_COLLECTION.md).

**Out of scope:** Cloud sync, multi-host clustering, inventing XP or death causes the client does not provide.

---

## Phase 2 — LAN dashboard (single weekend)

**Status:** Mostly complete — enough for the weekend; polish only if event-critical

**Purpose:** Glanceable overview (who, levels, who is ahead, what changed, what was funny), then drilldown. One dataset.

**Delivered**

| Area | Evidence in repo |
|------|------------------|
| Nav | Live · Characters · Timeline · Zones · Deaths · Wrap (`party.html`, `explore.html`, `wrap.html`) |
| Live board | Levels, race cards, since-you-last-looked, hall teaser |
| Race trajectory | Y = level, X = time, smooth curves (`race-intel.js`) |
| Characters | 360 KPIs, derived pace/sessions (labeled), comparison, zone table, deaths |
| Observed activity | Professions, distance, maps, class-aware AP/SP from each friend’s self telemetry |
| Timeline | Bucketed timeline API + UI |
| Wrap | KPI strip; race + highlights \| Hall of Shame in first viewport; trajectory; compact weekend story |
| Roster filter | `lanRoster` on host APIs / session |
| Pages | `/` · `/characters` · `/timeline` · `/zones` · `/deaths` · `/wrap` (+ legacy path aliases to explore) |
| Zones | Weekend heatmap: hottest = most roster visitors, then event volume (no exact coords) |

**Remaining**

| Kind | Item |
|------|------|
| Event-critical polish | Clarity on Live / Characters / Timeline / Wrap during playtests |
| Optional polish | Continent Azeroth art map (won't do without honest projection) |
| Parked until after MVP | Friend install package, hosting distribution, CurseForge |
| Explicitly not remaining | Multi-run History UI · separate snapshot datastore · fabricated XP/hour |

**Definition of Done:**

- Live overview works for the allowlisted roster
- Trajectory shows level over **time**
- Characters / Timeline / Wrap work on the single log
- Hall of Shame is visible without burying it under long scroll
- Catch-up data keeps original event timestamps on the board
- Derived pace/sessions labeled; no skill score; class-aware power display
- No History / multi-run browser

**Out of scope:** New analytics platforms, pairing UI, run clustering, public SaaS dashboards.

---

## Phase 3 — End-of-weekend storytelling

**Status:** Deferred until after the real weekend (Wrap already has a compact derived story)

**Purpose:** Interpretation layer over the **existing** weekend event log — chapters and lightweight replay, not a second database.

**Delivered / remaining**

| Item | State |
|------|--------|
| Compact Wrap “weekend story” + hall / race | Exists today (derived from session) |
| Generated opening / midgame / drama / finish chapters | Not built |
| Lightweight replay UI over the weekend timeline | Not built |
| Zone map visualization | Not built |
| Multi-run / historical weekend DB | **Won’t do** |

**Definition of Done:**

- Chronology reconstructs from the recorded event log alone (jsonl / sqlite) — no second source required
- Replay / chapters use **original** event timestamps
- Narrative only states facts derivable from recorded events
- No implied causes the telemetry did not establish
- Still one dataset

**Out of scope:** Multi-run history, inventing drama the log does not support.

---

## Priority lock (current)

**MVP dashboard accepted.** **Beta development mode** — do not freeze.

Priorities: (1) real-world reliability stress + fixes, (2) Forever telemetry discovery (no invented APIs),
(3) dashboard flavour / live usefulness, (4) awards from real telemetry, (5) rebuild friend packs as code changes.

Phase 4 packs remain active beta artifacts (rebuild anytime). CurseForge / public LAN DNS still optional/parked.
Phase 3 storytelling chapters stay deferred until after the real weekend (board humour OK now).

---

## Phase 4 — Package & LAN hosting

**Status:** Active

**Purpose:** Friends install once (zip → INSTALL.bat); host is easy to run on the LAN without public exposure.

**In tree:** `friend-client/`, `scripts/prepare-friend-pack.mjs`, firewall/beacon/discover, ops bats. See [`HOSTING.md`](HOSTING.md).

**Out of scope for now:** CurseForge listing, Cloudflare Tunnel, public DNS productization.

---

## Weekend runbook

- **Start:** Desktop **Forever LAN** (or `scripts\start-weekend.bat`)
- **Board:** http://127.0.0.1:8765/
- **Firewall (once, Admin):** `scripts\open-lan-firewall.bat`
- **Friend zip (Windows):** `scripts\prepare-friend-zip.bat` → `dist\ForeverLAN-Friends.zip`
- **Steam Deck zip:** `scripts\prepare-steamdeck-zip.bat` → `dist\ForeverLAN-SteamDeck.zip`
- **Compat (after host change):** `node scripts/smoke-host-compat.mjs`
- **Hot-update host mid-weekend:** `scripts\restart-host.bat` — keep `lanToken` + [`CLIENT_CONTRACT.md`](CLIENT_CONTRACT.md); addon stays FINAL
- **Backup:** `scripts\backup-weekend-data.bat`
- **Reset** (before the real weekend, host stopped): `scripts\reset-weekend-data.bat`

---

## Suggested next slices

### Now (Phase 4)

1. Friend INSTALL pack rebuild + host runbook paths — done (`dist\ForeverLAN-Friends.zip`).
2. Host ingest logging (`dataDir\ingest.log`) + `scripts\weekend-status.bat` — done.
3. Discovery hardening (P0 config-only host URL; P1 IPv4 family; P2 beacon port) — done.
4. Steam Deck pack (Unix ZIP paths, LF shell, bundled Node, Games/Forever detect) — done (`ForeverLAN-SteamDeck.zip`).
5. Frozen client contract + mid-weekend host updates — done (`CLIENT_CONTRACT.md`, `restart-host.bat`, `smoke-host-compat.mjs`).
6. Host pipeline stress (6–8 friends) — done (`scripts\stress-host-pipeline.mjs`).
7. Host firewall once (Admin): `scripts\open-lan-firewall.bat` — run on the host PC.
8. Before real LAN: reset practice/loadtest data (`reset-weekend-data.bat`), then freeze addon zips + token.
9. Friend dry-run — Deck path exercised; Windows INSTALL dry-run still open if a Windows friend joins.
10. Optional later: CurseForge / LAN DNS if still wanted.

### Done (MVP dashboard)

1–11. Characters, Timeline, Live/Wrap clarity, Deaths, Zones heatmap, playtest resilience/clarity, reset/backup, Alliance wallpaper + logo, event-age honesty — done.
12. the host accepts MVP → Phase 4 unlocked.

### After the LAN

1. Phase 3 chapters / replay (optional).
2. CurseForge / LAN DNS polish if still wanted.
