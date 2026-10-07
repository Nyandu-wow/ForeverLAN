# Forever LAN

**Offline-first telemetry for a one-weekend World of Warcraft: Forever leveling LAN.**

Forever LAN is a local companion stack: a quiet WoW addon, optional friend collectors, and a host dashboard on one PC at the house. Not a SaaS product. Not a cloud analytics service.

```
WoW Forever → Forever LAN addon → SavedVariables
  → local companion/collector → LAN host → dashboard
```

**The WoW addon never connects to the Internet.** Push LAN writes SavedVariables to disk. A separate companion reads those files when the host is up — including Friday→Saturday catch-up with original event timestamps.

## Products (keep them separate)

| Deliverable | What it is | Where |
|-------------|------------|--------|
| **CurseForge addon** | Generic offline telemetry pin — empty roster, no tokens | `phase1/dist/curseforge/ForeverLAN-*.zip` |
| **Friend / Deck pack** | Addon + collector + agent + `party.json` (private) | `prepare-friend-pack` / `prepare-steamdeck-pack` |
| **Host** | LAN dashboard + ingest on the host PC | `phase1/host` |

Do **not** publish friend/Deck zips publicly — they can contain a `lanToken`.

## CurseForge addon (public)

Lightweight in-game foundation for the LAN:

- Character and level progression
- Zone / map changes
- Approximate travel (sampled)
- Deaths / resurrections
- Professions, money, quests, combat time, selected loot
- Optional party names via `/fl remember First Last`

Install from CurseForge, or build with:

```bash
node phase1/scripts/prepare-curseforge-addon.mjs
```

### Upload to CurseForge (API)

1. Create a token: https://www.curseforge.com/account/api-tokens  
2. Copy `.env.example` → `.env` and set `CURSEFORGE_API_TOKEN`  
3. Copy `phase1/curseforge.example.json` → `phase1/curseforge.json` and set `projectId`  
4. List game version IDs: `npm run upload:curseforge:versions --prefix phase1`  
5. Put matching `gameVersionIds` (or names) in `curseforge.json`  
6. Upload: `npm run upload:curseforge --prefix phase1`  

Dry run: `npm run upload:curseforge:dry --prefix phase1`  
Never commit `.env` or `curseforge.json`.

In game: quiet **FL** pin — left-click Push (disk flush), right-click combat log once. `/fl status` · `/fl roster` · `/fl help`.

## Host (house LAN)

1. Configure `phase1/config.json` (see `config.example.json`). Prefer LAN-only modes for the weekend.
2. Start the host (`node phase1/run.mjs` or your start script).
3. Open `http://127.0.0.1:8765/`.

Friends install the private friend zip, enable the addon, and Push LAN at breaks. Discovery never gates local collection.

## Honesty

Dashboard metrics use **Logged / Counted / Guessed**. Distance is sampled path length, not a GPS odometer. Never invent unavailable Forever data (e.g. XP/hour).

## Repo map

| Path | Role |
|------|------|
| `phase1/addon/ForeverLAN` | Public addon source (CurseForge) |
| `phase1/friend-client` | Friend agent + optional `ForeverLAN_Party.lua` for INSTALL packs |
| `phase1/collector` | SavedVariables / combat-log collector |
| `phase1/host` | LAN dashboard + ingest |
| `phase1/scripts` | Pack builders and smokes |

## License

Original code: **All Rights Reserved** (`LICENSE`). Free to download and use; no permission to resell or rebrand. Blizzard art and zone stills are separate — see `NOTICE`.

Addon source (for transparency): https://github.com/Nyandu-wow/ForeverLAN
