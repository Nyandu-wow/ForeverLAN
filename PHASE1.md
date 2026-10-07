# Forever LAN — Phase 1 Telemetry Spike

> **Historical.** Product phases and current status live in [`../ROADMAP.md`](../ROADMAP.md). This file describes the original spike (clipboard egress, “no dashboard yet”) and is largely outdated.

Prove one end-to-end pipeline on the real Forever beta client (`_classic_beta_` / `WowB.exe`).

**Not included (at the time of this spike):** dashboard product UI, milestones, LAN statistics, beamer mode, SQLite product schema.

## Pipeline

```text
WoW Forever (_classic_beta_)
  ├─ Companion addon ForeverLAN
  │    ├─ LoggingCombat(true) on login
  │    ├─ LOGIN / LEVEL_UP / ZONE / DEATH / LOGOUT events
  │    └─ Live egress: clipboard batch  FOREVERLAN_CLIP|{json}
  ├─ Logs\WoWCombatLog.txt   (auto-enabled by addon)
  └─ (optional) Logs\WoWChatLog.txt  — discovery only; historically not live

Local collector (this PC)
  ├─ Polls clipboard for addon events
  ├─ Tails combat log
  ├─ Durable outbox (data/outbox.jsonl) with event-id idempotency
  └─ HTTP POST → host /events

Host / test viewer
  └─ http://127.0.0.1:8765/  (SSE live feed)
```

### Why clipboard?

WoW addons cannot write arbitrary files. Chat logs historically flush on logout. Combat logs are live but **do not contain level-ups**. For Phase 1 live level/login telemetry, the addon batches recent events onto the clipboard; the collector polls and dedupes by `event.id`.

Side effect: ForeverLAN overwrites the clipboard every ~0.35s while pending events exist. Fine for a spike; not final product UX.

## Install the addon

Source of truth in the repo:

`addon/ForeverLAN/`

Installed into the Forever beta client:

`C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\ForeverLAN\`

Copy/update:

```powershell
Copy-Item -Recurse -Force `
  "E:\OneDrive\Private\Cursor\FOREVER\addon\ForeverLAN" `
  "C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\ForeverLAN"
```

In-game:

1. At character select, open **AddOns**.
2. Enable **Forever LAN**.
3. If it shows out-of-date, enable **Load out of date AddOns** (Interface version may still be settling on beta).
4. Enter world. You should see a combat-log status note (ON, or a reminder to type `/combatlog`). LOGIN breadcrumb appears in chat.
5. Optional: `/foreverlan status` and `/foreverlan ping`.

## Configure the collector

Edit `config.json`:

| Key | Meaning |
|-----|---------|
| `wowRoot` | Parent install, e.g. `C:\Games\FOREVER\World of Warcraft` |
| `clientFolder` | `_classic_beta_` |
| `hostUrl` | Where to POST events (`http://127.0.0.1:8765`) |
| `listenHost` / `listenPort` | Host bind (default `0.0.0.0:8765`) |

Overrides:

- `FOREVERLAN_WOW_CLIENT` — full path to `_classic_beta_`
- `FOREVERLAN_CONFIG` — alternate config JSON path

The collector discovers the client by looking for `WowB.exe` / `Wow.exe`.

## Start host + collector

From the repo root:

```powershell
# Terminal A — test viewer / ingest endpoint
node host/server.js

# Terminal B — local collector
node collector/index.js
```

Open: [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

LAN check from another device: `http://<this-pc-lan-ip>:8765/` (host listens on `0.0.0.0`).

## How to test (in Forever)

1. Start host + collector.
2. Launch **WoW Forever** beta, enable addon, enter world.
3. Confirm viewer shows `LOGIN` with name / class / level.
4. Level up once → expect `LEVEL_UP`.
5. Die once → expect addon `DEATH` and, if combat logging is writing, combat-log death lines.
6. Enter an instance / change zone → addon `ZONE` and possibly combat-log `ZONE_CHANGE`.
7. Quit WoW → addon `LOGOUT` (best-effort via clipboard) and/or `WOW_PROCESS_STOP`.
8. Restart collector while playing → outbox + event ids should not duplicate on the host.
9. Stop host briefly, generate a `/foreverlan ping`, restart host → queued outbox events should flush.

### Offline smoke (no Forever session)

With host + collector already running:

```powershell
node scripts/smoke-simulate.js
```

This plants a clipboard LOGIN/LEVEL_UP batch and appends sample combat-log lines under the beta `Logs` folder.

## Reliability behavior

| Concern | Behavior |
|---------|----------|
| WoW closed/reopened | Process watcher emits start/stop; new LOGIN on next enter world |
| Collector restart | Clipboard batch still holds recent pending events; seen-id state in `data/collector-state.json`; outbox replay-safe |
| Host down | Collector keeps `data/outbox.jsonl`, retries POST |
| Duplicates | Stable `event.id`; host returns 409 and ignores duplicates |

## What Phase 1 detected

### Proven on this machine (2026-09-20 smoke — no Forever login yet)

| Piece | Result |
|-------|--------|
| Client path discovery (`_classic_beta_` / `WowB.exe` 1.60.1.70170) | **Yes** (updated 2026-10-02) |
| Addon installed under `Interface\AddOns\ForeverLAN` | **Yes** |
| Auto `LoggingCombat(true)` | **Blocked / removed** — protected on Forever; use `/combatlog` manually |
| Clipboard LOGIN/LEVEL_UP → collector outbox → HTTP host → viewer | **Yes** (`smoke-simulate.js`) |
| Combat log append while collector runs (tail) | **Yes** (synthetic `WoWCombatLog.txt`) |
| Parse `COMBAT_LOG_VERSION` / `ZONE_CHANGE` / `UNIT_DIED` / `PARTY_KILL` | **Yes** (synthetic lines) |
| Idempotent POST (duplicate `event.id` → HTTP 409, no extra row) | **Yes** |

Host/collector were left running for manual Forever validation: `http://127.0.0.1:8765/`

### In-game Forever beta (only mark after real play)

Per Phase 1 rules: **do not mark supported until observed in the live beta client.**

| Event | Detected? | Source | Reliability |
|------|-----------|--------|-------------|
| Login | **Not yet tested in-game** | Addon → clipboard (`PLAYER_ENTERING_WORLD`) | Pipeline ready; needs Forever session |
| Logout | **Not yet tested in-game** | Addon `PLAYER_LOGOUT` + process stop | Pipeline ready; needs Forever session |
| Level | **Not yet tested in-game** | Addon snapshot (`UnitLevel` / class / race / realm) | Pipeline ready; needs Forever session |
| Level-up | **Not yet tested in-game** | Addon `PLAYER_LEVEL_UP` | Pipeline ready; needs Forever session |
| Death | **Synthetic only** | Combat log `UNIT_DIED` (+ addon `PLAYER_DEAD` untested) | Parser works on sample; live Forever format TBD |
| Kill | **Synthetic only** | Combat log `PARTY_KILL` | Parser works on sample; live Forever format TBD |
| Zone change | **Synthetic only** | Combat log `ZONE_CHANGE` (+ addon `ZONE` untested) | Parser works on sample; live Forever format TBD |
| Dungeon/instance | **Not yet tested in-game** | Addon `IsInInstance` + combat zone/encounter | Not observed |
| Loot | **No** | — | Not in spike; not reliable from combat log |
| PvP kill | **No** | — | Not tested; needs hostile-player rules on live logs |

## What is NOT detectable (from Phase 0 + spike design)

- Level-ups from combat log alone
- Live addon events via SavedVariables (flush on logout/`/reload` only)
- Official local Forever HTTP API (none)
- Reliable loot scoreboard from combat log
- CLEU-based in-addon combat parsing (Midnight/Forever addon rules)

## Files

```text
(repo root)/
  addon/ForeverLAN/          Companion addon
  collector/                 Local agent
  host/                      Minimal ingest + live viewer
  scripts/smoke-simulate.js  Offline pipeline test
  config.json
  data/                      Outbox + host event log (local)
```

## Stop here

When in-game rows in the table above are filled from a real Forever session, Phase 1 is done. Do **not** start Phase 2 (SQLite product persistence / dashboard) until that report exists.
