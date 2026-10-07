# Changelog

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
