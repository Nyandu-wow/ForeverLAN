# Background wallpapers (Alliance / Horde)

**Source:** [Blizzard Press Center — World of Warcraft Forever Reveal](https://blizzard.gamespress.com/Kit/Details/wowforeverreveal)  
**Section:** *World of Warcraft Forever Reveal Faction Key Art*

| Theme | Official asset | Local web file |
|---|---|---|
| **Alliance** | `WoW_Forever_Announce_Key_Art_-_Alliance.jpg` (Horley) | `forever-lan-bg.jpg` |
| **Horde** | `WoW_Forever_Announce_Key_Art_-_Horde.jpg` | `forever-lan-bg-horde.jpg` |

**Logo:** Official `WoW_Forever_Logo` from the same kit → `wow-forever-logo-web.png` (and `wow-forever-logo-white-web.png` where needed). Full-res masters are not kept in git.

## Style notes

- **Alliance:** cool navy panels, steel-blue borders, heraldic gold — readable over bright Teldrassil / Alliance heroes.
- **Horde:** burgundy / charcoal panels, crimson frame, sunset amber gold — readable over Silvermoon / Horde heroes key art.
- Toggle lives in the nav (`ALLIANCE` / `HORDE`); preference is stored in `localStorage` (`forever-lan-faction`).

## Swap / refresh an asset

1. Download from the Forever Reveal press kit (Faction Key Art set).
2. Web-resize (~1920px wide JPEG) into `forever-lan-bg.jpg` or `forever-lan-bg-horde.jpg`.
3. Bump `?v=` on `--bg-image` in `lan-chrome.css` (and the stylesheet `?v=` on pages).
4. Hard-refresh the dashboard.
