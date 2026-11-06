# Changelog

## 0.1.83

- Record game-confirmed Honorable Kill chat credit separately from combat-log PvP kills. Saved cumulative counters survive reloads and do not add duplicate credit on replay. Bonus honor is excluded; tracking starts with this update.

## 0.1.82

- Clearer adventure-log chat, tooltips, help and status. Push reports new saved entries; saved history is explained separately from uploads.

## 0.1.81

- In-game adventure-log messages explain local saves and companion delivery in plain language. Push shows new entries; /fl status explains saved history separately.
- Long hardcore leveling: reminder threshold 5000 (was 1500); softer Push/queue chat cadence.
- Still never deletes queued observations for space.
- Slightly calmer self/travel polling and distance/jump sampling; zone transitions still logged.

## 0.1.80

- Stop discarding observations when the local queue is large; 1500 is a Push reminder only.
- Receipt-bridge cleanup left off (disk save ≠ host delivery).

## 0.1.78

- Wait for a valid player GUID and name before emitting quest-progress snapshots, avoiding malformed observations around login/logout.
- Companion status writes retry transient sharing locks without overwriting the prior valid status; failed process checks no longer fabricate WoW exits.

## 0.1.77

- Loot capture accepts both legacy colour links and named item-quality links.
- Uncached item data or an unavailable item-info API no longer blocks capture when the link explicitly supplies rare/epic quality.
- Regression coverage checks self-only rare/epic capture and ignores unknown-quality items.

## 0.1.76

- Keep saved telemetry across repeated reloads and logouts while the collector is offline; only the bounded queue cap can evict rows.
- Track saved event IDs explicitly so same-second events remain unsaved in the pin, Push summary, and coalescing logic. Event timestamps and IDs retain their existing format.
- Preserve sampled location transitions instead of replacing all unflushed locations with the latest subzone.
- Add shipping Lua 5.1 queue/reload regression tests and public CI checks.

## 0.1.75

- Client stamp: Forever beta **1.60.1.70374** (Oct 13–15). No new Kaivax gameplay notes since Oct 8; Interface stays **16001** (matches ClassicUIForever + SavedVariables `toc_version`)
- Coalesce PLAYER_LOCATION pending rows (with XP snapshots) under queue pressure
- Keep `craftProbeIsSelfMessage` for `CHAT_MSG_TRADESKILLS` → `PLAYER_CRAFT` (self vs other-player filter). Optional `/fl craftprobe` diagnostic stays unwired; the self-message helper is not dead code.

## 0.1.74

- PLAYER_XP_SNAPSHOT: observed XP / max / session-observed gain from UnitXP (no invented XP/hour)
- PLAYER_LOCATION: zone + subzone snapshots (bounded so zone-border flicker does not spam)
- Host: observation pipeline + Live “Weekend Adventures” party goals / journals (Counted from existing events)

## 0.1.73

- Instance enter/leave events include zone; host Live/Wrap surface dungeons (Dalaran, dungeon deaths, lookback)
- Honesty: Live hero says "IN DUNGEON" (not invented XP)

## 0.1.72

- Push summary survives reload: saved to CharDB, printed in chat ~1s after UI comes back (pre-reload chat was wiped by ReloadUI)

## 0.1.71

- Push LAN chat feedback: how many new events hit disk, type breakdown, total for collector, left unsaved (honest: disk flush; collector/host after reload)

## 0.1.70

- Split the addon into smaller load-order files (same behavior)
- TOC lists Core, Telemetry, Group, UI, and Events modules

## 0.1.69

- CurseForge storefront copy aligned with moderation policies (local SavedVariables wording; no “cloud telemetry” framing)
- TOC Notes clarify: disk-only, never connects online
- Paste-ready project listing documented in repo `CURSEFORGE_LISTING.md`
- 400×400 project avatar generated for upload (`dist/curseforge/foreverlan-avatar-400.png`)

## 0.1.68

- License set to **All Rights Reserved** (matches common CurseForge WoW addon practice; still free to download and use).

## 0.1.67 — Public CurseForge release

### Changed

- Empty remembered LAN roster by default (no hardcoded player names)
- `/fl remember First Last`, `/fl forget First Last`, `/fl roster`
- Friend/INSTALL packs may ship a separate optional roster file; not in the CurseForge package

### Notes

- Push LAN writes SavedVariables and reloads; the addon does not upload
- Companion/dashboard are separate products
- No LAN credentials or host config in this package

## Previous releases

### 0.1.66

- CurseForge packaging and public docs cleanup
- Cleaned addon comments and debug craft-probe remnants

### 0.1.65

- Faster travel sampling for mounted movement

### 0.1.64–0.1.60

- Event-queue hardening, Push honesty, combat-log handling, queue coalescing

### 0.1.59–0.1.48

- Forever full-name identity and party sync improvements

### 0.1.47

- Legacy migration hardened so deleted/recreated characters cannot inherit another queue

### 0.1.37

- Per-character SavedVariables event queues
- Migration from older account-wide storage
