#!/usr/bin/env bash
# Forever LAN — Steam Deck / SteamOS client (host is the Windows PC running Forever LAN)
#
# Usage (Desktop Mode → Konsole), from the unzipped Steam Deck pack:
#   bash install-steamdeck.sh
#   bash install-steamdeck.sh "/home/deck/Games/Forever/WoW/World of Warcraft/_classic_beta_"
#
# ./install-steamdeck.sh also works when the zip preserved the executable bit.
# Prefer `bash install-steamdeck.sh` — SteamOS unzip sometimes drops +x.
#
# Then enable ForeverLAN in WoW and play. Host must be on the same Wi‑Fi with
# start-weekend.bat running (and firewall open once).

set -euo pipefail

PACK="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${FOREVERLAN_HOME:-$HOME/.local/share/ForeverLAN}"
NODE_VERSION="22.11.0"
NODE_ARCH="linux-x64"

die() { echo "ERROR: $*" >&2; exit 1; }

echo ""
echo "Forever LAN — Steam Deck setup"
echo "=============================="
echo ""

# --- party.json (token) ---
PARTY=""
for c in "$PACK/party.json" "$HOME_DIR/party.json" "$PACK/../dist/ForeverLAN-Friends/party.json"; do
  if [[ -f "$c" ]]; then PARTY="$c"; break; fi
done
[[ -n "$PARTY" ]] || die "party.json not found. Use ForeverLAN-SteamDeck.zip from the host (prepare-steamdeck-zip.bat)."

# --- WoW client dir (_classic_beta_ with WowB.exe) ---
# Real layouts seen:
#   Steam Proton compatdata/.../World of Warcraft/_classic_beta_
#   Battle.net / Lutris / custom: ~/Games/Forever/WoW/World of Warcraft/_classic_beta_
WOW="${1:-}"
if [[ -z "$WOW" ]]; then
  echo "Searching Forever / Proton paths for WowB.exe …"
  SEARCH_ROOTS=(
    "$HOME/Games/Forever"
    "$HOME/Games"
    "$HOME/.steam/steam/steamapps/compatdata"
    "$HOME/.local/share/Steam/steamapps/compatdata"
    "$HOME/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata"
  )
  FOUND=()
  for root in "${SEARCH_ROOTS[@]}"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r -d '' f; do
      FOUND+=("$f")
    done < <(find "$root" -maxdepth 12 -type f \( -name 'WowB.exe' -o -name 'Wow.exe' \) -print0 2>/dev/null || true)
    # Prefer Forever-branded paths; stop early if we already found some under Games/Forever
    if [[ "$root" == "$HOME/Games/Forever" && ${#FOUND[@]} -gt 0 ]]; then
      break
    fi
  done
  # Dedupe while preserving order
  if [[ ${#FOUND[@]} -gt 0 ]]; then
    declare -A SEEN=()
    DEDUPED=()
    for f in "${FOUND[@]}"; do
      [[ -n "${SEEN[$f]:-}" ]] && continue
      SEEN[$f]=1
      DEDUPED+=("$f")
    done
    FOUND=("${DEDUPED[@]}")
  fi
  # Cap list for interactive pick
  if [[ ${#FOUND[@]} -gt 20 ]]; then
    FOUND=("${FOUND[@]:0:20}")
  fi
  if [[ ${#FOUND[@]} -eq 0 ]]; then
    echo "Not found automatically."
    echo "Pass the Forever client folder as an argument, e.g.:"
    echo "  bash install-steamdeck.sh \"\$HOME/Games/Forever/WoW/World of Warcraft/_classic_beta_\""
    echo "  bash install-steamdeck.sh \"\$HOME/.steam/steam/steamapps/compatdata/<id>/pfx/drive_c/Program Files (x86)/World of Warcraft/_classic_beta_\""
    exit 1
  fi
  if [[ ${#FOUND[@]} -eq 1 ]]; then
    WOW="$(dirname "${FOUND[0]}")"
  else
    echo "Pick a Forever client:"
    i=1
    for f in "${FOUND[@]}"; do
      echo "  $i) $(dirname "$f")"
      i=$((i + 1))
    done
    read -r -p "Number: " n
    WOW="$(dirname "${FOUND[$((n - 1))]}")"
  fi
fi

WOW="$(realpath -m "$WOW")"
[[ -f "$WOW/WowB.exe" || -f "$WOW/Wow.exe" ]] || die "No WowB.exe in: $WOW"

echo "WoW client: $WOW"

# --- layout ---
mkdir -p "$HOME_DIR"/{data,runtime,collector,addon/ForeverLAN}
ADDON_SRC=""
for c in "$PACK/addon/ForeverLAN" "$PACK/../addon/ForeverLAN" "$PACK/ForeverLAN"; do
  if [[ -f "$c/ForeverLAN.toc" ]]; then ADDON_SRC="$c"; break; fi
done
[[ -n "$ADDON_SRC" ]] || die "ForeverLAN addon folder not next to this script."

ADDON_DEST="$WOW/Interface/AddOns/ForeverLAN"
mkdir -p "$ADDON_DEST"
cp -a "$ADDON_SRC/." "$ADDON_DEST/"
cp -a "$ADDON_SRC/." "$HOME_DIR/addon/ForeverLAN/"
echo "Addon → $ADDON_DEST"

# collector + agent (from pack or repo tree)
COLL_SRC=""
for c in "$PACK/collector" "$PACK/../collector"; do
  if [[ -f "$c/index.js" ]]; then COLL_SRC="$c"; break; fi
done
[[ -n "$COLL_SRC" ]] || die "collector/ not found."
cp -a "$COLL_SRC/." "$HOME_DIR/collector/"
cp -f "$PARTY" "$HOME_DIR/party.json"
for f in agent.js discover.js start-agent.sh; do
  if [[ -f "$PACK/$f" ]]; then cp -f "$PACK/$f" "$HOME_DIR/$f"; fi
done
[[ -f "$HOME_DIR/agent.js" ]] || die "agent.js missing — use the ForeverLAN-Friends zip folder."
[[ -f "$HOME_DIR/start-agent.sh" ]] || die "start-agent.sh missing — rebuild the Steam Deck zip."
chmod +x "$HOME_DIR/start-agent.sh" 2>/dev/null || true

# stamp wow into party (wowRoot + clientFolder so collector finds WowB.exe)
python3 - <<PY || true
import json, os
p = "$HOME_DIR/party.json"
raw = json.load(open(p))
wow = os.path.realpath("$WOW")
base = os.path.basename(wow)
if base.startswith("_classic") or base.startswith("_retail"):
    raw["wowRoot"] = os.path.dirname(wow)
    raw["clientFolder"] = base
else:
    raw["wowRoot"] = wow
    raw["clientFolder"] = "_classic_beta_"
json.dump(raw, open(p, "w"), indent=2)
print("party.json wowRoot=%s clientFolder=%s" % (raw["wowRoot"], raw["clientFolder"]))
PY

# --- portable Node (linux) — prefer pack-bundled runtime (offline LAN) ---
NODE_BIN="$HOME_DIR/runtime/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  # Prefer -f over -x: SteamOS unzip may strip the executable bit from the zip.
  if [[ -f "$PACK/runtime/bin/node" ]]; then
    echo "Using bundled Linux Node from pack …"
    rm -rf "$HOME_DIR/runtime"
    mkdir -p "$HOME_DIR/runtime"
    cp -a "$PACK/runtime/." "$HOME_DIR/runtime/"
    chmod +x "$HOME_DIR/runtime/bin/node" 2>/dev/null || true
  else
    echo "Downloading Node $NODE_VERSION ($NODE_ARCH) …"
    TMP="$(mktemp -d)"
    URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz"
    curl -fsSL "$URL" -o "$TMP/node.tar.xz"
    tar -xJf "$TMP/node.tar.xz" -C "$TMP"
    rm -rf "$HOME_DIR/runtime"
    mv "$TMP/node-v${NODE_VERSION}-${NODE_ARCH}" "$HOME_DIR/runtime"
    rm -rf "$TMP"
  fi
fi
chmod +x "$NODE_BIN" 2>/dev/null || true
[[ -x "$NODE_BIN" ]] || die "Node binary missing or not executable at $NODE_BIN"

# --- start agent with restart loop (offline-first; discover finds host on LAN) ---
# Stop prior agent / watchdog / collector if any
stop_pid_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    local old
    old="$(cat "$f" || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 1
    fi
  fi
}
stop_pid_file "$HOME_DIR/data/agent.pid"
stop_pid_file "$HOME_DIR/data/watchdog.pid"
if [[ -f "$HOME_DIR/data/collector.lock" ]]; then
  cpid="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pid',''))" "$HOME_DIR/data/collector.lock" 2>/dev/null || true)"
  if [[ -n "${cpid:-}" ]] && kill -0 "$cpid" 2>/dev/null; then
    kill "$cpid" 2>/dev/null || true
    sleep 1
  fi
fi

export FOREVERLAN_HOME="$HOME_DIR"
export FOREVERLAN_FRIEND_AGENT=1
export FOREVERLAN_NODE="$NODE_BIN"
cp -f "$PACK/start-agent.sh" "$HOME_DIR/start-agent.sh"
chmod +x "$HOME_DIR/start-agent.sh" 2>/dev/null || true

started_via=""
if command -v systemctl >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/foreverlan-agent.service" <<EOF
[Unit]
Description=Forever LAN friend agent
After=network-online.target

[Service]
Type=simple
Environment=FOREVERLAN_HOME=$HOME_DIR
Environment=FOREVERLAN_FRIEND_AGENT=1
Environment=FOREVERLAN_NODE=$NODE_BIN
ExecStart=/bin/bash $HOME_DIR/start-agent.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  if systemctl --user daemon-reload >/dev/null 2>&1 \
    && systemctl --user enable --now foreverlan-agent.service >/dev/null 2>&1; then
    started_via="systemd --user"
  fi
fi

if [[ -z "$started_via" ]]; then
  nohup bash "$HOME_DIR/start-agent.sh" >>"$HOME_DIR/data/agent.log" 2>&1 &
  echo $! >"$HOME_DIR/data/watchdog.pid"
  started_via="watchdog"
fi

# Desktop autostart (Plasma Desktop session). Game Mode uses the systemd unit when available.
AUTOSTART="$HOME/.config/autostart"
mkdir -p "$AUTOSTART"
cat >"$AUTOSTART/foreverlan-agent.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Forever LAN Agent
Exec=env FOREVERLAN_HOME=$HOME_DIR FOREVERLAN_FRIEND_AGENT=1 FOREVERLAN_NODE=$NODE_BIN bash $HOME_DIR/start-agent.sh
X-GNOME-Autostart-enabled=true
EOF

echo ""
echo "OK — agent started via $started_via"
echo "  home:   $HOME_DIR"
echo "  log:    $HOME_DIR/data/agent.log"
echo "  addon:  enable ForeverLAN in WoW, then /reload"
echo "  host:   same Wi-Fi as the Forever LAN host PC"
echo ""
echo "Stop later:  systemctl --user disable --now foreverlan-agent.service"
echo "             (or kill the watchdog/agent PIDs under $HOME_DIR/data)"
echo ""
