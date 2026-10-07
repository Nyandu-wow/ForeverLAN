# Forever LAN

**Offline-first telemetry for World of Warcraft: Forever.**

Forever LAN is the lightweight in-game companion for a one-weekend WoW: Forever leveling LAN.

It quietly observes your character, records useful gameplay telemetry, and saves it locally in WoW SavedVariables. A separate Forever LAN companion can then collect that data and feed a local LAN dashboard with live progress, deaths, travel, professions, milestones, and more.

**The addon itself never connects to the Internet.**

## What it records

Examples of what Forever LAN can queue locally:

- Character login and level-ups
- Zone / map changes
- Approximate travel distance and jumps (sampled)
- Deaths and resurrections
- Professions, crafts, money, and quest snapshots
- Combat time and selected loot
- Party / roster signals (your character always; friends when remembered or also running ForeverLAN)

Events keep their original timestamps so a local companion can catch up later if the host was offline.

## Built for a LAN, not a cloud service

- No server connection from the addon
- No account
- No LAN token or host URL in the public package
- No network upload from the addon
- Data stays in SavedVariables until you Push or log out
- Collection continues while the host is down

A separate local companion reads those files and talks to the LAN host.

## Push LAN

The small **FL** control:

- **Left-click — Push LAN** — write the queue to disk (UI reload). Disk flush, not a network send.
- **Right-click — Combat Log** — enable `/combatlog` once when needed (does not call the protected LoggingCombat API).

## Party tracking

Your character is always tracked.

Optional friends:

```
/fl remember First Last
/fl roster
/fl forget First Last
```

Forever names use full **First Last** identity. No hardcoded LAN player names in the public CurseForge package.

## Commands

| Command | Action |
|---------|--------|
| `/fl` | Help |
| `/fl status` | Queue, last flush, combat-log state |
| `/fl roster` | Remembered names + party snapshot |
| `/fl remember First Last` | Remember a friend |
| `/fl forget First Last` | Remove a remembered name |
| `/fl push` | Same as left-click Push LAN |

## Install

1. Extract so `Interface/AddOns/ForeverLAN/` contains `ForeverLAN.toc` and `ForeverLAN.lua`.
2. Restart the client (or `/reload`).
3. Enable **Forever LAN** in the AddOns list.

## Forever LAN pipeline

```
WoW Forever → this addon → SavedVariables → local companion → LAN host → dashboard
```

The companion and dashboard are **not** included in the CurseForge package.

## Privacy

Local collection only. No network credentials in the public addon.

## Requirements

World of Warcraft: Forever

## License

**All Rights Reserved** — see `LICENSE`.

Free to download and use via CurseForge. Source is visible for transparency; that does not grant reuse or rebrand rights.

Source: https://github.com/Nyandu-wow/ForeverLAN
