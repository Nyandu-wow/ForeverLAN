# Forever LAN friend pack (legacy helper)

**Use the plug-and-play client:** [`../friend-client/README.md`](../friend-client/README.md)

Build the weekend zip with:

```bash
node scripts/prepare-friend-pack.mjs
```

Output: `dist/ForeverLAN-Friends/` (gitignored). The prepare script copies the addon from `addon/ForeverLAN` and injects `ForeverLAN_Party.lua` — do not commit a second addon tree here.
