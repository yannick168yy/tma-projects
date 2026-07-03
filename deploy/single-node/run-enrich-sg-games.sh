#!/usr/bin/env bash
# 同步代码到服务器并后台启动 enrich-sg-games 脚本
#
# 用法:
#   DEPLOY_HOST=root@47.84.34.139 \
#   DEPLOY_DIR=/root/workspace/tma-projects \
#   SSH_IDENTITY_FILE=/Users/yannicky/TMA_FILES/aliyun.pem \
#   SSH_OPTS="-o StrictHostKeyChecking=no" \
#   bash deploy/single-node/run-enrich-sg-games.sh
#
# 可选:
#   ONLY_MISSING=1   只处理尚未评分的游戏
#   BATCH_SIZE=50    每批处理数量（默认 50）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 root@47.84.34.139}"
DIR="${DEPLOY_DIR:-/root/workspace/tma-projects}"
ONLY_MISSING="${ONLY_MISSING:-1}"
BATCH_SIZE="${BATCH_SIZE:-50}"
MAX_BATCHES="${MAX_BATCHES:-}"

SSH_BASE=(ssh)
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  KEY="${SSH_IDENTITY_FILE/#\~/$HOME}"
  SSH_BASE+=(-i "$KEY")
  export RSYNC_RSH="ssh -i $KEY"
fi
if [[ -n "${SSH_OPTS:-}" ]]; then
  # shellcheck disable=SC2206
  SSH_BASE+=($SSH_OPTS)
  export RSYNC_RSH="${RSYNC_RSH:-ssh} ${SSH_OPTS}"
fi

ssh_cmd() {
  "${SSH_BASE[@]}" "$HOST" "$@"
}

echo "==> 同步代码到 ${HOST}:${DIR}"
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git/objects \
  "$ROOT/" "$HOST:$DIR/"

echo "==> 在服务器上安装依赖并后台启动 enrich-sg-games..."
ssh_cmd bash -s "$DIR" "$ONLY_MISSING" "$BATCH_SIZE" "$MAX_BATCHES" <<'REMOTE_EOF'
set -euo pipefail
DIR="$1"
ONLY_MISSING="$2"
BATCH_SIZE="$3"
MAX_BATCHES="$4"

cd "$DIR/scripts/enrich-sg-games"
npm install --silent

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  [[ "$key" =~ [[:space:]] ]] && continue
  export "${key}=${val}"
done < "$DIR/.env"

LOG="$DIR/scripts/enrich-sg-games/run-$(date +%Y%m%d-%H%M%S).log"

MYSQL_HOST=mysql \
MYSQL_PORT=3306 \
MYSQL_DATABASE=betogo \
MYSQL_USER="${MYSQL_BETOGO_USER:-betogo}" \
MYSQL_PASSWORD="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}" \
ONLY_MISSING="$ONLY_MISSING" \
BATCH_SIZE="$BATCH_SIZE" \
MAX_BATCHES="$MAX_BATCHES" \
nohup npm start > "$LOG" 2>&1 &

echo "✅ PID=$!  日志: $LOG"
echo "   查看进度: tail -f $LOG"
REMOTE_EOF

echo "==> 完成，脚本已在服务器后台运行"
