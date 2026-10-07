# CurseForge project page — paste this

Use with [CurseForge moderation policies](https://support.curseforge.com/support/solutions/articles/9000197279-moderation-policies).

Paste **Summary** and **Description** into the CurseForge project editor. Keep promotional / GitHub links at the **bottom** of the description (policy). Upload avatar `dist/curseforge/foreverlan-avatar-400.png` (400×400).

Do **not** put donation links, affiliate banners, or external download links in the description.

---

## Summary (≤ 1 sentence)

Saves your character's LAN-party events to local SavedVariables only — the addon never connects to the Internet.

---

## Description (English first)

### What Forever LAN does

Forever LAN is a small in-game helper for a **house LAN** leveling weekend. It records useful gameplay events about **your character** into WoW **SavedVariables** on your PC.

**This addon does not connect to the Internet, does not upload data, and does not include any LAN host token or companion software.**

A separate local companion (installed privately for your LAN, **not** part of this CurseForge download) can read those files later and show a private dashboard on a PC in the house.

### What it records (locally)

- Character login and level-ups
- Zone / map changes
- Approximate travel and jumps (sampled)
- Deaths and resurrections
- Professions, crafts, money, quest snapshots
- Combat time and selected loot
- Optional party friends you explicitly remember with `/fl remember First Last`

### How to use

1. Install and enable **Forever LAN**.
2. Play as usual — events queue in SavedVariables.
3. Left-click the **FL** pin (**Push LAN**) to flush the queue to disk (UI reload). That is a **disk save**, not a network send.
4. Right-click **FL** once if you need combat logging enabled for the weekend tools.
5. Optional: `/fl remember First Last` for friends you want the local companion to notice.

### Privacy

- Local SavedVariables only from this package
- No accounts, no cloud service, no credentials in the zip
- Friend names are opt-in
- The public package ships with an empty remembered roster

### Not included

The LAN host, collector, friend INSTALL packs, and dashboard are **separate**. They are not distributed through this CurseForge project.

### Changelog

See the file changelog on each upload (required for updates).

---

### Links

Source (transparency): https://github.com/Nyandu-wow/ForeverLAN

---

## Avatar checklist

- [ ] `foreverlan-avatar-400.png` — **400×400** PNG (not WebP)
- [ ] Not a solid color
- [ ] No unlicensed Blizzard key art
- [ ] No NSFW

## Upload checklist

- [ ] Zip root is `ForeverLAN/` with `.toc` + `.lua` (use `npm run` / `node scripts/prepare-curseforge-addon.mjs`)
- [ ] No `ForeverLAN_Party.lua`, no `party.json`, no tokens
- [ ] Category fits **Miscellaneous** (or closest WoW category)
- [ ] English summary + description as above
- [ ] GitHub only at the bottom of the description
- [ ] Each file update includes a changelog entry
