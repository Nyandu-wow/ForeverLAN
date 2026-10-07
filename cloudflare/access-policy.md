# Cloudflare Access — optional remote dashboard

**Remote beta default is push-only.** The tunnel publishes your ingest hostname (see `config.example.yml`) for friend `POST /events` (`lanToken`). Watch the board at `http://127.0.0.1:8765/` on the host PC.

You do **not** need Cloudflare Access for push tests.

## Path matrix (push-only WAN)

| Surface | Hostname | Auth |
|---------|----------|------|
| `POST /events` | your ingest hostname | `lanToken` |
| Any other path on ingest host | your ingest hostname | Host `403 ingest_host_only` |
| Board /stream /api /health /discover | `127.0.0.1:8765` (local) | none |

## Leftover from earlier setup

If an old dashboard hostname still has DNS + an Access app, that is dormant while the hostname is **off** tunnel ingress. Safe to leave, or delete in Zero Trust / DNS to declutter. It must **not** be re-added to `config.yml` unless you intentionally want a remote board.

## Optional: remote dashboard later

1. Add your dashboard hostname back to tunnel `config.yml` ingress
2. Keep Access on the **dashboard** hostname only (email allowlist + One-time PIN)
3. Do **not** put Access on the ingest hostname

```bat
node scripts\test-remote-security.mjs --live-wan
set FOREVERLAN_TEST_DASHBOARD=1
node scripts\test-remote-security.mjs --live-wan
```

## House LAN weekend

Tunnel off. Clear `friendHostUrl`. Use `start-weekend.bat`.
