#!/usr/bin/env bash
# 快速部署：本地 build → rsync dist → restart（无需重建镜像）
# 适用于纯代码改动（无新 npm 依赖）
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 \
#   DEPLOY_DIR=/root/workspace/tma-projects \
#   SSH_IDENTITY_FILE=~/Downloads/yannick.pem \
#   SSH_OPTS="-o StrictHostKeyChecking=no" \
#   bash deploy/single-node/deploy-fast.sh web-tma
#
# 目标（可多个）：web-tma | bff-node | core-node | all

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 root@1.2.3.4}"
DIR="${DEPLOY_DIR:-/root/workspace/tma-projects}"

SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)
RSYNC_RSH="ssh ${SSH_ARGS[*]}"

restart_container() {
  local name="$1"
  ssh "${SSH_ARGS[@]}" "$HOST" \
    'if command -v podman >/dev/null 2>&1; then podman restart '"$name"';
     elif command -v docker >/dev/null 2>&1; then docker restart '"$name"';
     else echo "未找到 podman/docker" >&2; exit 1; fi'
}

run_db_migrations() {
  echo "==> [db] 同步并执行迁移..."
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/infra/database/betogo/" "$HOST:$DIR/infra/database/betogo/"
  ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" <<'REMOTE'
cd /root/workspace/tma-projects
DB_USER=$(grep -m1 '^MYSQL_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
DB_PASS=$(grep -m1 '^MYSQL_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
# .env 可能有多行 MYSQL_DATABASE，取最后一行（bff-node dotenv 行为一致）
DB_NAME=$(grep '^MYSQL_DATABASE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'"); DB_NAME=${DB_NAME:-betogo}
CTR=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)
for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
  [ -f "$f" ] || continue
  OUT=$($CTR exec tma-mysql \
    mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$f" 2>&1)
  RC=$?
  if [ $RC -eq 0 ]; then
    echo "  ran: $f"
  else
    echo "  failed(rc=$RC): $f — $OUT"
  fi
done
REMOTE
}

TARGETS=("${@:-all}")
[[ "${TARGETS[0]}" == "all" ]] && TARGETS=(web-tma web-admin bff-node core-node)

for TARGET in "${TARGETS[@]}"; do
  case "$TARGET" in
    web-tma)
      echo "==> [web-tma] 本地构建..."
      (cd "$ROOT/apps/web-tma" && npm run build)
      echo "==> [web-tma] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-tma/dist/" "$HOST:$DIR/apps/web-tma/dist/"
      echo "==> [web-tma] 完成（nginx 即时生效，无需重启）"
      ;;
    web-admin)
      echo "==> [web-admin] 本地构建..."
      (cd "$ROOT/apps/web-admin" && npm run build)
      echo "==> [web-admin] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-admin/dist/" "$HOST:$DIR/apps/web-admin/dist/"
      echo "==> [web-admin] 完成（nginx 即时生效，无需重启）"
      ;;
    bff-node)
      run_db_migrations
      echo "==> [bff-node] 本地编译..."
      (cd "$ROOT/apps/bff-node" && npm run build)
      echo "==> [bff-node] 同步 dist + package..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/bff-node/dist/" "$HOST:$DIR/apps/bff-node/dist/"
      RSYNC_RSH="$RSYNC_RSH" rsync -az \
        "$ROOT/apps/bff-node/package.json" \
        "$ROOT/apps/bff-node/package-lock.json" \
        "$HOST:$DIR/apps/bff-node/"
      if [[ "${BFF_REBUILD_IMAGE:-}" == "1" ]] || \
         RSYNC_RSH="$RSYNC_RSH" rsync -ain \
           "$ROOT/apps/bff-node/package-lock.json" "$HOST:$DIR/apps/bff-node/" | grep -q '^[<>]'; then
        echo "==> [bff-node] 依赖变更，重建镜像并替换容器..."
        ssh "${SSH_ARGS[@]}" "$HOST" "cd '$DIR' && bash deploy/single-node/recreate-bff-node.sh"
      else
        echo "==> [bff-node] 重启容器..."
        restart_container tma-bff-node
      fi
      echo "==> [bff-node] 完成"
      ;;
    core-node)
      echo "==> [core-node] 本地编译..."
      (cd "$ROOT/apps/core-node" && npm run build)
      echo "==> [core-node] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/core-node/dist/" "$HOST:$DIR/apps/core-node/dist/"
      echo "==> [core-node] 重启容器..."
      restart_container tma-core-node
      echo "==> [core-node] 完成"
      ;;
    *)
      echo "未知目标: $TARGET（可选: web-tma | bff-node | core-node | all）" >&2
      exit 1
      ;;
  esac
done
