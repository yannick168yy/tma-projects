#!/usr/bin/env bash
# 同步代码 → 阿里云全栈部署 → 生产建库/表/Nacos
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DEPLOY_HOST="${DEPLOY_HOST:-root@47.84.34.139}"
export DEPLOY_DIR="${DEPLOY_DIR:-/opt/tma-projects}"
export WEB_TMA_PORT="${WEB_TMA_PORT:-8080}"

echo "==> 部署到 ${DEPLOY_HOST}"
"$ROOT/deploy/single-node/deploy-web-tma.sh"

echo "==> 远程: MySQL betogo + 表结构 + Nacos 配置"
SSH_BASE=(ssh)
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  KEY="${SSH_IDENTITY_FILE/#\~/$HOME}"
  SSH_BASE+=( -i "$KEY" )
fi
"${SSH_BASE[@]}" "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && chmod +x deploy/single-node/server-init-betogo.sh && bash deploy/single-node/server-init-betogo.sh"

echo "==> 远程部署完成"
