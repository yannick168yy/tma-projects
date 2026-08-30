#!/usr/bin/env bash
# 生产 AWS 专用发布脚本（把手动流程固化，避开 data/ 误删与 bff-node-2 漏更新的坑）
#
# 🔴 生产保护：本脚本只发代码 dist、不碰数据库、不整树 rsync（只同步各服务 dist 子目录）。
#    运行需交互确认（除非 FORCE=1）。生产数据改删仍须逐次人工授权，不在本脚本范围。
#
# 用法：
#   bash deploy/single-node/deploy-prod.sh <目标...>
#   目标：core | bff | web-tma | web-admin | all
#
# 可选环境变量：
#   FORCE=1                跳过交互确认
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
KEY="${PROD_SSH_KEY:-$HOME/TMA_FILES/亚马逊云-阿里云/betogo-amazon-prod.pem}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no)
RSH="ssh -i $KEY -o StrictHostKeyChecking=no"

[[ $# -eq 0 ]] && { echo "用法: $0 core|bff|web-tma|web-admin|all"; exit 1; }

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

rebuild_bff_node() {  # <容器名> <health端口>
  local c="$1" port="$2"
  echo "==> [$c] 复用 CreateCommand 重建（重读 --env-file）"
  remote "sudo podman inspect $c --format '{{json .Config.CreateCommand}}' > /tmp/cc_$c.json"
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
      remote "sudo podman restart tma-core-node >/dev/null"; sleep 6
      health "http://127.0.0.1:4000/health" core-node
      ;;
    bff)
      echo "### bff-node（逐节点，保持另一节点在线）"
      (cd "$ROOT/apps/bff-node" && npm run build >/dev/null)
      sync_dist bff-node
      sync_bff_runtime_files
      remote "IMG=\$(sudo podman inspect tma-bff-node --format '{{.ImageName}}'); cd $PROD_DIR/apps/bff-node && sudo podman build -t \"\$IMG\" . >/dev/null"
      rebuild_bff_node tma-bff-node-2 3001
      rebuild_bff_node tma-bff-node   3000
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
    *) echo "未知目标: $t"; exit 1 ;;
  esac
done

echo "✅ 发布完成。公网抽查："
remote "curl -s -o /dev/null -w '  betogo.games: %{http_code}\n' https://www.betogo.games/api/v1/home/content"
