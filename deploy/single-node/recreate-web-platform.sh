#!/usr/bin/env bash
# 创建/重建平台控制台容器（包网运营商管理后台）。
#
# 🔴 端口只绑 127.0.0.1：这个后台能开站、改套餐、看所有租户的资金，绝不能直接对公网监听。
#    对比：tma-web-admin 用的是 `-p 8085:80`（绑 0.0.0.0），这里刻意不照抄。
#    公网入口由宿主 nginx 提供，并在那里做 IP 白名单，见 nginx-platform-prod.conf。
#
# 用法（服务器上）：
#   sudo bash deploy/single-node/recreate-web-platform.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
DIR="$(pwd)"
CTR="${CTR:-podman}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"
PORT="${PLATFORM_PORT:-8090}"

run() { if [[ "$CTR" == podman ]]; then podman "$@"; else docker "$@"; fi; }

[[ -d "$DIR/apps/web-platform/dist" ]] || {
  echo "找不到 apps/web-platform/dist，请先在本地构建并同步（deploy-prod.sh web-platform）" >&2
  exit 1
}

run build -t betogo-web-platform:latest -f apps/web-platform/Dockerfile apps/web-platform
run rm -f tma-web-platform 2>/dev/null || true
run run -d --name tma-web-platform --network "$NET" --restart=always \
  --log-driver=json-file --log-opt max-size=20m --log-opt max-file=3 \
  --memory=128m --memory-swap=128m \
  -v "$DIR/apps/web-platform/dist":/usr/share/nginx/html/platform:ro \
  -p 127.0.0.1:${PORT}:80 \
  betogo-web-platform:latest

sleep 3
run ps --format '{{.Names}} {{.Status}}' | grep tma-web-platform
echo "本机自检: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/platform/)"
