# Forever LAN — Real Host-Only Telemetry Experiment

**Source of truth:** WoW Forever beta client (`_classic_beta_` / `WowB.exe`)  
**Architecture rule:** Host client alone first. Companion addon only after a documented gap.  
**Do not** treat Retail/Classic docs or the simulator as Forever verification.

---

## How the current ForeverLAN stack collects data

```text
Forever (host)                    Your PC outside the game
─────────────────                 ────────────────────────
ForeverLAN.lua                    collector/index.js
  Unit* / events  → pending[]
  ForeverLANDB (SV) ───────────►  parse SavedVariables
  optional Clipboard ──────────►  poll clipboard
  (no LoggingCombat write)        
                                  combatlog.js tails
                                  Logs\WoWCombatLog.txt
                                            │
                                            ▼
                                  POST /events → host → board
```

| Path | What it is | When it updates the board |
|------|------------|---------------------------|
| **Addon Unit\* / events** | `UnitName`, `UnitClass`, `UnitRace`, `UnitLevel`, `UnitGUID`, `UnitIsDead`, `UnitIsConnected`, `GetZoneText`, `IsInInstance`, `GetInstanceInfo`, party units `partyN` | In memory always; disk on `/reload` or logout; live if you click **Flush LAN** |
| **Clipboard** | ~~`FOREVERLAN_CLIP\|{json}`~~ | **RED on Forever** — `CopyToClipboard` → Action Blocked; removed in v0.1.3 |
| **SavedVariables** | `WTF\Account\…\SavedVariables\ForeverLAN.lua` | Click **Push LAN** then `/reload` — collector parses `pending` |
| **Combat log** | `Logs\WoWCombatLog.txt` | Only if **you** type `/combatlog` (addon cannot enable it — protected) |

### Events the addon already emits

| Type | Trigger (host) |
|------|----------------|
| `LOGIN` / `LOGOUT` / `WORLD_ENTER` | Enter world / logout |
| `PLAYER_DETECTED` | First time a GUID is seen (self or party) |
| `PARTY_ROSTER` | Invite, leave, zone change, slash `roster` (not every poll) |
| `PLAYER_LEVEL_CHANGED` | `PLAYER_LEVEL_UP` (self) or `UNIT_LEVEL` / poll delta (party) |
| `PLAYER_DIED` | `PLAYER_DEAD` (self) or `UnitIsDead` flip (party) |
| `PLAYER_ONLINE` / `PLAYER_OFFLINE` | `UNIT_CONNECTION` / flags |
| `PLAYER_ZONE_CHANGED` | Zone string change + non-`unavailable` source |
| `PLAYER_ENTERED_INSTANCE` / `PLAYER_LEFT_INSTANCE` | Host `IsInInstance` transition only |
| Combat-log types | Collector only: zone, deaths, party kills, encounters (if log enabled) |

### Zone honesty (`zone_source`)

| Source | Kind |
|--------|------|
| `GetZoneText` | **DIRECT** (self only) |
| `GetRaidRosterInfo` | **DIRECT** (if Forever fills it for party) |
| `C_Map.GetBestMapForUnit` | **DIRECT** (if API returns a map) |
| `inferred_same_UnitPosition_instance` | **INFERRED** — same instance id ⇒ showing *your* zone name |
| `unavailable` | **UNKNOWN** — do not invent a zone |

---

## Already verified on Forever (host-only)

See **[CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md)** (updated 2026-09-22 from the real combat logs + host-events). Live `COMBAT_ZONE` ingest without Push is verified. Dungeon, PvP, far coordinates, and a live combat-log death are still unverified.

Summary (2026-09-21): self + party name/class/race/level/dings/roster/online/zone (same area)/deaths/EXACT map coords are **VERIFIED**. Instance entry, PvP kills, far-away friend zone, and XP are **not** verified. Clipboard + auto combat log remain **UNAVAILABLE**.

| Capability | Host alone? | Source | Kind | Reliability | Notes |
|---|---|---|---|---|---|
| Self name / class / race / level | YES | `Unit*` | DIRECT | **VERIFIED** | Alex Gnome Priest |
| Self level-up | YES | `PLAYER_LEVEL_UP` | DIRECT | **VERIFIED** | In host-events |
| Self zone | YES | `GetZoneText` | DIRECT | **VERIFIED** | Dun Morogh |
| Party roster (2 players) | YES | `partyN` | DIRECT | **VERIFIED** | Sam |
| Friend name / class / race / level | YES | `Unit*` on `party1` | DIRECT | **VERIFIED** | |
| Friend level-up | YES | `UNIT_LEVEL` / delta | DIRECT | **VERIFIED** | |
| Friend zone (same area) | YES | `C_Map.GetBestMapForUnit` | DIRECT | **VERIFIED** | Dun Morogh |
| Exact map x/y (self + party) | YES | `C_Map.GetPlayerMapPosition` | DIRECT | **VERIFIED** | See POSITION_MAP.md |
| Friend online/offline | YES | `UnitIsConnected` | DIRECT | **VERIFIED** | |
| Self death | YES | `PLAYER_DEAD` | DIRECT | **VERIFIED** | Cause often unknown |
| Auto combat log | NO | protected | — | **UNAVAILABLE** | `/combatlog` manual |
| Clipboard flush | NO | protected | — | **UNAVAILABLE** | Push LAN → reload |
| Instance / PvP kills | — | — | — | **UNVERIFIED** | No events in host log yet |

---

## PHASE A — Friend party checklist (do this next)

**Friend installs nothing.** Only your ForeverLAN + host + collector.

### Before you start

1. Host + collector running (`node host/server.js`, `node collector/index.js`).
2. Board open: http://127.0.0.1:8765/
3. In game: ForeverLAN enabled; you see **Flush LAN** (v0.1.2).
4. Optional but useful: type `/combatlog` once (chat should say logging enabled).
5. After each major step: click **Push LAN**, then type `/reload` (board updates after reload).

### Script (≈20–30 min)

| Step | You do | Friend does | Pass if you see… | Record |
|------|--------|-------------|------------------|--------|
| A1 | Invite friend to party | Accept | Second name on board; `/foreverlan status` shows `party1` | □ |
| A2 | Note their class/race/level on board vs in-game | Stand near you | Matches game UI | □ |
| A3 | Friend dings (quest/mob) | Level up | `PLAYER_LEVEL_CHANGED` for **them** | □ |
| A4 | Friend dies to a mob near you | Die nearby | `PLAYER_DIED` and/or combat-log death | □ |
| A5 | You die to a mob | Watch | Your death on board; note if cause is PvE | □ |
| A6 | Compare zones while grouped in same zone | Stay with you | Their `zone` + `zone_source` — write the source down | □ |
| A7 | Friend runs to another zone alone (still party) | Leave your zone | Does their zone update? Or `unavailable` / stale? | □ |
| A8 | Fight the same mob | Attack with you | Combat log lines with their name (if `/combatlog` on) | □ |
| A9 | Enter a low dungeon together (e.g. RFC/WC/DM) | Enter with you | `PLAYER_ENTERED_INSTANCE` + instance name; their zone? | □ |
| A10 | Leave instance | Leave | `PLAYER_LEFT_INSTANCE` | □ |
| A11 | Friend goes offline / logs | Exit WoW | `PLAYER_OFFLINE` or roster drop | □ |
| A12 | Friend back online | Relog / online | `PLAYER_ONLINE` / re-detect | □ |
| A13 | *(Optional)* PvP: you kill a player / die to a player | Participate if easy | `PARTY_KILL` / death attribution; PvE vs PvP clear? | □ |
| A14 | *(Optional)* Friend not in party, nearby | Leave party, stay near | What still appears? (expect almost nothing) | □ |

### After the session — paste into chat or notes

```text
/foreverlan status
```

Plus: friend character name, what dinged, zone_source values seen, whether `/combatlog` was on, dungeon name if any.

I will then fill the full Phase A matrix (GREEN/YELLOW/RED + DIRECT/INFERRED/COMBAT_LOG) and Phase B gap list. **No companion addon until that gap list exists.**

---

## PHASE A — Full capability matrix (fill after friend session)

Status: **GREEN** verified · **YELLOW** partial/inferred/unreliable · **RED** unavailable · **PENDING** not tested on Forever

Kind: **DIRECT** · **INFERRED** · **COMBAT_LOG** · **UNKNOWN**

| Capability | Works from host alone? | Actual source | Kind | Reliability | Notes |
|---|---|---|---|---|---|
| Party roster (grouped) | PENDING | `partyN`, `GROUP_ROSTER_UPDATE` | DIRECT | PENDING | |
| Friend character name | PENDING | `UnitName` / `UnitFullName` | DIRECT | PENDING | |
| Friend class | PENDING | `UnitClass` | DIRECT | PENDING | |
| Friend race | PENDING | `UnitRace` | DIRECT | PENDING | |
| Friend level | PENDING | `UnitLevel` | DIRECT | PENDING | |
| Friend level-up | PENDING | `UNIT_LEVEL` + poll delta | DIRECT | PENDING | |
| Friend online/offline | PENDING | `UnitIsConnected`, `UNIT_CONNECTION` | DIRECT | PENDING | |
| Friend death | PENDING | `UnitIsDead` / `UNIT_FLAGS` | DIRECT | PENDING | |
| Death cause PvE vs PvP | PENDING | Combat log attribution | COMBAT_LOG | PENDING | Addon death has no cause yet |
| Friend PvP kill | PENDING | Combat log | COMBAT_LOG | PENDING | |
| Friend PvP death | PENDING | Combat log + UnitIsDead | COMBAT_LOG / DIRECT | PENDING | |
| Friend current zone | PENDING | roster / C_Map / inference | ? | PENDING | Record `zone_source` |
| Friend zone change | PENDING | Same | ? | PENDING | Especially when far away |
| Party membership changes | PENDING | `GROUP_ROSTER_UPDATE` | DIRECT | PENDING | |
| Friend combat participation | PENDING | Combat log name/GUID | COMBAT_LOG | PENDING | Range-limited |
| Instance entry (host) | PENDING | `IsInInstance`, `GetInstanceInfo` | DIRECT | PENDING | Self only today |
| Instance exit (host) | PENDING | Same | DIRECT | PENDING | |
| Instance name | PENDING | `GetInstanceInfo` | DIRECT | PENDING | Host's instance |
| Friend in same instance | PENDING | roster / zone / inference | ? | PENDING | |
| Friend **not** in party | PENDING | — | UNKNOWN | PENDING | Step A14 |
| Self telemetry (name/class/level/zone/ding) | YES | Unit* / events | DIRECT | **GREEN** | Solo session |
| Auto combat logging | NO | protected API | — | **RED** | Manual `/combatlog` |

---

## PHASE B — Information gap (after Phase A only)

*(Empty until friend checklist is run. Examples of the form we will use:)*

- “Host can see X but cannot reliably see Y.”
- “Host cannot observe Z when friend is not in the party.”

**Do not design a companion addon until this section has real Forever bullets.**

---

## PHASE C — Companion addon (gated)

Only if Phase B lists important gaps. Friend UX target: install once → play → never touch. No HTTP assumptions — investigate Forever-allowed comms first.

---

## Ops cheatsheet

```powershell
cd E:\OneDrive\Private\Cursor\FOREVER\phase1
node host/server.js
node collector/index.js
```

| URL | Role |
|-----|------|
| http://127.0.0.1:8765/ | LAN board |
| http://127.0.0.1:8765/raw | Raw events |

| In-game | Purpose |
|---------|---------|
| `/foreverlan status` | What addon sees right now |
| `/foreverlan roster` | Force roster event |
| **Flush LAN** | *(old name)* → use **Push LAN** |
| **Push LAN** | Save SavedVariables + reload UI (one click) |
| `/reload` | Also writes SavedVariables |
| `/combatlog` | Enable combat log file (manual, once per session) |
