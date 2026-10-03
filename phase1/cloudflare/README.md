# Cloudflare: foreverlan.example.com

**Parked for the LAN weekend.** Do not run this tunnel during the one-weekend LAN.
Dashboard GETs (`/lan`, `/events`, `/api/*`, `/stream`) are intentionally open on the LAN TV;
a public HTTPS tunnel would publish that surface to the WAN. Friend agents use LAN discovery + `lanToken` for POST `/events`.

Expose the local ForeverLAN host (port **8765**) as **https://foreverlan.example.com** with Cloudflare Tunnel only if the host explicitly wants WAN access after the LAN.

## One-time setup

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).
2. Login (opens browser):

```bat
cloudflared tunnel login
```

3. Create a named tunnel:

```bat
cloudflared tunnel create foreverlan
```

Note the tunnel UUID and credentials JSON path printed by the CLI.

4. Route DNS (CNAME `foreverlan` → tunnel):

```bat
cloudflared tunnel route dns foreverlan foreverlan.example.com
```

5. Copy `config.example.yml` → `%USERPROFILE%\.cloudflared\config.yml` (or keep it under `phase1/cloudflare/config.yml`) and fill in:
   - `tunnel:` UUID
   - `credentials-file:` path to the JSON from step 3
   - ingress hostname `foreverlan.example.com` → `http://127.0.0.1:8765`

## Run (every LAN session)

1. Start the host: `node phase1/host/server.js`
2. Start the tunnel:

```bat
cloudflared tunnel --config path\to\phase1\cloudflare\config.yml run
```

Or use `start-tunnel.ps1` after editing the config path.

3. Open https://foreverlan.example.com/  
   Wrap: https://foreverlan.example.com/wrap

## Security

- **GET** `/`, `/wrap`, `/lan`, `/stream` — public (friends watch without a login).
- **POST** `/events` — requires `x-foreverlan-token` matching `lanToken` in `phase1/config.json`.
- Friends’ collectors use that token; never commit it to a public repo.

## Checklist

- [ ] cloudflared installed + logged in
- [ ] tunnel `foreverlan` created
- [ ] DNS `foreverlan.example.com` routed
- [ ] `config.yml` points at `127.0.0.1:8765`
- [ ] host running with `lanToken` set
- [ ] friends have token in their collector config
