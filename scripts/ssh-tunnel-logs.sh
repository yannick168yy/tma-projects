#!/usr/bin/env bash
# 本地打开 Grafana / Loki（与 MySQL 隧道互不冲突，可同一条 SSH 开多端口）
set -euo pipefail
HOST="${DEPLOY_HOST:-root@47.84.34.139}"
KEY="${SSH_IDENTITY_FILE:-/Volumes/MacAPFS/TMA_FILES/aliyun.pem}"
LOCAL_GRAFANA="${LOCAL_GRAFANA_PORT:-3001}"
LOCAL_LOKI="${LOCAL_LOKI_PORT:-3100}"

exec ssh -i "$KEY" -o StrictHostKeyChecking=no \
  -L "${LOCAL_GRAFANA}:127.0.0.1:3001" \
  -L "${LOCAL_LOKI}:127.0.0.1:3100" \
  -N "$HOST"
