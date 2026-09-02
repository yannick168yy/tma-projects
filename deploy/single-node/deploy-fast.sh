#!/usr/bin/env bash
# 快速部署：本地 build → rsync dist → restart（无需重建镜像）
# 适用于纯代码改动（无新 npm 依赖）
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 \
#   DEPLOY_DIR=/root/workspace/tma-projects \
#   SSH_IDENTITY_FILE=/Volumes/MacAPFS/TMA_FILES/aliyun.pem \
#   SSH_OPTS="-o StrictHostKeyChecking=no" \
#   bash deploy/single-node/deploy-fast.sh web-tma
#
# 目标（可多个）：db | web-tma | web-admin | bff-node | core-node | all
#   db = 只跑平台库+租户库迁移，不构建不重启

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

run_platform_migrations() {
  echo "==> [db] 同步并执行平台库迁移..."
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/infra/database/platform/" "$HOST:$DIR/infra/database/platform/"
  ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" <<'REMOTE'
cd /root/workspace/tma-projects
ROOT_PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
APP_USER=$(grep -m1 '^MYSQL_BETOGO_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
APP_USER=${APP_USER:-betogo}
PF_DB=betogo_platform
CTR=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)

if [ -z "$ROOT_PW" ]; then
  echo "  [db] .env 缺少 MYSQL_ROOT_PASSWORD，无法建平台库" >&2
  exit 1
fi

# root 建库并给应用账号授权（应用账号同时要访问平台库与租户库）
# 注意：不能加 -i，否则 docker/podman exec 会吞掉 heredoc 剩余脚本
$CTR exec tma-mysql mysql -uroot -p"$ROOT_PW" -e "
CREATE DATABASE IF NOT EXISTS \`$PF_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`$PF_DB\`.* TO '$APP_USER'@'%';
FLUSH PRIVILEGES;" 2>/dev/null

pq() { $CTR exec tma-mysql mysql -uroot -p"$ROOT_PW" "$PF_DB" -sN -e "$1" 2>/dev/null; }
pe() { $CTR exec tma-mysql mysql -uroot -p"$ROOT_PW" "$PF_DB" -e "$1" 2>/dev/null; }

pe "CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(64) NOT NULL,
  executed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
)"

# 平台库是新库，不做"已有库标记全部已执行"的兜底 —— 必须从 001 老老实实跑
# 已执行版本一次性取回本地比对：每文件一次 SQL 往返在多租户下会放大成上万次，部署要跑几小时
PF_APPLIED=$(pq "SELECT version FROM schema_migrations")
PF_SKIP=0
for f in $(ls infra/database/platform/[0-9]*.sql 2>/dev/null | sort); do
  [ -f "$f" ] || continue
  ver=$(basename "$f" .sql)
  if echo "$PF_APPLIED" | grep -qx "$ver"; then
    PF_SKIP=$((PF_SKIP+1))
    continue
  fi
  OUT=$($CTR exec -i tma-mysql \
    mysql --default-character-set=utf8mb4 -uroot -p"$ROOT_PW" "$PF_DB" < "$f" 2>&1)
  if [ $? -eq 0 ]; then
    pe "INSERT INTO schema_migrations (version) VALUES ('$ver')"
    echo "  ran(platform): $f"
  else
    echo "  failed(platform): $f — $(echo "$OUT" | grep -v Warning)" >&2
    exit 1
  fi
done
[ "$PF_SKIP" -gt 0 ] && echo "  [db] 平台库跳过 $PF_SKIP 个已执行迁移"
echo "  [db] 平台库租户数: $(pq 'SELECT COUNT(*) FROM pf_tenant')"
REMOTE
}

run_db_migrations() {
  echo "==> [db] 同步并执行迁移..."
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/infra/database/betogo/" "$HOST:$DIR/infra/database/betogo/"
  ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" <<'REMOTE'
cd /root/workspace/tma-projects
DB_USER=$(grep -m1 '^MYSQL_BETOGO_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
DB_USER=${DB_USER:-$(grep -m1 '^MYSQL_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")}
DB_PASS=$(grep -m1 '^MYSQL_BETOGO_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
DB_PASS=${DB_PASS:-$(grep -m1 '^MYSQL_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")}
# .env 里 MYSQL_DATABASE 出现两次(第一处=mysql容器初始库tma,后一处=业务库betogo),
# 迁移只允许打 betogo,直接固定,不再从 .env 猜
DB_NAME=betogo
CTR=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)

# 辅助：静默查询（返回裸值，屏蔽密码警告）
mq() { $CTR exec tma-mysql mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -sN -e "$1" 2>/dev/null; }
# 辅助：执行语句（屏蔽密码警告）
me() { $CTR exec tma-mysql mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1" 2>/dev/null; }

# 1. 确保迁移记录表存在
me "CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(64) NOT NULL,
  executed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
)"

# 2. 首次引入版本记录：若表为空且 bg_user 已存在（已有库），把现有文件全部标记为已执行
MC=$(mq "SELECT COUNT(*) FROM schema_migrations")
BG=$(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_user'")
if [ "${MC:-0}" -eq 0 ] && [ "${BG:-0}" -gt 0 ]; then
  echo "  [db] 已有数据库，初始化迁移版本记录..."
  MARK_VALUES=""
  for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
    ver=$(basename "$f" .sql)
    MARK_VALUES="${MARK_VALUES}('$ver'),"
  done
  [ -n "$MARK_VALUES" ] && me "INSERT IGNORE INTO schema_migrations (version) VALUES ${MARK_VALUES%,}"
  echo "  [db] 已标记 $(mq 'SELECT COUNT(*) FROM schema_migrations') 个迁移为已执行"
fi

# 3. 只执行尚未记录的迁移文件（已执行版本一次性取回，避免每文件一次 SQL 往返）
APPLIED=$(mq "SELECT version FROM schema_migrations")
SKIP=0
for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
  [ -f "$f" ] || continue
  ver=$(basename "$f" .sql)
  if echo "$APPLIED" | grep -qx "$ver"; then
    SKIP=$((SKIP+1))
    continue
  fi
  OUT=$($CTR exec -i tma-mysql \
    mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$f" 2>&1)
  RC=$?
  if [ $RC -eq 0 ]; then
    me "INSERT INTO schema_migrations (version) VALUES ('$ver')"
    echo "  ran: $f"
  else
    echo "  failed: $f — $(echo "$OUT" | grep -v Warning)"
    exit 1
  fi
done
[ "$SKIP" -gt 0 ] && echo "  [db] 跳过 $SKIP 个已执行迁移"
REMOTE
}

TARGETS=("${@:-all}")
[[ "${TARGETS[0]}" == "all" ]] && TARGETS=(web-tma web-admin bff-node core-node)

for TARGET in "${TARGETS[@]}"; do
  case "$TARGET" in
    db)
      run_platform_migrations
      run_db_migrations
      echo "==> [db] 完成（仅迁移，未重启服务）"
      ;;
    web-tma)
      echo "==> [web-tma] 本地构建..."
      (cd "$ROOT/apps/web-tma" && npm run build)
      echo "==> [web-tma] 生成 gzip 静态资源..."
      find "$ROOT/apps/web-tma/dist" -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.html' \) \
        -exec gzip -9 -k -f {} \;
      echo "==> [web-tma] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-tma/dist/" "$HOST:$DIR/apps/web-tma/dist/"
      echo "==> [web-tma] 同步站点静态目录..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete --exclude .user.ini \
        "$ROOT/apps/web-tma/dist/" "$HOST:/www/wwwroot/188facai.com/"
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
      run_platform_migrations
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
      echo "未知目标: $TARGET（可选: db | web-tma | web-admin | bff-node | core-node | all）" >&2
      exit 1
      ;;
  esac
done
