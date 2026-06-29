#!/usr/bin/env bash
# 安装 macOS LaunchAgent：登录后自动建立 Grafana SSH 隧道（本机 :3001）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.betogo.grafana-tunnel"
PLIST_SRC="${ROOT}/scripts/mac/com.betogo.grafana-tunnel.plist"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_DST="${AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/betogo"
SSH_KEY="${SSH_IDENTITY_FILE:-/Users/yannicky/TMA_FILES/aliyun.pem}"
SSH_HOST="${DEPLOY_HOST:-root@47.84.34.139}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "找不到 SSH 密钥: $SSH_KEY" >&2
  echo "请设置: SSH_IDENTITY_FILE=/path/to/key.pem $0" >&2
  exit 1
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

sed -e "s|__SSH_KEY__|${SSH_KEY}|g" \
    -e "s|__SSH_HOST__|${SSH_HOST}|g" \
    -e "s|__LOG_DIR__|${LOG_DIR}|g" \
    "$PLIST_SRC" > "$PLIST_DST"

chmod 644 "$PLIST_DST"

GUI_ID="$(id -u)"
# 若已加载则先卸载
launchctl bootout "gui/${GUI_ID}" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/${GUI_ID}" "$PLIST_DST"
launchctl enable "gui/${GUI_ID}/${LABEL}" 2>/dev/null || true

echo "已安装 LaunchAgent: $PLIST_DST"
echo "  本机 Grafana: http://127.0.0.1:3001"
echo "  日志: ${LOG_DIR}/grafana-tunnel.*.log"
echo ""
echo "管理命令:"
echo "  立即启动: launchctl kickstart -k gui/${GUI_ID}/${LABEL}"
echo "  停止:     launchctl bootout gui/${GUI_ID} ${PLIST_DST}"
echo "  卸载:     bash ${ROOT}/scripts/mac/uninstall-grafana-tunnel.sh"
