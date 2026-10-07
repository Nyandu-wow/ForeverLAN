# Forever LAN — Capability matrix

**Updated:** 2026-10-03  
**Client on this machine:** `WowB.exe` **1.60.1.70205** (file date 2026-10-03).  
**Source of truth:** Forever beta client files + `data/host-events.jsonl`. Not Retail/Classic docs. Not the simulator.

Statuses: **VERIFIED** · **PARTIALLY VERIFIED** · **UNVERIFIED** · **UNAVAILABLE**

## Client updates (patch notes → our product)

| Build | Notes (Blizzard) | ForeverLAN impact |
|-------|------------------|-------------------|
| **1.60.1.70205** (2026-10-03) | Client bump; wrong TOC `160001` → incompatible | **0.1.56:** ship Interface ceiling **16999** (loads while client ≤ that). Collector auto-patches installed TOC if peers ever go higher — no manual sync. |
| **1.60.1.70170** (2026-10-01/02) | Level cap → **30**; Wetlands excavation / RFK / Uldaman unlocks; class/UI/gamepad pass | Wrong TOC `160001` still loaded for some players; 70205 refuses it. Host `level_cap` may need beta=30 separately. |
| **1.60.1.69977** (2026-09-22/23) | Mac display/stability; gamepad character select | No API/combat-log changes. |

Forensic pass (telemetry, prior):

- `Logs/WoWCombatLog-092026_200138.txt` — 37,994 lines, 2026-09-20 session (real `/combatlog`)
- `Logs/WoWCombatLog-092126_084840.txt` — login burst 2026-09-21, **ingested live** into host-events (`ingested_via: combatlog`) without Push
- Newest pre-69977 combat log on disk: `WoWCombatLog-092226_201344.txt` — `COMBAT_LOG_VERSION,22,…,BUILD_VERSION,1.60.1,PROJECT_ID,18`
- Parser: `collector/combatlog.js` → `parseCombatLogLine`

Controlled live tests still not done for: party death while the collector is attached, leaving the zone, dungeon entry, PvP, far-away coordinates. Those stay **UNVERIFIED**.

**2026-09-23 post-update check:** WowB 69977 running; ForeverLAN enabled on Alex/BankAlt; no ForeverLAN Lua errors in Hotfix at login; host+collector restarted OK. Fresh in-world Push + `/combatlog` still needed to stamp `capabilities.game_build` and confirm combat-log ingest on 69977.
---

## Final matrix

| Capability | Source | Reliability | Notes |
|------------|--------|-------------|--------|
| Own name / class / race / level | Addon `Unit*` | **VERIFIED** | |
| Own level changes | `PLAYER_LEVEL_CHANGED` | **VERIFIED** | |
| Party name / class / race / level | `Unit*` on `partyN` | **VERIFIED** | Sam, in party |
| Party level changes | `UNIT_LEVEL` / poll | **VERIFIED** | |
| Roster | `PARTY_ROSTER` | **VERIFIED** | |
| Online / offline | `PLAYER_ONLINE` / `PLAYER_OFFLINE` | **VERIFIED** | |
| Party flag | Roster | **VERIFIED** | |
| Own zone | `GetZoneText` | **VERIFIED** | |
| Party zone, same area | `C_Map` | **VERIFIED** | Dun Morogh together |
| Party zone, far away | — | **UNVERIFIED** | Never left the zone in captured data |
| Zone change (addon) | `PLAYER_ZONE_CHANGED` | **VERIFIED** | |
| Zone change (combat log → host, no Push) | `ZONE_CHANGE` → `COMBAT_ZONE` | **VERIFIED** | Live host event 2026-09-21 08:48, Dun Morogh. Logging client only |
| Subzone in combat log | `ZONE_CHANGE` | **VERIFIED** | Anvilmar ↔ Dun Morogh, map stayed 1426 |
| Map ID (addon) | `C_Map.GetBestMapForUnit` | **VERIFIED** | 1426 |
| Map ID (combat log raw) | `MAP_CHANGE` | **PARTIALLY VERIFIED** | Raw lines exist (1415, 1426). **Not normalized** — parser ignores `MAP_CHANGE` |
| Exact map X/Y, self + party1, same zone | `C_Map.GetPlayerMapPosition` | **VERIFIED** | Dun Morogh probe |
| Exact X/Y while moving / far / in instance | — | **UNVERIFIED** | No such probes |
| World yards | `UnitPosition` | **VERIFIED** | Same probe only |
| Own death (addon) | `PLAYER_DIED` | **VERIFIED** | Cause filled later from combat-log recap when available |
| Death recap (mob / fall) | `COMBAT_PLAYER_DEATH` + prior damage | **IMPLEMENTED** | Collector keeps last hit → `death_summary` / `killer_name` / `environmental_type`. Merged onto addon deaths |
| Rare / Epic loot | `PLAYER_LOOT_RARE` / `PLAYER_LOOT_EPIC` | **IMPLEMENTED** | Addon `CHAT_MSG_LOOT` self loot only (quality 3/4). Live feed + hall trophies |
| Time in combat | `PLAYER_COMBAT_TIME` | **IMPLEMENTED** | Addon `PLAYER_REGEN_*` cumulative seconds → **MORE DOTS!** hall (most combat time) |
| Corpse run (death → alive) | `PLAYER_RESURRECTED` + `corpse_run_seconds` | **IMPLEMENTED** | Addon `PLAYER_ALIVE` / `PLAYER_UNGHOST` / dead→alive poll. Host tracks total + longest walk → CORPSE TOURIST |
| Own professions (rank/max) | `PLAYER_PROFESSIONS` | **IMPLEMENTED** | Self only via `GetProfessions` / `GetProfessionInfo` (fallback `GetSkillLineInfo`). Host Professions board (Slice A) derives coverage + skill-ups from snapshots. Party N/A without friend addon |
| Craft creates (self) | `PLAYER_CRAFT` | **IMPLEMENTED (0.1.32)** | Auto from Forever `CHAT_MSG_TRADESKILLS` — self only (`You create…` / own full name). Feeds Professions stream + THE FACTORY / CRAFTSMAN. No button. Gathering not confirmed yet |
| Gather actions | — | **PROBE / UNVERIFIED** | No `PLAYER_GATHER` ingest yet — no Forever gather chat samples in the live dataset. Use `/fl craftprobe` while gathering; do not invent events |
| Profession awards | board + hall | **IMPLEMENTED** | Includes JACK OF ALL TRADES + THE SPECIALIST + THE FACTORY / CRAFTSMAN (Counted from logged profession/craft snapshots). Combat-time hall uses **MORE DOTS!** |
| Campsite / commerce / scarce mats | — | **UNAVAILABLE** | Forever-specific systems — no safe addon API known; park |
| Quests completed | `PLAYER_QUESTS` | **PROBE (0.1.8)** | Self `GetQuestsCompleted` (+ in-log counts). Not party. Lifetime completed total, not XP |
| Food buff remaining | `PLAYER_FOOD_BUFF` | **PROBE (0.1.8)** | Self `UnitBuff` Well Fed / Food / Drink + expiration when Forever returns it |
| Distance traveled | `PLAYER_DISTANCE` | **PROBE (0.1.8)** | **Yes, approximate.** Sum of `UnitPosition` steps same instance; skips teleports (>80 yd). Session-local, not Blizzard mileage |
| Attack / spell power | `PLAYER_POWER_STATS` | **PROBE (0.1.10)** | Self AP/SP via UnitAttackPower / GetSpellBonusDamage. Forever may return **secret numbers** — addon skips arithmetic when tainted (`secret_blocked`) |
| Gold | `PLAYER_MONEY` | **PROBE (0.1.9)** | Self `GetMoney` (copper). Party N/A without friend addon |
| World map / minimap opens | `PLAYER_MAP_OPENED` | **PROBE (0.1.9)** | World map = `WorldMapFrame` OnShow. Minimap is always on-screen → count **clicks** on Minimap (not “open”) |
| Player death (combat log parser) | `UNIT_DIED` → `COMBAT_PLAYER_DEATH` | **PARTIALLY VERIFIED** | 7 real player lines parse. Victim name + GUID yes. Killer **not** on `UNIT_DIED` (source is nil). Not yet seen live in host-events |
| Death cause | Nearby `SWING_*` / `ENVIRONMENTAL_DAMAGE` | **IMPLEMENTED** | Stateful combat-log parser attaches recap within 8s of `UNIT_DIED` |
| Party member death via `UnitIsDead` | Addon | **UNVERIFIED** | Not isolated from self deaths |
| PvE creature kill in log | `PARTY_KILL` + `Creature-` | **VERIFIED** in file | 84 lines, all creatures (Alex killing wolves, etc.). Session **does not** count these as PvP |
| PvP kill | `PARTY_KILL` + `Player-` dest | **UNVERIFIED** | **0** player destinations in the whole log. No event to verify |
| PvP death | — | **UNVERIFIED** | No player-vs-player damage/death pair |
| Combat log file while `/combatlog` on | `WoWCombatLog-*.txt` | **VERIFIED** | Continuous append |
| Collector reads new CL lines without Push | Tail → `POST /events` | **VERIFIED** | `COMBAT_LOG_VERSION` + `COMBAT_ZONE` in host-events. Large historical file is **not** replayed (tail starts at EOF if >256KB) |
| Instance entry / exit | Addon `IsInInstance` | **UNVERIFIED** | No `PLAYER_ENTERED_INSTANCE` / `LEFT` |
| Dungeon / instance name | `GetInstanceInfo` | **UNVERIFIED** | No dungeon in logs. `ZONE_CHANGE` instance type was always `0`. No `ENCOUNTER_START` |
| Party member inside instance | — | **UNVERIFIED** | |
| XP progress | — | **UNAVAILABLE** | Not exposed to this product |
| Clipboard automation | `CopyToClipboard` | **UNAVAILABLE** | Action Blocked |
| Automatic `/combatlog` | `LoggingCombat(true)` | **UNAVAILABLE** | Action Blocked |
| Addon HTTP | — | **UNAVAILABLE** | Sandbox |
| Friend addon | — | Not used | Host-only |

---

## Test 1 — Combat log (what the real file + parser actually do)

There is no `COMBAT_PVP_KILL` or `COMBAT_PVP_DEATH` type. Actual model:

| Raw line | Parser output | Who | Killer | Victim | Cause | Reliability |
|----------|---------------|-----|--------|--------|-------|-------------|
| `ZONE_CHANGE,0,"Dun Morogh",0` | `COMBAT_ZONE` | Logging client only (no name on the line) | — | — | — | **VERIFIED** parse + one live host ingest |
| `ZONE_CHANGE,0,"Anvilmar",0` | `COMBAT_ZONE` | Same | — | — | Subzone, not a dungeon | **VERIFIED** in file; not a separate host event yet |
| `MAP_CHANGE,1426,"Dun Morogh",…` | *(dropped)* | Logging client | — | — | Map id in raw only | Raw **VERIFIED**, normalized **UNAVAILABLE** until a parser is added |
| `UNIT_DIED,…,Player-…,"Alex-ClassicBetaPvP-",…` | `COMBAT_PLAYER_DEATH` | Victim name (realm suffix stripped at first `-`) | **Not in this line** (source GUID nil) | Yes | Not on the normalized event. Prior line was `ENVIRONMENTAL_DAMAGE` | Parser **PARTIALLY VERIFIED** offline. Live host ingest of a death: **UNVERIFIED** |
| `PARTY_KILL,Player-…,"Alex-…",…,Creature-…,"Ragged Young Wolf"` | `PARTY_KILL` then **ignored** by session unless dest is `Player-` | Killer name yes | — | Creature, not a player | — | PvE log **VERIFIED**. Not a PvP stat |
| `PARTY_KILL` with player victim | Would be `PARTY_KILL` and counted as a PvP kill | — | — | — | — | **UNVERIFIED** (never occurred) |
| `ENCOUNTER_START` / `END` | Would be `ENCOUNTER_*` | — | — | — | — | **UNVERIFIED** (0 lines) |

Live without Push: **yes for lines written after the collector attaches.** Proof: host-events `COMBAT_ZONE` / `COMBAT_LOG_VERSION` at `2026-09-21T06:49:24Z`, `ingested_via: combatlog`. The 10MB Sep 20 file was not backfilled.

---

## Test 2 — Dungeon / instance

Not observed. Captured zones: `UNKNOWN AREA`, `Dun Morogh`, `Anvilmar` only. Maps: `1415` Eastern Kingdoms, `1426` Dun Morogh. `ZONE_CHANGE` third field (instance type) was always `0`. No encounter lines. Addon instance events: none.

**UNVERIFIED**, not marked unavailable — the APIs are in the addon, they were just never exercised in a dungeon.

---

## Test 3 — PvP

Not observed. 84 `PARTY_KILL` lines, every destination `Creature-`. Seven `UNIT_DIED` players were killed by creatures or environment (Grik'nir, whelps, boars, fall/fatigue), including one Alex environmental death. No killer name on `UNIT_DIED` itself.

**UNVERIFIED.** Do not add PvP UI until a real player-vs-player line exists.

---

## Test 4 — Position limits

Only captured case: self + party1 **EXACT** on map `1426` Dun Morogh while together (`POSITION_UPDATE` in host-events).

Not captured, so **UNVERIFIED**:

- coordinates while the party member is moving (only snapshots)
- after they change zone
- when they are far away
- when they enter an instance

Map code was not changed.

---

## Persistence

See [DATA_COLLECTION.md](./DATA_COLLECTION.md).

`host-events.jsonl` is the durable history. Event time is always original `event.ts` (never host ingest time). SavedVariables + collector outbox support LIVE and OFFLINE/CATCH-UP. Addon pending is **kept across Push** (no blind clear); capped at **1500** (`MAX_PENDING`). Under pressure, low-value types drop first; otherwise oldest. See [DATA_COLLECTION.md](./DATA_COLLECTION.md).

---

## Next product phase (after this foundation)

Do **not** add dashboard features yet.

One short Forever session, collector already running, `/combatlog` on:

1. Die once (confirm `COMBAT_PLAYER_DEATH` lands in host-events with no Push).
2. Walk Anvilmar → outside (confirm another live `COMBAT_ZONE`).
3. If easy: one duel (`PARTY_KILL` with a `Player-` dest, or document that Forever never writes one).
4. Step into any instance and Push once (`PLAYER_ENTERED_INSTANCE` + `GetInstanceInfo` name, or mark unavailable).
5. `/foreverlan pos` while together, then after the friend is in another zone (document whether `map_x` survives).

Then the only code worth writing is whatever that session proves: e.g. normalize `MAP_CHANGE`, or attach environmental cause when the previous line is `ENVIRONMENTAL_DAMAGE`. Not before.
