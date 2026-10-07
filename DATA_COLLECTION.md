# Forever LAN — Data collection model

Offline-first telemetry. The Forever LAN web app may be down during play.

## Pipeline

```text
WoW
  ↓
ForeverLAN addon  →  ForeverLANCharDB.pending (SavedVariablesPerCharacter, RAM)
  ↓                    ForeverLANDB = account settings + legacy/migration leftovers
  ↓                    Push LAN / logout /reload writes SV to disk
  ↓                    (export snapshot + pending retained on CharDB)
  ↓                    optional: combat log file if /combatlog on
Collector           →  data/outbox.jsonl  (durable if host/network down)
  ↓                    reads account SV + per-character SV
Host POST /events   →  data/host-events.jsonl
  ↓
LanSession          →  /lan board (rebuild sorted by original ev.ts)
```

## What Push LAN means (plain language)

**Push LAN saves your current addon data to disk so the local collector can send it. It does not directly send anything to the host.**

Steps:

1. Addon snapshots CharDB `pending` into `ForeverLANCharDB.export`
2. **Pending is kept** (not cleared) so a second crash/reload cannot erase unread events
3. UI reload forces WoW to write SavedVariables to disk (account + per-character files)
4. Collector notices the file(s), upserts events into `outbox.jsonl` by stable `event.id`
5. Outbox POSTs to the host when reachable (`201` or duplicate `409` both count as delivered)

The addon never learns whether the host received the events. Duplicates are harmless.

## Data-loss boundary (honest)

| Boundary | What can be lost |
|----------|------------------|
| **WoW crash before Push / logout /reload** | Addon events since the last SavedVariables **disk write**. Unavoidable — there is no ForceSave API. |
| After collector has read SV into outbox | Survives host downtime, collector restart, and network blips |
| Combat log (separate path) | Continuous while `/combatlog` is on; not the same as SV persistence |

## What must survive

| Failure | Addon pending | Collector outbox | Host jsonl |
|---------|---------------|------------------|------------|
| Push LAN (reload) | **Yes — retained** on disk (+ `export` snapshot) | — | — |
| Clean logout / quit | Yes (engine writes SV) | — | — |
| Crash without logout/Push | Events since last SV write may be lost | — | — |
| Dashboard / host down | Yes | Yes (retries) | — |
| Network disconnect | Yes | Yes (retries) | — |
| Collector process restart | Yes (on disk) | Yes (`outbox.jsonl`) | Yes |
| PC restart | Yes if SV was written | Yes | Yes |

## Queue cap (addon)

Authoritative value: **`MAX_PENDING = 1500`**.

When over cap, drop `DROP_UNDER_PRESSURE` types first (distance, food buff, map clicks, power stats, money, quests, professions snapshots, crafts, pings, etc.), otherwise drop the **oldest** event. Soft chat warn at ~1200; at cap the player is told that low-value events will drop and nothing reaches the board until Push/logout. Cap is enough for a weekend if players Push at breaks; it is not raised casually.

## Modes

### 1. LIVE

Host is reachable. Collector POSTs events soon after they leave SV/combatlog. Host applies them immediately (`ingest_mode: live`).

### 2. OFFLINE / CATCH-UP

Events accumulate in:

1. Addon `ForeverLANCharDB.pending` (original `time()` stamps; per character)
2. Collector `outbox.jsonl` (if host was down after SV/combatlog read)

When the host returns, the collector drains the outbox **oldest `event.ts` first**, with header `X-ForeverLAN-Mode: catch-up` when lag > 2 minutes (or explicit mode).

Host:

- Stores `host_received_at` for ops only
- **Never replaces event time with ingest time**
- Debounced **catch-up rebuild** sorts the full log by `ev.ts` and rebuilds the board

## Timestamp rule (critical)

```text
Event occurred:   Friday 22:01:48   →  event.ts
Uploaded:         Saturday 14:32:11 →  host_received_at only
Board / race / replay always use Friday 22:01:48
```

## Idempotency

Every event has a stable `id`. Collector outbox upserts by id. Host duplicates return HTTP **409** (treated as success). Safe to re-Push SV or re-drain the outbox.

## SavedVariables poll (collector)

- Prefers `export` string; falls back to Lua `pending`
- **Schema 3:** reads `ForeverLANCharDB` from per-character  
  `WTF/Account/<acct>/<realm>/<char>/SavedVariables/ForeverLAN.lua`
- Still reads account-wide `WTF/Account/<acct>/SavedVariables/ForeverLAN.lua` for settings leftovers / older schemas (`ForeverLANDB`, including schema-2 `characters{}`)
- Merges/dedupes by `event.id` across both files
- Unchanged file content (fingerprint) is not reprocessed
- Partial / mid-write files are **not** treated as empty success — prior good state kept, retry next poll, throttled log
- Event dedupe by id across repeated Push snapshots

## Outbox guarantees

- Append-only for new rows; compaction uses unique temp file + verified replace (Windows-safe overwrite)
- Rewrite failure leaves the original file intact
- Startup truncates only an incomplete **final** line; complete earlier rows are kept
- Host outage never stops collection into the outbox
- **One collector per data directory** (`collector.lock`) — a second start exits quietly instead of racing the outbox
- Friend agent will not spawn a second collector while the lock is held

## Operator checklist

1. Enable ForeverLAN addon; type `/combatlog` once per session for continuous deaths/zones.
2. Click **Push LAN** periodically (or at breaks) so SavedVariables flush to disk.
3. `/fl status` shows queue size, last flush, and export size in RAM.
4. Leave collector + host running when you can; if not, outbox + SV catch up later.
5. After catch-up, refresh the TV board — race history uses original times.
