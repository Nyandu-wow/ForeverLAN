# Hosting — Forever LAN on the event LAN

One host PC (the host) runs the dashboard and receives events.
Friends use **plug-and-play install** ([`friend-client/README.md`](friend-client/README.md)) — they do not configure URLs.

```text
Friend: INSTALL.bat → silent agent
           │
           ├─ collector starts NOW → local outbox (always)
           └─ discover loop (parallel) ──► Host :8765 /discover
                                           then POST /events (flush backlog)
```

Discovery is **not** required before collecting. If the host is down (Friday night), friends still queue telemetry; Saturday bring-up flushes catch-up with original `ev.ts`.

## A. Host PC (the host) — weekend checklist

1. **Firewall once** (Admin): `phase1\scripts\open-lan-firewall.bat`
2. **Start for the weekend:** `phase1\scripts\start-weekend.bat` (host + your collector)
3. **Confirm:** http://127.0.0.1:8765/health and http://127.0.0.1:8765/discover
4. **Friend zip (Windows):** `phase1\scripts\prepare-friend-zip.bat` → `phase1\dist\ForeverLAN-Friends.zip`  
   **Steam Deck zip:** `phase1\scripts\prepare-steamdeck-zip.bat` → `phase1\dist\ForeverLAN-SteamDeck.zip`  
   Send privately (token inside — do not publish)
5. **Backup anytime:** `phase1\scripts\backup-weekend-data.bat`
6. **Clean slate** (host stopped): `phase1\scripts\reset-weekend-data.bat`

Live board shows **ingest** freshness (are agents pushing?) vs **game** event time.

**Who's talking to the host:** watch the ForeverLAN-host console, or open `C:\Games\FOREVER\ForeverLAN-data\ingest.log` (your configured `dataDir`). You’ll see first-time client IPs (discovery or push), live events, catch-up drains, and rejected tokens. Duplicate retries stay quiet on purpose.

**Quick status:** `phase1\scripts\weekend-status.bat` — host up?, `/discover` OK?, LAN IPs, last ingest lines.

Optional smoke: `node phase1/scripts/smoke-friend-ingest.mjs` from a second machine (or same PC) to verify `POST /events`.

## B. Friends

Unzip → double-click **INSTALL.bat** → pick WoW: Forever folder → enable ForeverLAN in WoW.  
After the LAN: **Uninstall Forever LAN** (Desktop) or `Uninstall.bat`.

**Steam Deck / SteamOS:** Windows `INSTALL.bat` will not run. Use [`friend-client/STEAMDECK.md`](friend-client/STEAMDECK.md) (`install-steamdeck.sh`) — same host, Linux agent + addon in the Proton WoW folder.

## C. Optional hostname / remote beta (push-only)

On the house LAN, agents find the host via beacon + `/discover` — no hostname required.

**Remote friend beta** (same stack, WAN via Cloudflare Tunnel — **ingest only**): see [`cloudflare/README.md`](cloudflare/README.md).

1. One-time: tunnel `foreverlan` + DNS for `foreverlan-ingest.example.com` (run `cloudflare/setup-tunnel.ps1`)
2. `config.yml` ingress = ingest hostname only — **do not** publish `foreverlan.example.com` for push tests
3. `config.json`: `"remoteSecurityMode": "wan"`, `"ingestPublicHostname": "foreverlan-ingest.example.com"`, `"friendHostUrl": "https://foreverlan-ingest.example.com"`
4. Rebuild Friends zip; session: `scripts\start-remote-beta.bat`
5. Verify: `node scripts/test-remote-security.mjs` and `--live-wan` when the tunnel is up
6. Watch the board at `http://127.0.0.1:8765/` — stop the tunnel when not testing

Cloudflare Access on a remote dashboard hostname is **optional later** only — see [`cloudflare/access-policy.md`](cloudflare/access-policy.md).

House LAN weekend: omit / turn off `remoteSecurityMode`, clear `friendHostUrl`, use `start-weekend.bat` only (tunnel off). `config.example.json` is LAN-first; use `config.remote-beta.example.json` only for a remote ingest experiment.

## Required

- No cloud DB / automatic Internet upload / WAN port forwarding for the house LAN product path
- Data stays on host disk; `POST /events` token-authenticated (`lanToken`)
- Cloudflare Tunnel + Access is for remote beta only — not the house-LAN default

See also [`DATA_COLLECTION.md`](DATA_COLLECTION.md) and [`CLIENT_CONTRACT.md`](CLIENT_CONTRACT.md).

## D. Hot-update host / dashboard mid-weekend (addon stays FINAL)

Friends keep the zip they installed. You may still ship board/host fixes on the host PC.

1. **Do not** change `lanToken`, regenerate friend zips, or reset weekend data.
2. Optional backup: `scripts\backup-weekend-data.bat`
3. Restart **host only** (keeps friend agents alone): `scripts\restart-host.bat`  
   Or full local stack: `scripts\restart-weekend.bat` (also restarts *your* collector).
4. Confirm: http://127.0.0.1:8765/health → `ok` + `ready`, and `/discover` still returns `v: 1` / `ingest_api: 1`.
5. Compat smoke: `node scripts/smoke-host-compat.mjs`
6. Hard-refresh the TV browser (SSE reconnects automatically).

While the host is down for a few seconds, friend collectors **keep writing the local outbox** and retry; when you come back they drain catch-up with original `ev.ts`.

Safe edits: anything under `host/public/`, host analytics/labels, ingest log text.  
Unsafe: token, `/events` success codes, requiring new event fields — see `CLIENT_CONTRACT.md`.
