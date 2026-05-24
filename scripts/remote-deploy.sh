#!/usr/bin/env bash
# 同步代码 → 阿里云最小栈部署（web + BFF + Redis）→ 可选宝塔 MySQL 建表
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DEPLOY_HOST="${DEPLOY_HOST:-root@47.84.34.139}"
export DEPLOY_DIR="${DEPLOY_DIR:-/opt/tma-projects}"
export WEB_TMA_PORT="${WEB_TMA_PORT:-8080}"

echo "==> 部署到 ${DEPLOY_HOST}"
"$ROOT/deploy/single-node/deploy-web-tma.sh"

echo "==> 远程: 宝塔 MySQL betogo 建表（失败可忽略，最小栈用 Redis）"
SSH_BASE=(ssh)
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  KEY="${SSH_IDENTITY_FILE/#\~/$HOME}"
  SSH_BASE+=( -i "$KEY" )
fi
"${SSH_BASE[@]}" "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && chmod +x deploy/single-node/server-init-betogo.sh && bash deploy/single-node/server-init-betogo.sh"

echo "==> 远程部署完成"
