# Forever LAN — Phase 0 Telemetry Report

**Date:** 2026-09-20  
**Goal:** Determine what can be observed automatically from the WoW Forever client before any feature work.  
**Verdict:** A passive LAN dashboard is feasible, but **not from combat logs alone**. Level race and clean online status require a thin companion addon plus a per-PC collector. Do not build features that cannot be proven from these sources.

---

## 1. What was inspected on this machine

| Item | Result |
|------|--------|
| Install root | `C:\Games\FOREVER\World of Warcraft` |
| Client folder | `_classic_beta_` (not `_retail_`, not a `_forever_*` name) |
| Product ID | `wow_classic_beta` (Battle.net + `.flavor.info`) |
| Executable | `WowB.exe` |
| Build | `1.60.1.69913` (PreRelease) |
| `Logs/` | **Absent** — not created yet |
| `WTF/` | **Absent** — not created yet |
| `Interface/AddOns/` | **Absent** — not created yet |

**Implication:** The beta client is installed, but there is no first-play session artifact yet. Combat-log format, WTF layout, and addon load behavior must be **validated on first login** before Phase 1 is considered proven.

Expected runtime paths after play (standard Blizzard layout):

```text
C:\Games\FOREVER\World of Warcraft\_classic_beta_\Logs\WoWCombatLog.txt
C:\Games\FOREVER\World of Warcraft\_classic_beta_\WTF\Account\...
C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\...
```

---

## 2. Critical Forever-specific constraints

### 2.1 UI / addon API (Blizzard statement)

Blizzard (via WoW UI Discord, reported by Wowhead) states Forever shares **Mainline UI architecture** with Midnight, including:

- Secret Values / addon disarmament
- No addon access to live CLEU (`COMBAT_LOG_EVENT_UNFILTERED`)
- Non-combat APIs largely remain usable (`UnitLevel`, `UnitClass`, `PLAYER_LEVEL_UP`, zone events, SavedVariables, etc.)

**Do not assume Classic-era addon combat APIs work.**

### 2.2 File combat log (still the main external pipe)

Midnight/Forever addon restrictions **do not remove** the on-disk combat log written by `/combatlog`. External parsers (Warcraft Logs, etc.) still rely on `Logs\WoWCombatLog.txt`.

**Maintenance trap:** `/combatlog` must be enabled each login. That violates “zero maintenance during gameplay” unless a companion addon calls `LoggingCombat(true)` on login.

### 2.3 No official Forever live local API

There is **no** documented local HTTP/gRPC API for the Forever client. Battle.net Profile APIs:

- Need internet + OAuth
- Update mainly after logout
- Violate the offline-LAN requirement

**Decision:** Official cloud APIs are out of scope for core telemetry.

### 2.4 SavedVariables are not a live stream

Addon SavedVariables flush on logout / `/reload` (hardware-gated). Fine for archival snapshots; **bad** as the only pipe for a live projector level race.

---

## 3. Data source scorecard

Classification key:

- **Availability:** available / unavailable / unknown-until-first-login
- **Reliability:** reliable / partial / unreliable
- **Effort:** low / medium / high
- **Privacy:** local-only / sensitive / ToS-risk

### 3.1 Combat log file (`WoWCombatLog.txt`)

| Aspect | Rating |
|--------|--------|
| Availability | **available** (after Advanced Combat Logging + `/combatlog`; folder appears after first enable) |
| Reliability | **reliable** for combat-adjacent events while logging is on |
| Effort | **medium** (tailer + parser; format version must be pinned from Forever header) |
| Privacy | **sensitive** — full nearby combat, player names, GUIDs, gear on encounters |

| Desired signal | Detectable? | Notes |
|----------------|-------------|-------|
| Death events | Yes | `UNIT_DIED` / related; filter player GUIDs |
| Kill events | Partial | `PARTY_KILL` for party; otherwise infer player→enemy deaths carefully |
| Zone changes | Yes | `ZONE_CHANGE` |
| Dungeon/instance | Partial–Yes | `ZONE_CHANGE` instance type + `ENCOUNTER_START/END` |
| Character names | Yes | Appear as source/dest names while active |
| Login/logout | No | Not a combat-log concept |
| Level-up | **No** | Not a combat-log event |
| Current level | **No** | `COMBATANT_INFO` has gear/spec/stats, **not level** |
| Loot | Unreliable | Not a dependable structured loot stream for a scoreboard |
| Mounts | No | |
| Playtime | No | |

**Open-world caveat:** Outside instances, the client may buffer writes. Live updates can lag during quiet questing.

### 3.2 Chat log (`WoWChatLog.txt` via `/chatlog`)

| Aspect | Rating |
|--------|--------|
| Availability | **available** (command exists historically) |
| Reliability | **unreliable** for live use — historically flushed on logout |
| Effort | low |
| Privacy | sensitive (chat contents) |

May capture system “reached level X” text, but **do not design the live dashboard around it** until Forever is proven to flush live.

### 3.3 WTF / SavedVariables / character folders

| Aspect | Rating |
|--------|--------|
| Availability | **unknown-until-first-login** (folders missing now; expected after play) |
| Reliability | **reliable** for identity discovery after login; **stale** for live stats |
| Effort | low–medium |
| Privacy | local account/character structure |

**Useful for:**

- Auto-discovering realm/character folder names (reduces manual registration)
- Reading companion-addon snapshots after logout/reload
- One-time character ↔ player mapping hints

**Not useful alone for:** live level race.

### 3.4 Companion addon (non-combat events)

| Aspect | Rating |
|--------|--------|
| Availability | **available** (expected; Interface folder not present yet) |
| Reliability | **reliable inside the client** for level/zone/login/death of self |
| Effort | **medium–high** (addon + real-time egress bridge) |
| Privacy | local; only what we choose to emit |

Events/APIs expected to remain usable under Midnight-style rules:

- `PLAYER_LOGIN` / `PLAYER_ENTERING_WORLD` → session start
- `PLAYER_LEVEL_UP` / `UnitLevel("player")` → **level race source of truth**
- `UnitName` / `UnitClass` → identity
- `ZONE_CHANGED_NEW_AREA` / instance APIs → zone/dungeon
- `PLAYER_DEAD` / release events → own death (backup to combat log)
- Mount collection events (if present in Forever) → first mount milestone
- `LoggingCombat(true)` on login → remove manual `/combatlog`

**Hard problem:** getting addon events **out of the process in real time** without memory reading.

Egress options (ranked for this product):

| Bridge | Live? | Effort | Notes |
|--------|-------|--------|-------|
| Combat log only | Yes | medium | Missing level-ups |
| SavedVariables watcher | No (logout/reload) | low | Good archive, bad projector |
| Structured local chat log | Maybe | low | Needs Forever flush validation |
| Screen-pixel / tiny HUD encode | Yes | high | Works offline; fragile; private LAN OK |
| Memory read / inject | Yes | high | **Reject** — ToS / security |
| Battle.net Profile API | Delayed | medium | Cloud + logout lag — reject for core |

**Recommended Phase 1 stance:** prove combat-log tailing + addon event capture; pick the lightest live egress that works on Forever (validate chat-log flush first; fall back to a tiny encoded HUD only if needed).

### 3.5 Official / remote APIs

| Aspect | Rating |
|--------|--------|
| Availability | **unavailable** for Forever-specific live LAN use (no confirmed Forever namespace) |
| Reliability | n/a for offline LAN |
| Effort | n/a |
| Privacy | OAuth account scope |

### 3.6 Other local telemetry

| Source | Rating | Notes |
|--------|--------|-------|
| Process presence (`WowB.exe`) | partial | “Game open” ≠ “character online in world” |
| Screenshots folder | unavailable as telemetry | Manual only |
| Network sniffing of game traffic | unavailable for us | Encrypted; ToS-risk; do not |
| Shared LAN folder of logs | available pattern | Each PC still needs a local collector |

---

## 4. Mapping to product features

| Dashboard idea | Can we do it? | Source |
|----------------|---------------|--------|
| Roster: character name | Yes (auto after play) | WTF folders + combat log names + addon |
| Roster: class | Yes | Addon (`UnitClass`) or manual once |
| Roster: level | Yes, if addon egress solved | `PLAYER_LEVEL_UP` / `UnitLevel` |
| Online/offline | Partial→Yes | Addon heartbeat via live bridge; else heuristic from recent log activity |
| Level race | **Yes only with addon live bridge** | Addon |
| Recent: level-up | Same | Addon |
| Recent: death | Yes | Combat log (+ addon backup) |
| Recent: entered dungeon | Yes | `ZONE_CHANGE` / instance APIs |
| Recent: kill | Partial | Combat log |
| Stats: online count | Partial→Yes | Heartbeats |
| Stats: highest / average level | Yes with addon | Addon |
| Stats: levels gained | Yes with addon | Addon |
| Stats: deaths / kills | Yes / partial | Combat log |
| Stats: playtime | Yes with addon | `TIME_PLAYED_MSG` / session timers |
| Stats: dungeon events | Yes | Combat log / zone |
| Milestone: first character | Yes | First WTF character folder or first addon login |
| Milestone: first level 10/20 | Yes with addon | Addon |
| Milestone: first death | Yes | Combat log |
| Milestone: first dungeon | Yes | Zone/instance |
| Milestone: first PvP kill | Partial | Needs careful hostile-player kill rules |
| Milestone: first mount | Unknown | Addon event if Forever exposes it; else **do not fake** |
| Loot feed | No for MVP | Unreliable |
| Manual +1 counters | Out of scope | Product rule |

---

## 5. Architecture implied by the evidence

```text
[Each player PC]
  WowB.exe (_classic_beta_)
       │
       ├─ Logs/WoWCombatLog.txt  ──tail──► Forever LAN Collector (local agent)
       │                                      │
       └─ Companion addon ──live bridge───────┘
                                              │
                                         LAN WebSocket/HTTP
                                              │
                                         [Host PC]
                                         SQLite + Dashboard
                                         (listen 0.0.0.0)
```

**Design rules:**

1. **Host listens on `0.0.0.0`** — confirmed product requirement.
2. **One collector per gaming PC** — Forever does not centralize telemetry.
3. **SQLite on host** — weekend archive + JSON export.
4. **Companion addon is mandatory** for level race; optional later only if Forever gains a better live pipe.
5. **One-time registration** (player ↔ character) remains; auto-fill from WTF/combat names where possible.
6. **No cloud dependency** for the live path.

---

## 6. Privacy / security

- Combat logs contain nearby player combat, names, GUIDs, and sometimes gear (`COMBATANT_INFO`).
- Keep data on LAN only; JSON export is an explicit end-of-weekend action.
- Do not ship logs offsite.
- Do not implement memory reading, packet sniffing, or injected DLLs.
- Addon should emit **minimal structured events** (level, zone, online heartbeat), not full combat dumps.

---

## 7. Phase 1 proof plan (before dashboard work)

Do these on a real Forever play session:

1. Create a character; confirm `WTF\Account\...\Realm\Character\` appears.
2. Enable Advanced Combat Logging once; confirm companion can call `LoggingCombat(true)`.
3. Produce `Logs\WoWCombatLog.txt`; capture `COMBAT_LOG_VERSION` / `BUILD_VERSION` / `PROJECT_ID` header.
4. Die once, enter a dungeon, kill a mob, change zones — confirm event lines.
5. Level once — confirm **absence** from combat log and presence via addon event.
6. Prove **one** live egress path for level events to a local collector within ~1–2 seconds.
7. Only then start SQLite + dashboard.

---

## 8. What not to build yet

- Loot trackers, inventory, raid planners, manual counters
- Cloud Armory sync
- Features that need CLEU inside addons
- Milestones that cannot be observed (especially mounts, until proven)

---

## 9. Bottom line

**Technically possible:** a zero-maintenance-during-play LAN scoreboard that tells the weekend’s story.

**Must be true to succeed:**

1. Per-PC collector watching Forever’s `_classic_beta_` tree  
2. Always-on combat logging via companion addon  
3. Companion addon as source of truth for **level** and clean **online** state  
4. Honest scope: only events we can detect reliably  

**Blocked until first play session:** exact combat-log dialect, WTF shape, and which live addon→agent bridge is least fragile on Forever.

**Success test still stands:** six people play and forget the app exists, while the projector quietly narrates what the clients actually emit.
