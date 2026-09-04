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
# 目标（可多个）：db | web-tma | web-admin | web-platform | bff-node | core-node | all
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
ROOT_PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
PF_DB=betogo_platform
CTR=$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)

# 租户库清单来自平台库。读不到就退回只打 betogo —— 宁可少打一个新租户库，
# 也不能因为平台库一时不可用把自营站的迁移也跳过。
TENANT_DBS=$($CTR exec tma-mysql mysql -uroot -p"$ROOT_PW" "$PF_DB" -sN \
  -e "SELECT db_name FROM pf_tenant WHERE status <> 'closed' ORDER BY id" 2>/dev/null)
if [ -z "$TENANT_DBS" ]; then
  echo "  [db] 警告：读不到平台库租户清单，本次只对 betogo 执行迁移" >&2
  TENANT_DBS=betogo
fi
echo "  [db] 目标库: $(echo $TENANT_DBS | tr '\n' ' ')"

TOTAL_RAN=0
for DB_NAME in $TENANT_DBS; do
  # 辅助：静默查询/执行（屏蔽密码警告）。注意不能加 -i，否则 exec 会吞掉 heredoc 剩余脚本
  mq() { $CTR exec tma-mysql mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -sN -e "$1" 2>/dev/null; }
  me() { $CTR exec tma-mysql mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1" 2>/dev/null; }

  if [ -z "$(mq 'SELECT 1')" ]; then
    echo "  [db] 失败：库 $DB_NAME 不可访问（不存在或无权限）" >&2
    exit 1
  fi

  # 空库 = 新开的租户库：用结构基线建表，而不是重放迁移。
  # 历史迁移链已无法从 001 重放（008 起就依赖后续才补上的列），只能走基线。
  # 基线自带 schema_migrations 数据，之后的新迁移照常增量执行。
  TBLCOUNT=$(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()")
  if [ "${TBLCOUNT:-0}" -eq 0 ]; then
    if [ ! -f infra/database/betogo/schema_baseline.sql ]; then
      echo "  [db][$DB_NAME] 失败：空库但找不到 schema_baseline.sql" >&2
      exit 1
    fi
    echo "  [db][$DB_NAME] 空库，应用结构基线..."
    OUT=$($CTR exec -i tma-mysql \
      mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
      < infra/database/betogo/schema_baseline.sql 2>&1)
    if [ $? -ne 0 ]; then
      echo "  [db][$DB_NAME] 基线应用失败 — $(echo "$OUT" | grep -v Warning)" >&2
      exit 1
    fi
    echo "  [db][$DB_NAME] 基线已应用，建表 $(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()") 张"
  fi

  me "CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(64) NOT NULL,
    executed_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
  )"

  # 只有「已有业务表但没有迁移记录」的老库才批量标记为已执行。
  # 新开的空库必须从 001 老老实实跑完，否则开出来的站是个没有表的空壳。
  MC=$(mq "SELECT COUNT(*) FROM schema_migrations")
  BG=$(mq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_user'")
  if [ "${MC:-0}" -eq 0 ] && [ "${BG:-0}" -gt 0 ]; then
    echo "  [db][$DB_NAME] 已有数据库，初始化迁移版本记录..."
    MARK_VALUES=""
    for f in $(ls infra/database/betogo/[0-9]*.sql 2>/dev/null | sort); do
      ver=$(basename "$f" .sql)
      MARK_VALUES="${MARK_VALUES}('$ver'),"
    done
    [ -n "$MARK_VALUES" ] && me "INSERT IGNORE INTO schema_migrations (version) VALUES ${MARK_VALUES%,}"
    echo "  [db][$DB_NAME] 已标记 $(mq 'SELECT COUNT(*) FROM schema_migrations') 个迁移为已执行"
  fi

  # 已执行版本一次性取回本地比对：每文件一次 SQL 往返在多租户下会放大成上万次
  APPLIED=$(mq "SELECT version FROM schema_migrations")
  SKIP=0
  RAN=0
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
      echo "  ran[$DB_NAME]: $f"
      RAN=$((RAN+1))
    else
      # 中止整个部署并指明是哪个租户库，不允许跳过继续
      echo "  failed[$DB_NAME]: $f — $(echo "$OUT" | grep -v Warning)" >&2
      exit 1
    fi
  done
  TOTAL_RAN=$((TOTAL_RAN+RAN))
  echo "  [db][$DB_NAME] 执行 $RAN，跳过 $SKIP"
done
echo "  [db] 全部租户库完成，共执行 $TOTAL_RAN 个迁移"
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
    web-platform)
      echo "==> [web-platform] 本地构建..."
      (cd "$ROOT/apps/web-platform" && npm run build)
      echo "==> [web-platform] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-platform/dist/" "$HOST:$DIR/apps/web-platform/dist/"
      echo "==> [web-platform] 同步到站点目录 /platform/..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-platform/dist/" "$HOST:/www/wwwroot/188facai.com/platform/"
      echo "==> [web-platform] 完成（nginx 即时生效，无需重启）"
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
      # i18n key 目录（P1-11）：平台控制台的文案编辑器靠它做搜索。
      # 是构建产物不是迁移，所以跟着 bff 走而不是跟着 db 走。
      if [ -f "$ROOT/infra/i18n/keys.en.json" ]; then
        RSYNC_RSH="$RSYNC_RSH" rsync -az \
          "$ROOT/infra/i18n/" "$HOST:$DIR/infra/i18n/"
      fi
      # 🔴 依赖变更检测必须在同步 lock 之前做。
      # 原来的顺序是「先 rsync 再 dry-run 比对同一个文件」—— 同步完就没差异了，
      # 于是 npm 依赖升级从来不会触发重建镜像，容器一直跑着旧的 node_modules，
      # 而服务器上的 lock 文件却显示已升级，对不上还很难发现。
      if [[ "${BFF_REBUILD_IMAGE:-}" == "1" ]] || \
         RSYNC_RSH="$RSYNC_RSH" rsync -ain \
           "$ROOT/apps/bff-node/package-lock.json" "$HOST:$DIR/apps/bff-node/" | grep -q '^[<>]'; then
        BFF_DEPS_CHANGED=1
      else
        BFF_DEPS_CHANGED=0
      fi
      RSYNC_RSH="$RSYNC_RSH" rsync -az \
        "$ROOT/apps/bff-node/package.json" \
        "$ROOT/apps/bff-node/package-lock.json" \
        "$HOST:$DIR/apps/bff-node/"
      if [[ "$BFF_DEPS_CHANGED" == "1" ]]; then
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
      # 同 bff：先比对再同步，否则依赖升级永远检测不出来
      if [[ "${CORE_REBUILD_IMAGE:-}" == "1" ]] || \
         RSYNC_RSH="$RSYNC_RSH" rsync -ain \
           "$ROOT/apps/core-node/package-lock.json" "$HOST:$DIR/apps/core-node/" | grep -q '^[<>]'; then
        CORE_DEPS_CHANGED=1
      else
        CORE_DEPS_CHANGED=0
      fi
      echo "==> [core-node] 同步 dist..."
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/core-node/dist/" "$HOST:$DIR/apps/core-node/dist/"
      RSYNC_RSH="$RSYNC_RSH" rsync -az \
        "$ROOT/apps/core-node/package.json" \
        "$ROOT/apps/core-node/package-lock.json" \
        "$HOST:$DIR/apps/core-node/"
      if [[ "$CORE_DEPS_CHANGED" == "1" ]]; then
        echo "==> [core-node] 依赖变更，重建镜像并替换容器..."
        ssh "${SSH_ARGS[@]}" "$HOST" "cd '$DIR' && bash deploy/single-node/recreate-core-node.sh"
      else
        echo "==> [core-node] 重启容器..."
        restart_container tma-core-node
      fi
      echo "==> [core-node] 完成"
      ;;
    *)
      echo "未知目标: $TARGET（可选: db | web-tma | web-admin | web-platform | bff-node | core-node | all）" >&2
      exit 1
      ;;
  esac
done
