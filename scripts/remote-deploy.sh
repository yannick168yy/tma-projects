#!/usr/bin/env bash
# 同步代码 → 阿里云部署（web + BFF + Redis + 容器 MySQL betogo）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DEPLOY_HOST="${DEPLOY_HOST:-root@47.84.34.139}"
export DEPLOY_DIR="${DEPLOY_DIR:-/opt/tma-projects}"
export WEB_TMA_PORT="${WEB_TMA_PORT:-8080}"
export SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE:-$HOME/Downloads/yannick.pem}"

echo "==> 部署到 ${DEPLOY_HOST}"
"$ROOT/deploy/single-node/deploy-web-tma.sh"

SSH_BASE=(ssh)
if [[ -n "${SSH_IDENTITY_FILE:-}" ]] && [[ -f "${SSH_IDENTITY_FILE/#\~/$HOME}" ]]; then
  SSH_BASE+=( -i "${SSH_IDENTITY_FILE/#\~/$HOME}" )
fi

echo "==> 远程: 校验 betogo 表结构（容器 MySQL）"
"${SSH_BASE[@]}" "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && chmod +x scripts/apply-betogo-schema.sh && CTR=podman bash scripts/apply-betogo-schema.sh" || true

echo "==> 远程部署完成"
