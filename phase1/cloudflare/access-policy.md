# Cloudflare Access — optional remote dashboard

**Remote beta default is push-only.** The tunnel publishes `foreverlan-ingest.example.com` for friend `POST /events` (`lanToken`). Watch the board at `http://127.0.0.1:8765/` on the host PC.

You do **not** need Cloudflare Access for push tests.

## Path matrix (push-only WAN)

| Surface | Hostname | Auth |
|---------|----------|------|
| `POST /events` | `foreverlan-ingest.example.com` | `lanToken` |
| Any other path on ingest host | `foreverlan-ingest.example.com` | Host `403 ingest_host_only` |
| Board /stream /api /health /discover | `127.0.0.1:8765` (local) | none |

## Leftover from earlier setup

If `foreverlan.example.com` still has DNS + an Access app (**Forever LAN Dashboard**), that is dormant while the hostname is **off** tunnel ingress. Safe to leave, or delete in Zero Trust / DNS to declutter. It must **not** be re-added to `config.yml` unless you intentionally want a remote board.

## Optional: remote dashboard later

1. Add `foreverlan.example.com` back to tunnel `config.yml` ingress
2. Keep Access app **Forever LAN Dashboard** (email allowlist + One-time PIN)
3. Do **not** put Access on `foreverlan-ingest.example.com`

```bat
node phase1\scripts\test-remote-security.mjs --live-wan
set FOREVERLAN_TEST_DASHBOARD=1
node phase1\scripts\test-remote-security.mjs --live-wan
```

## House LAN weekend

Tunnel off. Clear `friendHostUrl`. Use `start-weekend.bat`.
