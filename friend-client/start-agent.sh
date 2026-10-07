#!/usr/bin/env bash
# Forever LAN — keep the friend agent alive across crashes (Steam Deck / Linux).
# Exit 0 = clean / duplicate agent → idle longer. Anything else → quick restart.
set -u
HOME_DIR="${FOREVERLAN_HOME:-$HOME/.local/share/ForeverLAN}"
NODE_BIN="${FOREVERLAN_NODE:-$HOME_DIR/runtime/bin/node}"
AGENT="$HOME_DIR/agent.js"
export FOREVERLAN_HOME="$HOME_DIR"
export FOREVERLAN_FRIEND_AGENT=1
mkdir -p "$HOME_DIR/data"
while true; do
  "$NODE_BIN" "$AGENT"
  code=$?
  if [[ "$code" -eq 0 ]]; then
    sleep 60
  else
    sleep 5
  fi
done
