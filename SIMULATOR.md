# Forever LAN — Development Telemetry Simulator

## Purpose

Develop the downstream app **before Forever beta access**, without inventing Forever APIs.

The Phase 1 addon + collector remain untouched for later real-client validation.

## Architecture

```text
REAL MODE (later, when beta works)
  WoW Forever → ForeverLAN addon → collector → POST /events → host → UI/app

DEVELOPMENT MODE (now)
  simulator → POST /events → host → UI/app
```

Everything **after** the normalized event stream is identical.

## How to run

Terminal A — event host (unchanged):

```powershell
cd E:\OneDrive\Private\Cursor\FOREVER
node host/server.js
```

Terminal B — simulator control:

```powershell
cd E:\OneDrive\Private\Cursor\FOREVER
node simulator/server.js
```

| URL | Role |
|-----|------|
| http://127.0.0.1:8766/ | Simulator control (start/pause/resume/reset/speed) |
| http://127.0.0.1:8765/ | Forever LAN board (levels, zones, PvP, deaths) |
| http://127.0.0.1:8765/raw | Raw event chronicle |

Optional: `FOREVERLAN_SIM_PORT`, `FOREVERLAN_HOST_URL`

## World

One continuous scenario: **`lan_weekend`**.

No scenario picker. Hit **Start** and leave it running — levels, zones, PvP kills, PvE/PvP deaths, dungeon dips, brief offline blips. Emits `LAN_STATS` snapshots the host aggregates into `/lan`.

Cast: Alex River (Priest), Sam (Rogue), Zmimz (Druid), Jordan (Hunter).

## Normalized event schema

Shared builders live in `simulator/schema.js`. Real addon events already use the same `type` names and field conventions (`character`, `level`, `guid`, `members`, `instance_name`, …).

Simulator events set:

- `source: "simulator"`
- `simulated: true`

so they are easy to filter later and never mistaken for Forever-verified telemetry.

## REAL / VERIFIED vs SIMULATED

| Part | Status |
|------|--------|
| Phase 1 host `/events` + SSE + party UI | **Real plumbing** (works; schema stable for dev) |
| Phase 1 collector file tail + clipboard bridge | **Real code**, Forever behavior **not yet verified** |
| Phase 1 ForeverLAN addon | **Real code**, Forever APIs **not yet verified** |
| Party UnitLevel / deaths / zones on Forever | **NOT YET VERIFIED** (no beta access) |
| Simulator continuous LAN world | **SIMULATED ONLY** — fictional timeline, not game data |
| Combat log event shapes in simulator | **SIMULATED** approximations for app wiring |
| Final product dashboard / achievements / beamer | **Not built** |

When Forever beta arrives: leave the simulator for regression tests; validate the addon/collector against the live client; do not treat simulator output as proof of Forever capabilities.
