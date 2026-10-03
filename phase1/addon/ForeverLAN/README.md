# Forever LAN (WoW addon)

Offline-first telemetry addon for a **local Forever leveling LAN**.  
It observes your character (and remembered party names), queues events in SavedVariables, and never talks to the network itself.

The **dashboard / LAN host** is a **separate companion** (not included in this CurseForge package). Friends at a LAN install that companion separately.

## Install

1. Extract so you have `Interface/AddOns/ForeverLAN/ForeverLAN.toc` (and `.lua`).
2. Restart the Forever client (or `/reload`).
3. Enable **Forever LAN** in the AddOns list.

## Commands

| Command | What it does |
|---------|----------------|
| `/fl` | Help |
| `/fl status` | Queue size, last Push flush, combat-log state |
| `/fl options` | Options panel (push button, minimap, reminders) |

## Push LAN

**Push LAN does not send data over the network.**

It:

1. Snapshots your character’s pending events into SavedVariables
2. Keeps the pending queue (so a crash cannot erase unread events)
3. Reloads the UI so WoW writes SavedVariables to disk

An external collector (LAN companion) reads that file and posts events to the host when it is online.

Works without a host: events keep accumulating with original timestamps (offline-first / Friday→Saturday catch-up).

## Optional combat log

Use the **Enable Combat Log** button (or type `/combatlog` yourself).  
The addon does **not** silently turn combat logging on. On Forever, `LoggingCombat(true)` is protected; the button feeds `/combatlog` through the chat box on a real click.

## Multi-character

Each WoW character has its **own** SavedVariables file (`ForeverLANCharDB`, via `SavedVariablesPerCharacter`).
Switching characters cannot inherit another character’s pending queue — the client isolates the files.

Account-wide `ForeverLANDB` only holds UI settings (and temporary leftovers while migrating older installs).

## Privacy

This addon does not embed LAN tokens, host URLs, or network config.
