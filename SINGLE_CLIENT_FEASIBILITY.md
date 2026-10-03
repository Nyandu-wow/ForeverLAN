# Forever LAN — Single-Client Architecture Feasibility

**Date:** 2026-09-20  
**Constraint:** Only MY PC runs software. Friends install nothing. They just play WoW.  
**Status:** Architectural report only — no implementation restart yet.

---

## 1. Verdict

The single-client architecture is **viable and preferred** for this LAN.

What one Forever client can know about the rest of the room is **real, but situational**:

- **Always strong:** your own character (login, level, deaths, zone, combat).
- **Strong when grouped nearby:** party/raid roster identity (name/class/level), party deaths in combat log range, shared dungeon/combat activity.
- **Weak or absent:** friends who are solo elsewhere on the map, loot of others, remote guild activity, anything requiring their local client files.

That is enough for a useful passive “LAN Party” scoreboard **if** the weekend naturally involves party/dungeon play together. It is **not** enough for a guaranteed full roster of six independent solo level-racers across the world.

**Product stance:** Optimize for zero friend friction. Treat other players as *opportunistically discoverable* through normal WoW grouping and proximity — never as required agents.

---

## 2. Architecture (revised)

```text
MY PC ONLY
├── WoW Forever (_classic_beta_)
├── ForeverLAN companion addon (MY client only)
├── Local collector (MY PC only)
├── Forever LAN server (0.0.0.0)
├── SQLite
└── Web dashboard / beamer mode

Friends' PCs
└── Stock WoW Forever — no addon, no agent, no config

Other devices (optional)
└── Browser → http://<my-lan-ip>:<port>
```

### What this kills from the earlier plan

| Old assumption | New rule |
|----------------|----------|
| Collector on every gaming PC | **Rejected** |
| Addon on every gaming PC | **Rejected** |
| Friends configure IPs / ports | **Rejected** |
| Aggregate six local combat logs | **Rejected** |
| Perfect omniscient LAN telemetry | **Rejected** |

### What remains from Phase 0/1

| Keep | Why |
|------|-----|
| Companion addon on MY client | Only way to get clean own level-ups + auto combat logging + party polling |
| Local collector on MY PC | Tail MY combat log + receive MY addon egress |
| Host on `0.0.0.0` + browser dashboard | Friends/TV can watch without installing anything |
| SQLite + JSON export | Still on MY PC |
| “No manual counters” | Unchanged |

Phase 1 spike code is still useful as the **host-PC telemetry path**; it should be reframed as single-client, then extended to observe party/raid units — not rewritten from zero.

---

## 3. What one client can know

### 3.1 Addon / Unit API (MY client)

Forever is expected to use Mainline/Midnight-style UI rules. Non-combat identity APIs for **player / party / raid** units are the useful surface.

| Signal | About me | About party/raid | About arbitrary other players |
|--------|----------|------------------|-------------------------------|
| Name | Yes | Likely yes (`partyN` / `raidN`) | Target / mouseover / nameplate only |
| Class | Yes | Likely yes | Target / inspect-ish contexts |
| Level | Yes (`PLAYER_LEVEL_UP`, `UnitLevel`) | Likely yes via `UnitLevel` + `UNIT_LEVEL` | Target if exposed; not omniscient |
| Online/connected | Yes | Likely yes (`UnitIsConnected`) | Only if grouped or otherwise unit-tokened |
| Dead/ghost | Yes | Likely yes (`UnitIsDead` / `UnitIsGhost`) | If unit token exists |
| Zone | Yes | **Partial / unverified** — party zone may update via group state; not as reliable as own zone | No remote zone feed |
| Exact world position of friend across map | No | No (not for scoreboard use) | No |

**Important:** There is **no** `PLAYER_LEVEL_UP` for other characters. Detecting a friend’s level-up means noticing `UnitLevel("partyN")` change (and/or `UNIT_LEVEL`) while they remain a valid unit — typically **while grouped**.

**Secret Values:** Combat health/power logic is restricted; identity fields for party allies are generally still the path for a LAN roster. Exact Forever behavior remains **unverified in-session**.

### 3.2 Combat log file (MY client only)

When `LoggingCombat(true)` is on, MY `WoWCombatLog.txt` records combat-related events **visible to MY client** (historically ~50 yards in Classic-like clients; Forever radius **unverified**).

| Situation | What MY log can contain about others |
|-----------|--------------------------------------|
| In my party, fighting near me | Their casts/hits/heals/deaths that occur in range |
| In my party, far away alone | Usually **little or nothing** |
| Same combat / same pull | High chance of their participation events |
| Same zone but not near me | Unreliable |
| PvP near me | Hostile player names/GUIDs in kill/death lines — **partial** |
| Dungeon together | Strong: `ZONE_CHANGE`, encounters, party combat, deaths |

`PARTY_KILL` and player `UNIT_DIED` lines are the main structured hooks for kills/deaths involving group members **when those events are logged for MY client**.

### 3.3 Chat / system messages (MY client)

| Channel / message type | Useful for LAN scoreboard? | Notes |
|------------------------|----------------------------|-------|
| Party / raid chat | Weak | Free-text; no structured telemetry unless someone types it |
| Guild chat | Weak | Same |
| Emotes | Weak | |
| System messages | Partial | Some instance/boss/system lines; Forever set **unverified** |
| Achievement spam | Partial / unverified | May appear if Blizzard broadcasts to party/nearby; do not depend on it |
| Other players’ level-up dings | **No by default** | Only if *they* run an announcing addon — which friends will not |

Do **not** design core features around chat parsing.

### 3.4 Public / server / Battle.net APIs

| Source | Fit for Forever LAN? |
|--------|----------------------|
| Battle.net Profile / Armory | Poor — cloud, OAuth, logout-delayed, offline-LAN hostile |
| Official Forever live local API | **None known** |
| Packet sniffing / MITM | **Out of scope** — invasive, fragile, ToS risk |

### 3.5 Network observation

**Not justified.** Prefer addon unit APIs + combat log. No sniffing in the product plan.

---

## 4. Feasibility matrix

Legend for “Can my single client observe it?”:

- **Yes** — expected from standard WoW mechanisms; still confirm on Forever play
- **Likely** — well-supported historically / on Midnight-style APIs; Forever session not yet run
- **Situational** — only under party/proximity/combat conditions
- **Unverified** — plausible but not confirmed on Forever beta
- **No** — not realistically obtainable from one client without friends installing software

| Information | Can my single client observe it? | Source | Reliability | Requires other player interaction? |
|---|---|---|---|---|
| My login | **Yes** | Addon `PLAYER_ENTERING_WORLD` / login | High (Phase 1 designed; in-game Forever pending) | No |
| My level | **Yes** | Addon `UnitLevel` / level-up event | High | No |
| My death | **Yes** | Addon `PLAYER_DEAD` + my combat log | High | No |
| My zone | **Yes** | Addon zone events + combat `ZONE_CHANGE` | High | No |
| My combat | **Yes** | My combat log | High while logging enabled | No |
| Party member login | **Situational / Likely** | Not true “login”; see join/connect via roster (`GROUP_ROSTER_UPDATE`, `UnitIsConnected`) | Medium — only while grouped | Yes — must be in my party/raid |
| Party member level | **Likely** | `UnitLevel("partyN")`, `UNIT_LEVEL` | Medium–high while grouped; Forever unverified | Yes — grouped |
| Party member death | **Situational** | Combat log player `UNIT_DIED` if in range; also `UnitIsDead` while grouped | Medium — needs proximity and/or unit token | Yes — grouped; often nearby |
| Party member zone | **Likely** | Group roster APIs (`GetRaidRosterInfo` zone field; party/raid unit position when available) | Medium while grouped; Forever unverified | Yes — grouped |
| Party combat | **Situational** | My combat log when fighting together | Medium–high in shared pulls | Yes — nearby shared combat |
| Guild member activity | **No / Weak** | Guild roster online bits only; no live leveling/combat feed | Low for scoreboard | Guild membership ≠ LAN telemetry |
| PvP kills | **Situational** | Combat log when PvP happens near me / involves me | Medium in local PvP; poor otherwise | Yes — must be observable to my client |
| Dungeon activity | **Likely / Situational** | My instance zone + encounters + party combat while together | High when we run together | Yes — enter content with me |
| Loot | **No** (for others); **Unreliable** (for me) | No good structured other-player loot API for scoreboard | Low | — |
| Achievements | **Unverified / Weak** | System chat if broadcast; not a solid pipeline | Low | Sometimes |

---

## 5. Product implications (“LAN PARTY” model)

### Best natural operating mode

1. You start Forever LAN on your PC (one-time).
2. Friends launch stock Forever.
3. You invite them to party / you form a dungeon group / you play near each other.
4. Dashboard discovers characters from **party roster + combat log names**.
5. Level race among party members updates when your client sees their levels change.
6. Deaths/kills/dungeons update when your combat log / unit APIs observe them.

### Honest limitations (accept them)

- Solo friends on the other side of the continent: **mostly invisible**.
- Full six-person independent telemetry without grouping: **impossible** under this constraint.
- “Everyone’s exact playtime while AFK in different zones”: **no**.
- Loot contests / remote achievements: **no**.

### Still a good LAN tool

If the weekend looks like “we party up and push levels/dungeons together,” one client sees most of the fun story:

- who’s in the group
- who’s higher level
- who just died on that pull
- when you entered the dungeon
- your own milestones always

If the weekend is six fully disconnected solo grinders, the dashboard mostly narrates **your** character plus whoever you happen to group with.

That tradeoff matches the new principle: **zero friction > omniscience**.

---

## 6. Recommended data model shift (conceptual only)

Keep entities simple:

- `Lan` — weekend name (“Forever LAN — November 2026”)
- `Player` — optional friendly label you assign once (“the host”, “Tom”)
- `Character` — discovered automatically when seen (name/realm/class/level)
- `Observation` / `Event` — what MY client saw, with `subject` = me or other character
- `Milestone` — only from observed events

Add an observation quality flag later if useful: `self` | `party` | `combat_proximity` | `target`.

Do **not** invent events for characters not observed.

---

## 7. Implementation consequence (do not restart from scratch)

| Layer | Action |
|-------|--------|
| Phase 1 addon | Keep; extend later with party/raid polling + `UNIT_LEVEL` |
| Phase 1 collector/host | Keep on MY PC only; drop any multi-agent packaging/docs |
| Docs | Treat multi-PC agents as abandoned |
| Phase 2+ | Design dashboard copy around “observed by host client” / “LAN party (grouped)” |
| Packet sniffing | Do not pursue |

### Suggested soft product modes

1. **Host Solo** — always works; tracks you richly.  
2. **LAN Party (grouped)** — best mode; tracks party/raid discoveries.  
3. **Proximity combat** — bonus events when friends fight near you even briefly.

No mode should require friends to touch the software.

---

## 8. What to verify next (one Forever session on YOUR PC)

Before coding the party aggregation layer, confirm in beta:

1. `UnitLevel("party1")` / class / connected while grouped.  
2. Whether `UNIT_LEVEL` fires when a party member levels.  
3. Whether party member deaths appear in YOUR `WoWCombatLog.txt` when nearby.  
4. Whether instance entry with a party yields clear zone/encounter lines.  
5. Whether Secret Values block any roster identity reads you need outdoors vs in dungeons.

Until those are checked, party rows stay **Likely / Unverified**, not “supported.”

---

## 9. Bottom line

| Question | Answer |
|----------|--------|
| Can the whole system run on my PC only? | **Yes — and it should.** |
| Can I still build a fun passive LAN board? | **Yes, especially if you party up.** |
| Can I see everything friends do while solo elsewhere? | **No — and that’s fine.** |
| Should we require friend installs for “better data”? | **No.** |
| Restart implementation from scratch? | **No.** Reframe Phase 1 as host-only; extend observation to party/combat next. |

The successful test remains:

> Six friends sit down, launch stock WoW Forever, ignore your software completely — while your PC quietly builds whatever story your client is legitimately allowed to see.
