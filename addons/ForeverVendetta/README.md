# Forever Vendetta

A small, standalone **WoW Forever / Camelot (Interface 16001)** addon for a private group of friends. Keep enemy reports, share reasons, and hear a warning when a listed enemy becomes visible.

**Version 0.1.2 — redesigned interface, awaiting in-game validation.**

## Install

Extract `ForeverVendetta-0.1.2.zip` into the Forever client's `Interface/AddOns/` directory. The result must be `Interface/AddOns/ForeverVendetta/ForeverVendetta.toc`, alongside four Lua files. Restart WoW if it was running when you installed the folder, then enable Forever Vendetta in AddOns.

No Node.js, local service, external account, companion, or other addon is required. ForeverLAN can remain frozen or disabled.

## First session

1. Both friends install and enable this addon on Alliance characters on the same realm.
2. Open `/fv`, click **Friends**, and enter each other's **full character names, including surnames** (`First Last`). `First-Last` is the same character. Both players must do this; friendship on Battle.net does not configure the addon.
3. On **Blacklist**, target an enemy player and click **Add target**. The editor fills their full name. Add a reason, choose **Avenge**, **Avoid**, or **Watch**, and click **Save report**.
4. The friend receives that report while both characters are online and addon messaging is available. **Sync with friends** on the Friends tab queues reconciliation; periodic checks also run every two minutes.
5. Enable **enemy nameplates** and **Always show nameplates** in the game's options. A matching enemy on a nameplate, target, focus, or mouseover triggers a built-in raid-warning sound on the Master channel, a six-second banner, and a chat message. The normal sound settings and global audio mute still apply.

Open **Alerts** and use **Preview alert** before meeting an actual listed enemy. Sound, banner, instance warnings, and the repeat-warning slider are all on that tab. The default cooldown is 60 seconds per enemy across all detection sources.

## Using the window

- **Blacklist:** each enemy has one row, even when several friends report them. Search names, reporters or reasons, and filter by Avenge, Avoid or Watch. Mixed reports are labelled explicitly. Click a row to read every authored reason in the scrollable history and edit your own report alongside it.
- **Your report:** choosing a friend's enemy does not copy their reason into yours. Use **Add enemy** for manual entry or **Add target** for the selected enemy. Feedback appears inside the window; incoming sync updates preserve your unsaved text.
- **Withdraw mine:** click once, then **Confirm removal**. This withdraws only your current character's report. The enemy remains listed if a friend still has a report.
- **Friends:** enter a full character name, then ask that friend to add the character name shown in the setup panel. Removing a friend also takes a second click to confirm. Received-report labels do not claim the friend is currently online or that trust is mutual.
- **Alerts:** check the warning options, adjust the cooldown, and preview the result. Enemy-nameplate setup guidance is beside the controls.

Drag the title bar to move the window. It scales to fit narrow or short screens, and Escape closes it. Native WoW buttons and fonts are used with dark panels and gold selection indicators. Visual references: [Auctionator](https://www.curseforge.com/wow/addons/auctionator), [Leatrix Plus](https://www.curseforge.com/wow/addons/leatrix-plus), and [Baganator](https://www.curseforge.com/wow/addons/baganator). No code or assets were copied from these addons.

## What is shared

Each character owns one report per enemy: identity, reason, stance, and revision. Multiple friends can report the same enemy independently. The list shows the reporting character, and an alert mentions additional reports. These are friends' reports, not a verified threat rating.

Click a row to view all reports and load **your own** existing report into the editor. Saving creates or updates your report. **Withdraw mine** removes your current character's report; another friend's report on that enemy remains. Repeated synchronization never adds duplicate reports or increments a kill count.

Sharing uses hidden WoW addon **whispers**, exclusively to the characters you explicitly trust. The whisper is addressed to the full name `First Last`. Only messages from trusted senders are accepted. The author is the game's sender (`First Last` or `First-Last`); a hyphen there is the surname, not a realm. There are no public chat announcements. Removing a trusted friend stops future sharing to that character and removes their received reports from the local list.

This initial version supports up to 20 trusted characters on the same realm and 200 enemy records per author, including remembered removals. Tombstones are retained permanently so an older packet cannot restore a removed entry. Updating an existing record is still allowed at the limit.

## Offline and alt behavior

- Everyone keeps a local copy in `ForeverVendettaDB` SavedVariables. WoW saves it at logout or `/reload`; a crash can lose changes since the last save.
- A friend who was offline catches up once **both original characters are online together** and messaging is available. Reports are sent directly by their authors; this version does not relay Alice's report through Bob to Charlie.
- Lists and trust settings are stored account-wide, separated by realm. Your alts can view locally saved reports, but each character authors and shares its own reports. Friends must trust the specific characters they share with.
- WoW messaging restrictions can delay updates. Messages wait during detected messaging lockdown; periodic reconciliation repairs missed packets. There is no delivery receipt or promise of immediate sync. `/fv status` shows pending messages.
- Do not delete SavedVariables to clean the list: that also deletes revision history. Use **Withdraw mine** to remove your report.

## Detection boundaries

Warnings require a readable full name. On current Forever, `UnitName`, `UnitNameUnmodified`, and `UnitFullName` return a first name and a surname; that second value is not a realm. The realm stored with a report comes from `GetNormalizedRealmName` or `GetRealmName`. `GetUnitName` supplies `First Last` when it is readable. If any of those calls returns a secret, the unit is skipped. A first name alone is ignored. This is visible-unit detection, not a zone-wide radar; it cannot find hidden enemies, reveal stealth, or guarantee a particular detection distance. Secret or inaccessible values are skipped. A new report can trigger a warning for a currently visible enemy on the next one-second scan.

Alerts are disabled inside instances by default. `/fv instances on` opts in to supported visible-unit detection there; client restrictions still apply. The addon never targets or attacks for you and does not access the combat log. Kills and deaths are not automatically attributed or counted. For now, put details such as “camped me three times” in the reason.

## Commands

- `/fv` or `/vendetta`: open or close the blacklist.
- `/fv friends`: configure trusted friends.
- `/fv target reason`: report the selected enemy, defaulting to AVENGE.
- `/fv add First Last; reason`: manually report an enemy on your realm.
- `/fv remove First Last`: withdraw your current character's report.
- `/fv trust First Last` / `/fv untrust First Last`: manage a trusted character.
- `/fv sync`: queue synchronization with trusted friends.
- `/fv sound on` / `off`, `/fv banner on` / `off`: configure warnings.
- `/fv cooldown 60`: choose 10–600 seconds between warnings per enemy.
- `/fv instances on` / `off`: configure instance alerts.
- `/fv test`, `/fv status`, `/fv help`: test, diagnose, or view help.

Names are bounded to 64 bytes, realms to 48, and reasons to 96. Oversized text is rejected rather than cutting a UTF-8 character. Pipes/control characters are replaced with spaces. No third-party source code, libraries, or media are shipped. Concept references: [Playgu](https://www.curseforge.com/wow/addons/playgu-kill-on-sight), [Spy Forever](https://www.curseforge.com/wow/addons/spy-forever).

## In-game acceptance check

The source has an offline mocked-API regression suite, which cannot prove Forever client compatibility. Before relying on the addon:

1. On two clients, mutually trust your full character names and add a report on A. Verify B receives the author, reason and stance.
2. Add a report while B is offline. Reconnect B while A is online, sync, and verify catch-up.
3. Withdraw A's report while B is offline. Reconnect and verify it disappears from B. A separate report created by B should remain.
4. With enemy nameplates enabled, encounter the named enemy. Verify sound and banner once, including when switching from nameplate to target or mouseover.
5. Toggle sound/banner, test the alert, and verify settings and list after `/reload`.
6. Check `/fv status` and Lua errors if whispers or unit identities behave differently on the current client. Exact whisper-name syntax and secret-value handling need this client test.

Development tests live in `tests/vendetta/run.lua` at repository root. Run with Lua 5.1 or later from the repository root: `lua tests/vendetta/run.lua`. The build was also exercised with the Fengari development interpreter; it is not an addon dependency.

To rebuild the ZIP on Windows, run `powershell -File addons/package-vendetta.ps1` from repository root. The output is `addons/dist/ForeverVendetta-0.1.2.zip`; its payload is only the addon, README, and license.
