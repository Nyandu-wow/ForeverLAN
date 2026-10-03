# Steam Deck as a Forever LAN client

The Windows friend zip (`INSTALL.bat`) does **not** run on SteamOS. Use the Deck pack instead: same host (the host PC), Deck only sends events.

## On the host PC (host-pc)

1. Admin once: `phase1\scripts\open-lan-firewall.bat`
2. `phase1\scripts\start-weekend.bat`
3. Confirm: `weekend-status.bat` → HOST UP, DISCOVER OK, note LAN IPv4 (e.g. `192.168.50.156`)
4. Build Deck zip: `phase1\scripts\prepare-steamdeck-zip.bat` → `phase1\dist\ForeverLAN-SteamDeck.zip`
5. Deck and PC on the **same Wi‑Fi** (not guest / client isolation)

## On the Steam Deck

1. **Desktop Mode** → Konsole  
2. Copy **`ForeverLAN-SteamDeck.zip`** onto the Deck and unzip it  
3. From that folder:

```bash
bash install-steamdeck.sh
```

(`bash …` avoids chmod / executable-bit issues after unzip. `./install-steamdeck.sh` also works when the zip preserved Unix modes.)

If WowB.exe isn’t found automatically, pass the Forever client folder (the one that contains `WowB.exe`, usually `_classic_beta_`):

```bash
bash install-steamdeck.sh "/home/deck/Games/Forever/WoW/World of Warcraft/_classic_beta_"
```

The installer also searches `~/Games/Forever`, `~/Games`, and Steam Proton `compatdata` paths automatically.

Typical Proton layout:

`~/.steam/steam/steamapps/compatdata/<id>/pfx/drive_c/Program Files (x86)/World of Warcraft/_classic_beta_`

4. In WoW: enable **ForeverLAN** → `/reload` (optional: `/combatlog`, **Push LAN**)  
5. Play

The script installs the addon into that client, uses the bundled Linux Node under `runtime/bin/node` (copied to `~/.local/share/ForeverLAN`), and starts the silent agent (collect → outbox → discover → flush to host). Clipboard push is Windows-only; Deck relies on **SavedVariables** + combat log.

## Verify on the host

`weekend-status.bat` or `ForeverLAN-data\ingest.log` — you should see the Deck’s LAN IP as **NEW CLIENT**, then LIVE / CATCH-UP lines.

## Stop / remove

```bash
kill "$(cat ~/.local/share/ForeverLAN/data/watchdog.pid 2>/dev/null)" 2>/dev/null
kill "$(cat ~/.local/share/ForeverLAN/data/agent.pid 2>/dev/null)" 2>/dev/null
rm -rf ~/.local/share/ForeverLAN
rm -f ~/.config/autostart/foreverlan-agent.desktop
# Addon: delete Interface/AddOns/ForeverLAN under the same Wow client folder
```
