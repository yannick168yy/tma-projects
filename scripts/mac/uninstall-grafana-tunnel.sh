#!/usr/bin/env bash
set -euo pipefail
LABEL="com.betogo.grafana-tunnel"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
GUI_ID="$(id -u)"

launchctl bootout "gui/${GUI_ID}" "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "已卸载 ${LABEL}"
