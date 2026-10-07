# Cloudflare Tunnel — remote friend beta (push-only)

For remote testing, friends only need to **push events**. The board stays on the host PC.

| Hostname | Role |
|----------|------|
| `https://foreverlan-ingest.example.com` | Friend `POST /events` — **`lanToken`**, host allows this path only |
| `http://127.0.0.1:8765/` | Dashboard / SSE / APIs — **local**, not published on the tunnel |

```text
Agent    ──lanToken─►  foreverlan-ingest.example.com ──tunnel──►  :8765  (POST /events)
You      ──browser──►  http://127.0.0.1:8765/                 (board on host PC)
```

Optional: Cloudflare Access on `foreverlan.example.com` if you later want a remote board. Not required for push tests — leave that hostname **off** the tunnel ingress (see `config.yml`).

**House LAN weekend:** tunnel **off**, clear `friendHostUrl`, LAN discovery as usual.

## Config (`config.json`)

```json
"remoteSecurityMode": "wan",
"ingestPublicHostname": "foreverlan-ingest.example.com",
"friendHostUrl": "https://foreverlan-ingest.example.com"
```

- Friends zip gets `friendHostUrl` → ingest
- Host returns `403 ingest_host_only` for anything except `POST /events` on that hostname

## One-time setup

1. `bin\cloudflared.exe` + `tunnel login` + tunnel `foreverlan`
2. DNS: `cloudflared tunnel route dns foreverlan foreverlan-ingest.example.com`
3. `config.yml` ingress = ingest hostname only
4. Rebuild Friends zip

## Every remote-beta session

```bat
scripts\start-remote-beta.bat
```

```bat
node scripts\test-remote-security.mjs
node scripts\test-remote-security.mjs --live-wan
```

## Path matrix (WAN)

| Surface | Where | Auth |
|---------|--------|------|
| `POST /events` | `foreverlan-ingest.example.com` | `lanToken` |
| Board /stream /api /health /discover | host PC `127.0.0.1:8765` | none (LAN/local) |

**Do not re-run an old setup that adds `foreverlan.example.com` to ingress** — current `setup-tunnel.ps1` is ingest-only.

See also [`access-policy.md`](access-policy.md) if you re-enable a remote dashboard later.
