# Forever LAN — Telemetry transport investigation

Date: 2026-09-21  
Scope: Host PC addon → collector only (problem A). Friend observation (problem B) stays host Unit\* APIs.

## 1. Why SavedVariables currently need manual interaction

WoW (and Forever) only serializes `## SavedVariables` **from memory to disk** on:

- logout / disconnect / quit
- UI reload (`/reload` or `C_UI.Reload()`)

There is **no** `ForceSaveAddonSavedVariables` API.  
`persistPending()` in ForeverLAN only updates the in-memory `ForeverLANDB` table. The collector reads the **on-disk** file:

`WTF/Account/<id>/SavedVariables/ForeverLAN.lua`

So without reload/logout, the collector never sees new events — even though the addon already queued them.

## 2. Can SavedVariables flush automatically?

| Approach | Possible? | Notes |
|----------|-----------|--------|
| Timer calling save-to-disk | **No** | Engine does not expose it |
| `C_UI.Reload()` on a timer | **No** | Requires a **hardware event** (click/keybind) |
| `C_UI.Reload()` from Push button / keybind | **Yes** | One user gesture; still not zero-touch |
| Logout | **Yes** | Automatic at session end only |

**Verdict:** Fully automatic SV flush without any player gesture is **not available** in the Forever addon sandbox.

## 3. Continuously readable local logs

| Facility | Continuous? | Forever status |
|----------|-------------|----------------|
| `Logs/WoWCombatLog*.txt` | **Yes**, while combat logging is on | **Verified** — large timestamped file exists (`WoWCombatLog-MMDDYY_HHMMSS.txt`) |
| `LoggingCombat(true)` from addon | Would enable CL | **Blocked** (Action Blocked) — player must type `/combatlog` once |
| Chat log | Only if chat logging on | Not relied on |
| Client/General/Aurora logs | Engine internals | Not a structured telemetry API |
| Clipboard | Instant | **Blocked** even from button click |

**Gap found:** Collector was watching only `WoWCombatLog.txt` (tiny/stale). Forever’s live file is the **timestamped** combat log. Fixing discovery gives continuous deaths/zones/kills without `/reload`.

## 4. Direct addon → localhost HTTP?

**No.** Addons cannot open TCP/HTTP sockets. Collector/host HTTP remains outside the client.

## 5. Addon communication (AceComm / SendAddonMessage)?

| Use | Useful? |
|-----|---------|
| **A — client → Windows collector** | **No** — messages stay in-game unless somehow logged |
| **B — friend → host client** | **Later, only if Unit\* gap** — AceComm + ChatThrottleLib for size/throttle |

Do **not** add a friend addon or Ace3 unless a real observation gap appears. Host-only Unit\* remains preferred for B.

## 6. CurseForge patterns (reference only — no code copied)

| Pattern | Relevance |
|---------|-----------|
| **AceDB / SavedVariables** | Durable in-memory store; same disk flush limits |
| **AceComm + ChatThrottleLib** | Party/guild sync later; not egress to Windows |
| **LibDataBroker** | UI data providers — not transport |
| **Combat-log companions** (WCL-style) | Continuous file tail is the established external-tool pattern |
| **DLL / memory hooks** | Rejected — not legitimate for this project |

Libraries: **do not introduce Ace3 yet** — current addon is small; AceComm only if friend-addon transport is required later.

## 7. Recommended architecture (hybrid)

```text
                    ┌─ continuous ─────────────────────────────┐
Forever client ──► │  Combat log file (after one /combatlog)   │──► collector tail
                    │  ZONE / DEATH / PARTY_KILL / encounters   │
                    └──────────────────────────────────────────┘

                    ┌─ durable batch (gesture or logout) ──────┐
ForeverLAN addon ─►│  ForeverLANCharDB.pending (per character) │──► collector poll
                    │  ForeverLANDB = settings + legacy leftovers│
                    │  LEVEL / ROSTER / POSITION / ONLINE       │
                    │  Push LAN button = save + C_UI.Reload()  │
                    └──────────────────────────────────────────┘

collector outbox (dedupe by id) ──► host event store ──► dashboard
```

**Problem A (my client → collector):**  
- Continuous path = combat log (one `/combatlog` per session).  
- Rich path = SV + one-click Push→Reload (or logout).  
Zero-touch for **all** event types is not possible without a future Forever API or an invasive companion (not recommended now).

**Problem B (friends → my client):** keep host Unit\*; AceComm only if needed later.

## 8. What we implemented as the smallest reliable improvement

1. **Collector** follows the newest `WoWCombatLog*.txt` and parses Forever’s timestamp format.  
2. **Addon** Push LAN / `/foreverlan push` → persist + **`C_UI.Reload()`** (hardware click) — no separate `/reload`.  
3. Larger pending buffer; combat-log status hint; capability flags for future probes.  
4. Keep SV path intact — no rewrite.

## Manual actions remaining (honest)

| Action | Frequency | Why |
|--------|-----------|-----|
| Type `/combatlog` once after login | Once per session | Addon cannot enable it |
| Click **Push LAN** (or logout) | When you want level/roster/position on the board ASAP | SV disk flush needs a gesture |

Everything else (collector, host, combat-log-derived events) should run without further interaction.
