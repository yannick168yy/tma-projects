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
# 目标（可多个）：db | web-tma | web-tma-tenant | web-admin | web-platform | bff-node | core-node | all
#   db = 只跑平台库+租户库迁移，不构建不重启
#
# 可选：REMOTE_CTR（远端容器命令，默认自动探测 podman/docker）
#       MYSQL_CTR（MySQL 容器名，默认 tma-mysql）

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

# 迁移逻辑在 remote-migrate.sh 里（测试与生产共用一份）。此处只负责把文件送过去再触发。
sync_migrator() {
  ssh "${SSH_ARGS[@]}" "$HOST" "mkdir -p '$DIR/deploy/single-node'"
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/deploy/single-node/remote-migrate.sh" "$HOST:$DIR/deploy/single-node/"
}

remote_migrate() {  # <platform|tenants>
  ssh "${SSH_ARGS[@]}" "$HOST" \
    "APP_DIR='$DIR' CTR='${REMOTE_CTR:-}' MYSQL_CTR='${MYSQL_CTR:-tma-mysql}' bash '$DIR/deploy/single-node/remote-migrate.sh' $1"
}

run_platform_migrations() {
  echo "==> [db] 同步并执行平台库迁移..."
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/infra/database/platform/" "$HOST:$DIR/infra/database/platform/"
  sync_migrator
  remote_migrate platform
}

run_db_migrations() {
  echo "==> [db] 同步并执行迁移..."
  RSYNC_RSH="$RSYNC_RSH" rsync -az \
    "$ROOT/infra/database/betogo/" "$HOST:$DIR/infra/database/betogo/"
  sync_migrator
  remote_migrate tenants
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
    # overlay 租户前台（P3-4）：TENANT=<code> bash deploy-fast.sh web-tma-tenant
    # 产物与主干完全分开（dist-tenants/<code>/ + base=/t/<code>/），
    # 站点目录也分开 —— 两份产物混在一个目录里，assets 名字撞了就会加载到别人的 chunk
    web-tma-tenant)
      if [[ -z "${TENANT:-}" ]]; then
        echo "需要 TENANT=<租户代号>" >&2; exit 1
      fi
      TENANT_SITE_DIR="${TENANT_SITE_DIR:-/www/wwwroot/188facai.com/t/$TENANT}"
      echo "==> [web-tma:$TENANT] 本地构建 overlay 产物..."
      (cd "$ROOT/apps/web-tma" && TENANT="$TENANT" npm run build:tenant)
      echo "==> [web-tma:$TENANT] 生成 gzip 静态资源..."
      find "$ROOT/apps/web-tma/dist-tenants/$TENANT" -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.html' \) \
        -exec gzip -9 -k -f {} \;
      echo "==> [web-tma:$TENANT] 同步到 $TENANT_SITE_DIR ..."
      ssh "${SSH_ARGS[@]}" "$HOST" "mkdir -p '$TENANT_SITE_DIR'"
      RSYNC_RSH="$RSYNC_RSH" rsync -az --delete \
        "$ROOT/apps/web-tma/dist-tenants/$TENANT/" "$HOST:$TENANT_SITE_DIR/"
      echo "==> [web-tma:$TENANT] 完成"
      ;;
    web-platform)
      echo "==> [web-platform] 本地构建（测试环境挂在 188facai.com/platform/ 下，必须带前缀）..."
      # 生产有独立域名走根路径，这里只有一个域名，只能用路径前缀跟租户站共存
      (cd "$ROOT/apps/web-platform" && PLATFORM_BASE=/platform/ npm run build)
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
      echo "未知目标: $TARGET（可选: db | web-tma | web-tma-tenant | web-admin | web-platform | bff-node | core-node | all）" >&2
      exit 1
      ;;
  esac
done
