# Forever LAN — friend client (plug and play)

Friends should **not** run Node commands, edit JSON, or open hosting docs.

## What friends do

1. Unzip the pack the host sends
2. Double-click **`INSTALL.bat`**
3. When asked, **pick your WoW: Forever folder** (the one with `WowB.exe`, usually `_classic_beta_` — or the parent `World of Warcraft` folder)
4. In WoW: enable **ForeverLAN**
5. Play

**Steam Deck:** see [`STEAMDECK.md`](STEAMDECK.md) — the host builds `ForeverLAN-SteamDeck.zip` (`scripts\prepare-steamdeck-zip.bat`); on Deck run `install-steamdeck.sh` instead of `INSTALL.bat`.

The installer copies the addon, starts a silent background agent, and adds it to Windows Startup. A tiny watchdog restarts the agent if it crashes (and the agent restarts the collector). Collection starts immediately into a local outbox even if the Forever LAN host is offline. Discovery runs in the background; when the host appears, the agent reconnects and flushes the backlog with original event timestamps (Friday → Saturday catch-up).

Optional in-game (still no PC setup): `/combatlog` once · **Push LAN** after sessions.

## Uninstall (restore PC)

After the weekend, double-click **`Uninstall.bat`** (in the zip, or **Uninstall Forever LAN** on the Desktop after install).

Removes:

- Silent agent + `%LOCALAPPDATA%\ForeverLAN`
- Windows Startup entry
- Desktop uninstall shortcut
- `Interface\AddOns\ForeverLAN`
- `WTF\...\SavedVariables\ForeverLAN.lua` (+ `.bak`)

Does **not** remove WoW, other addons, combat logs, or a system-wide Node install.

## What the host does (once)

```bat
cd <repo root>
scripts\prepare-friend-zip.bat
```

Or: `node scripts/prepare-friend-pack.mjs`

Creates:

- `dist/ForeverLAN-Friends/` (folder)
- `dist/ForeverLAN-Friends.zip` ← **send this**

Contains addon, portable Node, silent agent, token from your `config.json`.

Do not publish the zip (weekend token inside).

Host must be running on the LAN with firewall open (`scripts\open-lan-firewall.bat`) so agents can discover `/discover` and POST `/events`.

**Weekend lock:** once friends have installed, treat the addon + `lanToken` as FINAL. The host can still update the host/dashboard (`CLIENT_CONTRACT.md` / `restart-host.bat`) without redistributing zips.

Host backup anytime: `scripts\backup-weekend-data.bat` → `backups/`.

Host weekend start: `scripts\start-weekend.bat` (host + his collector).

Clean slate (after backup, host stopped): `scripts\reset-weekend-data.bat`.

Full host checklist: [`HOSTING.md`](../HOSTING.md).
