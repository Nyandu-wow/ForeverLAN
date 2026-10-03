# Forever LAN — frozen client contract (weekend lock)

When the LAN weekend starts, **friend addons + friend agents are FINAL**.
the host may still restart or update the **host / dashboard** on his PC.

Friends must keep working through short host downtime (outbox + retry + rediscover).

## Locked ingest surface (do not break)

| Piece | Contract |
|-------|----------|
| `POST /events` | JSON body; requires `id` + `type`; auth `x-foreverlan-token` (or Bearer) |
| Success codes | `201` created, `409` duplicate (treat as OK), `200` ignored smoke |
| Event time | `ts` = unix seconds (original); never rewrite on host |
| Catch-up | header `x-foreverlan-mode: catch-up` **or** `ts` older than ~120s |
| Unknown fields | **ignored / stored as-is** — never reject solely for extra keys |
| Unknown `type` | **accepted and stored** — dashboard may ignore for display |
| Body size | ≤ **1 MiB** (normal addon events are tiny) |
| `GET /discover` | `{ ok, v: 1, service: "foreverlan", httpPort, tokenRequired, … }` — extra keys OK |
| `GET /health` | `{ ok, ready, … }` — extra keys OK |
| Token | **same `lanToken` all weekend** — changing it orphans every friend zip |

`ingest_api: 1` on `/discover` and `/health` marks this contract. Bump only if you intentionally ship a breaking friend-agent change (not mid-weekend).

## Safe to change mid-weekend (host only)

- Dashboard HTML/CSS/JS under `host/public/`
- Host analytics / board layout / labels / Wrap copy
- New **derived** metrics from existing events
- Ingest log wording, SSE payload extras (clients ignore unknown JSON keys)
- Restart host (`scripts\restart-host.bat`) — friends queue locally, then catch up

## Unsafe mid-weekend (breaks frozen clients)

- Changing `lanToken` in `config.json`
- Requiring new headers / new required event fields
- Removing or renaming `POST /events`, `GET /discover`
- Returning non-2xx for valid duplicate ids (must stay `409` or `201`)
- Rebuilding / redistributing friend or Steam Deck zips with a new token
- Wiping `host-events.jsonl` / reset-weekend while the race is live (unless intentional)

## Addon

The WoW addon only writes SavedVariables / combat log. It never talks HTTP.
Updating the host **cannot** break the addon binary — only the collector↔host HTTP path can.

See [`HOSTING.md`](HOSTING.md) § “Hot-update host mid-weekend”.
