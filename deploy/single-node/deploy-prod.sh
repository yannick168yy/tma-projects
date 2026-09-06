#!/usr/bin/env bash
# 生产 AWS 专用发布脚本（把手动流程固化，避开 data/ 误删与 bff-node-2 漏更新的坑）
#
# 🔴 生产保护：本脚本只发代码 dist、不碰数据库、不整树 rsync（只同步各服务 dist 子目录）。
#    运行需交互确认（除非 FORCE=1）。生产数据改删仍须逐次人工授权，不在本脚本范围。
#
# 用法：
#   bash deploy/single-node/deploy-prod.sh <目标...>
#   目标：core | bff | web-tma | web-admin | web-platform | db | all
#         all = core bff web-tma web-admin（db 与 web-platform 必须点名，不进 all）
#         db  = 平台库 + 各租户库迁移，逻辑见 remote-migrate.sh
#
# 可选环境变量：
#   FORCE=1                跳过交互确认（db 目标不吃这个，见下）
#   RECREATE=1             core 目标改为重建容器而非 restart —— .env 里新增的变量
#                          只有重建才带得进去，restart 不重读 env-file
#   PLATFORM_SITE_DIR=…    web-platform 的 nginx 站点目录（未设置则只同步 dist）
#   SYNC_ENV_KEYS="A B"    重建时从 .env 补进容器的变量白名单（默认见 inject_env_keys）
#   REBUILD_ADMIN_IMAGE=1  改了 web-admin 的 nginx/default.conf 时，重建其镜像使 nginx 配置生效
#                          （只 rsync dist 不会更新 nginx conf——conf 在镜像内）
#
# 形态说明（见 memory reference_prod_deploy_mechanics / reference_prod_version_drift）：
#   - 四个服务容器都把宿主 dist 以卷挂载：更新代码 = rsync dist 到宿主对应目录
#   - core / web-tma / web-admin：rsync 后 restart（web 前端静态，restart 亦可即时生效）
#   - bff 有两个节点(tma-bff-node:3000 + tma-bff-node-2:3001)，且用 /tmp/*.recreate.env 作 --env-file：
#     必须逐节点复用 CreateCommand 重建(rm+run)才能重读 env-file，podman restart 不重读 env-file
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD_HOST="${PROD_HOST:-ubuntu@13.213.107.231}"
PROD_DIR="${PROD_DIR:-/opt/tma-projects}"
KEY="${PROD_SSH_KEY:-/Volumes/MacImage/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no)
RSH="ssh -i $KEY -o StrictHostKeyChecking=no"

[[ $# -eq 0 ]] && { echo "用法: $0 core|bff|web-tma|web-admin|web-platform|db|all"; exit 1; }

TARGETS=("$@")
[[ "${1:-}" == all ]] && TARGETS=(core bff web-tma web-admin)

echo "🔴 目标生产：$PROD_HOST:$PROD_DIR"
echo "   将发布：${TARGETS[*]}"
if [[ "${FORCE:-}" != 1 ]]; then
  read -r -p "确认发布到生产？(yes/no) " ans
  [[ "$ans" == yes ]] || { echo "已取消"; exit 1; }
fi

remote() { "${SSH[@]}" "$PROD_HOST" "$@"; }

sync_dist() {  # <app目录名>
  local app="$1"
  echo "==> [$app] rsync dist（仅 dist 子目录，不碰 data）"
  rsync -az --delete -e "$RSH" \
    "$ROOT/apps/$app/dist/" "$PROD_HOST:$PROD_DIR/apps/$app/dist/"
}

sync_bff_runtime_files() {
  echo "==> [bff-node] rsync package/Dockerfile（供镜像安装运行时依赖）"
  rsync -az -e "$RSH" \
    "$ROOT/apps/bff-node/package.json" \
    "$ROOT/apps/bff-node/package-lock.json" \
    "$ROOT/apps/bff-node/Dockerfile" \
    "$PROD_HOST:$PROD_DIR/apps/bff-node/"
}

health() {  # <url> <标签>
  local code; code=$(remote "curl -s -o /dev/null -w '%{http_code}' $1" || echo 000)
  echo "    $2 health: $code"
  [[ "$code" == 200 ]] || echo "    ⚠️ $2 非 200，请检查日志"
}

# 重建是回放旧容器的 CreateCommand，里面的 --env 是上一代容器的快照 ——
# 往 .env 里新加的变量永远进不来，表现是新功能在生产静默失效（不报错，只是值为空）。
# 这里把白名单内的键从 .env 补进重放命令。SYNC_ENV_KEYS 可覆盖，空格分隔。
inject_env_keys() {  # <容器名>
  local c="$1"
  "${SSH[@]}" "$PROD_HOST" "sudo python3 - '$PROD_DIR/.env' '/tmp/cc_$c.json' ${SYNC_ENV_KEYS:-APP_ROUTE_SIGNING_KEY PLATFORM_CREDENTIAL_KEY PLATFORM_ROOT_DOMAIN RISK_FEDERATION_PEPPER SERVER_PUBLIC_IP TENANT_RESOLVE_STRICT MYSQL_PLATFORM_DATABASE MYSQL_PLATFORM_POOL_SIZE PLATFORM_ADMIN_USERNAME PLATFORM_ADMIN_PASSWORD MYSQL_PROVISION_USER MYSQL_PROVISION_PASSWORD}" <<'PYEOF'
import json, sys
env_path, cc_path, *keys = sys.argv[1:]
cc = json.load(open(cc_path))
env = dict(l.split('=', 1) for l in open(env_path).read().splitlines() if '=' in l and not l.startswith('#'))
insert_at = cc.index('run') + 1
added = []
for key in keys:
    if any(a.startswith(key + '=') for a in cc):
        continue
    if key not in env:
        continue
    cc[insert_at:insert_at] = ['--env', key + '=' + env[key]]
    added.append(key)
if added:
    json.dump(cc, open(cc_path, 'w'))
print('    补入 env:', ','.join(added) if added else '（无需补入）')
PYEOF
}

# 复用 CreateCommand 重建容器：podman restart 不重读 --env-file，也带不进 .env 新增的变量
rebuild_container() {  # <容器名> <health端口>
  local c="$1" port="$2"
  echo "==> [$c] 复用 CreateCommand 重建（重读 --env-file）"
  # 必须 root 建 root 写：fs.protected_regular=2 下 root 不能写 ubuntu 拥有的 /tmp 文件，
  # 用 shell 重定向（属主 ubuntu）后面 inject_env_keys 会 PermissionError
  remote "sudo rm -f /tmp/cc_$c.json && sudo podman inspect $c --format '{{json .Config.CreateCommand}}' | sudo tee /tmp/cc_$c.json > /dev/null"
  inject_env_keys "$c"
  # /tmp 会被系统清理，env-file 丢了 run 会失败且容器已被 rm——重建前先从在线容器导出兜底
  remote "sudo podman inspect $c --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|TERM|HOSTNAME|container|HOME|NODE_VERSION|YARN_VERSION)=' | grep -v '^\$' > /tmp/$c.recreate.env"
  remote "sudo podman rm -f $c >/dev/null"
  remote "sudo python3 -c 'import json,subprocess; subprocess.run(json.load(open(\"/tmp/cc_$c.json\")),check=True)'"
  sleep 7
  remote "sudo podman ps --format '{{.Names}} {{.Status}}' | grep '$c '"
  health "http://127.0.0.1:$port/health" "$c"
}

for t in "${TARGETS[@]}"; do
  case "$t" in
    core)
      echo "### core-node"
      (cd "$ROOT/apps/core-node" && npm run build >/dev/null)
      sync_dist core-node
      # 默认 restart（快）。但 restart 既不重读 env-file 也带不进 .env 新增的变量 ——
      # 包网升级这类要注入平台层变量的发布，必须 RECREATE=1 走重建。
      if [[ "${RECREATE:-}" == 1 ]]; then
        rebuild_container tma-core-node 4000
      else
        remote "sudo podman restart tma-core-node >/dev/null"; sleep 6
        health "http://127.0.0.1:4000/health" core-node
      fi
      ;;
    bff)
      echo "### bff-node（逐节点，保持另一节点在线）"
      (cd "$ROOT/apps/bff-node" && npm run build >/dev/null)
      sync_dist bff-node
      sync_bff_runtime_files
      remote "IMG=\$(sudo podman inspect tma-bff-node --format '{{.ImageName}}'); cd $PROD_DIR/apps/bff-node && sudo podman build -t \"\$IMG\" . >/dev/null"
      rebuild_container tma-bff-node-2 3001
      rebuild_container tma-bff-node   3000
      ;;
    web-tma)
      echo "### web-tma"
      (cd "$ROOT/apps/web-tma" && npm run build >/dev/null)
      sync_dist web-tma
      remote "sudo install -d -m 755 $PROD_DIR/data/apk/ph $PROD_DIR/data/apk/id && sudo install -m 644 $PROD_DIR/apps/web-tma/dist/app/ph/betogo.apk $PROD_DIR/data/apk/ph/betogo.apk && sudo install -m 644 $PROD_DIR/apps/web-tma/dist/app/id/betogo.apk $PROD_DIR/data/apk/id/betogo.apk"
      health "http://127.0.0.1:8080/" web-tma
      ;;
    web-admin)
      echo "### web-admin"
      (cd "$ROOT/apps/web-admin" && npm run build >/dev/null)
      sync_dist web-admin
      if [[ "${REBUILD_ADMIN_IMAGE:-}" == 1 ]]; then
        echo "==> [web-admin] 重建镜像（更新 nginx 配置）"
        rsync -az -e "$RSH" "$ROOT/apps/web-admin/nginx/default.conf" \
          "$PROD_HOST:$PROD_DIR/apps/web-admin/nginx/default.conf"
        remote "IMG=\$(sudo podman inspect tma-web-admin --format '{{.ImageName}}'); cd $PROD_DIR/apps/web-admin && sudo podman build -t \"\$IMG\" . >/dev/null && sudo podman inspect tma-web-admin --format '{{json .Config.CreateCommand}}' > /tmp/cc_admin.json && sudo podman rm -f tma-web-admin >/dev/null && sudo python3 -c 'import json,subprocess; subprocess.run(json.load(open(\"/tmp/cc_admin.json\")),check=True)'"
        sleep 5
      fi
      health "http://127.0.0.1:8085/" web-admin
      ;;
    web-platform)
      echo "### web-platform（平台控制台）"
      (cd "$ROOT/apps/web-platform" && npm run build >/dev/null)
      remote "mkdir -p $PROD_DIR/apps/web-platform/dist"
      sync_dist web-platform
      if [[ -n "${PLATFORM_SITE_DIR:-}" ]]; then
        echo "==> [web-platform] 同步到站点目录 $PLATFORM_SITE_DIR"
        rsync -az --delete -e "$RSH" \
          "$ROOT/apps/web-platform/dist/" "$PROD_HOST:$PLATFORM_SITE_DIR/"
        echo "    完成（静态文件，nginx 即时生效）"
      else
        echo "    ⚠️ 未设置 PLATFORM_SITE_DIR：dist 已就位，但还没有 nginx 站点承载它。"
        echo "       平台控制台必须用独立域名 + IP 白名单，不能与租户站点共用域名。"
      fi
      ;;
    db)
      echo "### 数据库迁移（平台库 + 各租户库）"
      # DDL 变更属于「改生产数据」。按 CLAUDE.md 铁律，这一步不吃 FORCE=1，每次都要人手确认。
      read -r -p "确认在生产执行数据库迁移？输入 MIGRATE 继续: " mans
      [[ "$mans" == MIGRATE ]] || { echo "已取消"; exit 1; }
      echo "==> [db] 同步迁移文件与执行脚本"
      rsync -az -e "$RSH" "$ROOT/infra/database/betogo/"   "$PROD_HOST:$PROD_DIR/infra/database/betogo/"
      rsync -az -e "$RSH" "$ROOT/infra/database/platform/" "$PROD_HOST:$PROD_DIR/infra/database/platform/"
      remote "mkdir -p $PROD_DIR/deploy/single-node"
      rsync -az -e "$RSH" "$ROOT/deploy/single-node/remote-migrate.sh" \
        "$PROD_HOST:$PROD_DIR/deploy/single-node/"
      # 生产 .env 是 root:root 600，容器是 rootful：整段以 root 跑，root 下 podman 即 rootful
      remote "sudo env APP_DIR=$PROD_DIR CTR=podman MYSQL_CTR=tma-mysql bash $PROD_DIR/deploy/single-node/remote-migrate.sh all"
      ;;
    *) echo "未知目标: $t"; exit 1 ;;
  esac
done

echo "✅ 发布完成。公网抽查："
remote "curl -s -o /dev/null -w '  betogo.games: %{http_code}\n' https://www.betogo.games/api/v1/home/content"
