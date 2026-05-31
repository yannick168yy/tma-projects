#!/usr/bin/env bash
# 快速部署 web-tma：本地 build → rsync dist → 无需重建容器
#
# 前提：服务器上 tma-web-tma 容器已用 volume mount 方式启动
# 用法：bash deploy/single-node/deploy-web-tma-fast.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 root@1.2.3.4}"
DIR="${DEPLOY_DIR:-/root/workspace/tma-projects}"

SSH_ARGS=()
RSYNC_RSH="ssh"
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  KEY="${SSH_IDENTITY_FILE/#\~/$HOME}"
  SSH_ARGS+=( -i "$KEY" )
  RSYNC_RSH="ssh -i $KEY"
fi
if [[ -n "${SSH_OPTS:-}" ]]; then
  # shellcheck disable=SC2206
  SSH_ARGS+=( $SSH_OPTS )
  RSYNC_RSH="$RSYNC_RSH ${SSH_OPTS}"
fi
export RSYNC_RSH

echo "==> 本地构建 web-tma..."
cd "$ROOT/apps/web-tma"
npm run build

echo "==> 同步 dist 到 ${HOST}:${DIR}/apps/web-tma/dist/"
rsync -az --delete \
  "$ROOT/apps/web-tma/dist/" \
  "$HOST:$DIR/apps/web-tma/dist/"

echo "==> 完成（nginx 将即时提供新版本，无需重启容器）"
