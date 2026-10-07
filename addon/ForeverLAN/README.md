# Forever LAN

**Summary:** Saves your character's LAN-party events to local SavedVariables only — the addon never connects to the Internet.

## What this addon does

Forever LAN is a small World of Warcraft addon for a house LAN leveling weekend. It watches **your** character (and optionally remembered party friends) and queues gameplay events in WoW **SavedVariables** on disk.

**The addon never connects to the Internet.**

It does **not**:

- Connect to the Internet or upload data
- Include LAN host credentials, tokens, or host URLs
- Include the companion collector or dashboard

A separate local companion (not in this CurseForge package) can later read those SavedVariables and feed a private LAN dashboard.

## Features

- Login and level-up events
- Zone / map changes
- Approximate travel distance and jumps (sampled path length)
- Deaths and resurrections
- Profession, craft, money, and quest snapshots
- Combat time and selected loot
- Optional friend names via `/fl remember First Last` (opt-in; your character is always tracked)

Events keep their original timestamps so a local companion can catch up if the host PC was offline earlier.

## Controls

**FL** pin:

- **Left-click — Push LAN** — flush the queue to disk (UI reload). This is a disk save, not a network send.
- **Right-click — Combat Log** — send `/combatlog` once when needed.

Slash commands:

| Command | Action |
|---------|--------|
| `/fl` | Help |
| `/fl status` | Queue, last flush, combat-log state |
| `/fl roster` | Remembered names + party snapshot |
| `/fl remember First Last` | Remember a friend (opt-in) |
| `/fl forget First Last` | Remove a remembered name |
| `/fl push` | Same as left-click Push LAN |

## Install

1. Extract so `Interface/AddOns/ForeverLAN/` contains `ForeverLAN.toc` and `ForeverLAN.lua`.
2. Restart the client (or `/reload`).
3. Enable **Forever LAN** in the AddOns list.

## Privacy

- Data stays in local SavedVariables until you Push or log out.
- No network credentials in this package.
- No hardcoded weekend party roster in the public CurseForge build.
- Friend tracking is opt-in (`/fl remember`).

## Requirements

World of Warcraft (Forever / Camelot game types supported by the TOC).

## License

**All Rights Reserved** — see `LICENSE`.

Free to download and use via CurseForge. Source is visible for transparency under Blizzard’s Add-On Development Policy; that does not grant reuse, fork, or rebrand rights.

## Links

Source and issue discussion (after the description above):  
https://github.com/Nyandu-wow/ForeverLAN
