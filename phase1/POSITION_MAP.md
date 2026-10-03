# Forever LAN — Position / Map (verified)

## Live Forever probe result (2026-09-20)

`/foreverlan pos` → SavedVariables `positionProbe`:

| Player | Unit | accuracy | map_id | map_name | map_x | map_y | UnitPosition |
|--------|------|----------|--------|----------|-------|-------|--------------|
| Alex River | player | **EXACT** | 1426 | Dun Morogh | ~0.27 | ~0.68 | yes |
| Sam | party1 | **EXACT** | 1426 | Dun Morogh | ~0.34 | ~0.70 | yes |

Also present: `GetWorldPosFromMapPos`, continent_id, subzone (Coldridge Valley for host), parent map 1415 (Eastern Kingdoms).

**Conclusion:** Forever exposes real party map coordinates via `C_Map.GetPlayerMapPosition`.

## Map screen

Continent Azeroth tab removed (no honest continent projection / no shipped Blizzard art).

**Zones** (`/zones`): weekend **heatmap** of where the roster spent the weekend — hottest = most unique visitors, then event volume. No live GPS / exact pins.

| Placement | When | Honesty |
|-----------|------|---------|
| Zone centroid | Known zone name in atlas | **ZONE** |
| Nudge inside zone cell | `accuracy=EXACT` + map_x/y | **EXACT** (still zone-local on overview) |

No MapGenie embed, no POI encyclopedia. MapGenie Forever Azeroth is inspiration only — we do not ship their tiles or database.

Pan / zoom, party highlight, name + level + zone labels.

## Coordinate model

```text
player.position = {
  accuracy: "EXACT" | "ZONE" | "UNKNOWN",
  map_id, map_name, parent_map_id,
  map_x, map_y,          // normalized 0–1 on uiMapID
  world_x, world_y,      // UnitPosition yards (instance-relative)
  continent_id,
  source, confidence, ts
}
```

Screen placement on zone plate: `left = map_x * 100%`, `top = map_y * 100%` (same orientation as in-game map).

## URLs

| View | URL |
|------|-----|
| War Room (TV) | http://127.0.0.1:8765/ |
| Zones | http://127.0.0.1:8765/zones |

## Refresh positions in play

Click **Push LAN** (saves SavedVariables + reloads) — or `/foreverlan push`. Pending is kept; the collector dedupes by event id.

For continuous deaths/zones without reloading: type `/combatlog` once per session.

See [TRANSPORT.md](./TRANSPORT.md) for the hybrid transport model.
