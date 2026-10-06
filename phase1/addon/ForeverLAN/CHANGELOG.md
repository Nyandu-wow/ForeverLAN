# Changelog

## 0.1.62

- Push LAN: re-snapshot export on logout so a mid-combat Push cannot wipe the disk queue. Cap trim drops already-flushed rows first and counts drops. Session travel/combat totals persist across reloads. Spirit-release `PLAYER_ALIVE` is not a resurrection. Coalesced snapshots drop stale fields (food buff end, secret-blocked power).

## 0.1.61

- Coalesce + pressure-drop `PLAYER_COMBAT_TIME` (same snapshot stream as distance/money) so Push exports stop minting a combat-time row every poll tick.

## 0.1.60

- Pin honesty: never claim "caught up". Badge/tooltip count real unsaved events (distance/money/zone/etc.), not only dings/deaths. Labels say "not on disk" / "saved to disk — collector sends…".
- Combat log right-click: if `LoggingCombat()` says off, clear sticky ON and allow `/combatlog` again. Do not mark ON until the game confirms.
- Coalesce remints after a Push (new id/ts) so updates are unsaved again and the host can accept them.

## 0.1.59

- Coalesce snapshot/cumulative pending rows (distance, money, map opens, power, quests, professions, …) in place — keep original `id` + `ts`, update latest fields. Cuts Push export flood without dropping high-signal events. Crafts stay one-row-per-action.

## 0.1.58

- Read architecture: one `api` table wraps WoW reads (`pcall` + secret-number strip). Unit snapshots no longer run the full position probe on every flag/poll. Compact position is attached only when a roster/zone event will be saved. The diagnostic `_position_probe` blob is gone.

## 0.1.57

- Fix: Forever rejects a *too-high* Interface the same as a wrong one — revert ceiling `16999` → exact `16001` (same as ClassicUIForever). Collector still auto-rewrites installed TOC to match peer/SV when the client moves.

## 0.1.56

- (reverted) High Interface ceiling `16999` made the addon incompatible on Forever.

## 0.1.55

- Forever-specific `ForeverLAN_Camelot.toc` + `AllowLoadGameType: camelot`.

## 0.1.54

- Fix: TOC Interface was `160001` / `120105` (wrong digits). Forever 1.60.1.70205 marks that out-of-date; use `16001, 120100` like other Forever addons.

## 0.1.53

- Fix: UnitName's second return is always the Forever surname (e.g. Sam **This**), never the realm. Realm comes from UnitFullName / GetNormalizedRealmName only.
- Roster: Sam Hill.

## 0.1.52

- Party sync: bare first-name aliases for remembered friends only (`Casey` → `Casey Brook`, `Jordan` → `Jordan Vale`). Still never aliases `Alex` (multiple alts).

## 0.1.51

- In-game UI is a tiny **FL** pin only: left-click saves to disk, right-click turns combat log on once. No meter, options panel, or minimap button.
- Quiet by default (no ding chat spam / login tips). `/fl` is short.

## 0.1.50

- Fix: main chunk was over WoW's 200-local limit after the Forever name helper land. UI forwards live in one `ui` table.

## 0.1.49

- Forever naming convention leads: names are always "First Last". Surname is taken from the name APIs unless the second return is clearly this client's realm — not gated on `RegionalUniqueNamesEnabled()`.
- Remembered roster / host config use full Forever names. A first name is not a matching key.

## 0.1.48

- Names: the full Forever name ("First Last") or GUID is the identity. A first name alone never matches a surnamed character ("Alex" ≠ "Alex River"); the remembered roster is exact full names.
- Party sync: groupmates running ForeverLAN say hello over addon comms (by GUID) and sync even if their name is not on the roster. Remembered full names still sync without the addon.
- Craft probe: only your full name counts as "you" in tradeskill chat.

## 0.1.47

- Legacy migration: an old account-wide event whose GUID differs from the character you are logged in as is never moved into that character's queue, even if the full name matches (deleted + recreated character). It stays on the account file, and the collector still delivers it.

## 0.1.46

- Live queue meter: fill bar + `current / 1500` updates as events arrive (Details-style).
- **Need save** is the Push count; memory fill is separate so a successful save does not look stuck.
- Push reminders only fire when something new actually needs saving (no more “532 queued” after a good Push).

## 0.1.45

- Meter copy for friends: **New** / **Saved** / **Board** in plain English. No sticky event totals after Push (those looked like the queue was stuck).
- Push chat no longer mentions the retained-in-memory count.

## 0.1.44

- The on-screen frame is a status meter: Waiting (memory), On disk (SavedVariables), Host (collector — this addon cannot see the network).
- One action: Push to disk. Combat log is a status line. The first click may send `/combatlog`; later clicks do nothing, so a second press cannot toggle logging off.

## 0.1.43

- Push LAN and Combat Log live in one movable meter bar (dark window, gold edge, status rows) instead of two stock screen buttons.
- Drag the title strip to move. Right-click the title for options. `/fl lock` still freezes it.

## 0.1.42

- After Push, prune **all** flushed low-value events from RAM (not only down to the soft-warn line) so the total count drops visibly.
- Push tooltip distinguishes **waiting** (needs Push) vs **retained on disk** (already flushed — Push worked).

## 0.1.41

- Queue-full reminder no longer fires after a successful Push when every pending event is already on disk (`ts <= last_flush_at`).
- After Push / reclaim, prune flushed low-value events from RAM so the queue can drop below the soft-warn line (export on disk still holds them for the collector).
- Clarifies `/fl status` when the queue is at cap but already flushed.

## 0.1.40

- Reclaim account leftovers by **event identity** even after `migrated_from_account` (schema-2 short buckets like `Alex-Realm` still held surnamed alts’ pending).
- Scan every `ForeverLANDB.characters{}` bucket event-by-event (GUID / exact full name) — do not rely on bucket key alone.
- Collector: when per-character CharDB files exist, ignore account `characters{}` and account pending with full surnames (keep bare-name / unattributed only).

## 0.1.39

- `character_key` uses Forever full name (+ realm), not bare `UnitName` first token — Alex alts no longer share `Alex-Realm`.
- After CharDB migration, scrub stale account-level `ForeverLANDB.export` / flush meta (CharDB owns Push snapshots; ambiguous pending leftovers kept).
- Host ingest: remember seen client IPs on disk so `NEW CLIENT` does not spam every host restart.

## 0.1.38

- Conservative legacy migration: GUID or exact full character (+ realm) only.
- Bare `"Alex"` is never treated as `"Alex River"` / `"Alex Brook"`.
- Ambiguous account leftovers stay on `ForeverLANDB` for the collector (not guessed into CharDB).
- Schema-2 `characters{}` buckets migrate only on exact Name-Realm / full-name keys — never `__legacy__` or short first-name keys.

## 0.1.37

- Real **SavedVariablesPerCharacter**: telemetry queue lives in `ForeverLANCharDB` (one WoW character = one SV file).
- Account-wide `ForeverLANDB` keeps settings + one-time migration leftovers.
- Migrates this character’s events out of older account-wide `pending` / `characters{}` without claiming other characters’ queues.
- Collector scans account **and** per-character `SavedVariables/ForeverLAN.lua` paths.

## 0.1.36

- Per-character telemetry queues inside account-wide `ForeverLANDB` (schema 2). Switching characters no longer shares or inherits another character’s pending queue.
- Legacy flat `pending` is migrated by `event.character` when possible; unattributed events go to a `__legacy__` bucket (not mixed into the active character).
- Fix: queue soft-warn (`maybeRemindQueuePressure`) called `chat` before it was defined — Lua nil error at ~1200 pending.
- `/fl status` shows store schema + active character key.
- CurseForge-oriented README; header docs no longer say “Host-PC only.”
- Version bump for public packaging.
