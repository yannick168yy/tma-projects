#!/usr/bin/env bash
# 将 web-tma 部署到远程 Linux 服务器（Docker）
#
# 用法:
#   export DEPLOY_HOST=root@你的公网IP
#   export DEPLOY_DIR=/opt/tma-projects
#   export SSH_IDENTITY_FILE=~/Downloads/your.pem   # 阿里云密钥对
#   ./deploy/single-node/deploy-web-tma.sh
#
# 可选:
#   WEB_TMA_PORT=8080   宿主机映射端口（默认 8080）
#   SKIP_GIT_PULL=1     不在服务器上 git pull（仅重建镜像）
#   SSH_OPTS            额外 ssh 参数，如 "-o StrictHostKeyChecking=no"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 root@1.2.3.4}"
DIR="${DEPLOY_DIR:-/opt/tma-projects}"
PORT="${WEB_TMA_PORT:-8080}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/single-node/docker-compose.prod.yml}"

SSH_BASE=(ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=20)
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  KEY="${SSH_IDENTITY_FILE/#\~/$HOME}"
  if [[ ! -f "$KEY" ]]; then
    echo "错误: SSH_IDENTITY_FILE 不存在: $KEY" >&2
    exit 1
  fi
  SSH_BASE+=( -i "$KEY" )
  export RSYNC_RSH="ssh -i $KEY"
fi
if [[ -n "${SSH_OPTS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA=( $SSH_OPTS )
  SSH_BASE+=( "${EXTRA[@]}" )
  if [[ -n "${RSYNC_RSH:-}" ]]; then
    export RSYNC_RSH="${RSYNC_RSH} ${SSH_OPTS}"
  else
    export RSYNC_RSH="ssh ${SSH_OPTS}"
  fi
fi

ssh_cmd() {
  "${SSH_BASE[@]}" "$HOST" "$@"
}

rsync_cmd() {
  # ⚠️ data/ 是服务器运行时数据(封面/banner/KYC上传, KYC_STORAGE_DIR=data/kyc)，
  # 本地没有这些文件，--delete 会把线上传的图全删掉——2026-07-19 生产 covers 因此被清空过，必须排除
  rsync -az --delete \
    --exclude node_modules \
    --exclude .git/objects \
    --exclude data/ \
    "$ROOT/" "$HOST:$DIR/"
}

echo "==> 本地构建 dist（四个服务）"
(cd "$ROOT/apps/web-tma" && npm run build)
(cd "$ROOT/apps/web-admin" && npm run build)
(cd "$ROOT/apps/bff-node" && npm run build)
(cd "$ROOT/apps/core-node" && npm run build)

echo "==> 同步代码到 ${HOST}:${DIR}"
ssh_cmd "mkdir -p '$DIR'"
echo "==> 确保远程已安装 rsync"
ssh_cmd 'command -v rsync >/dev/null || {
  if command -v dnf >/dev/null; then dnf install -y rsync
  elif command -v yum >/dev/null; then yum install -y rsync
  elif command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y rsync
  else echo "请手动安装 rsync" >&2; exit 1
  fi
}'
rsync_cmd

echo "==> 远程构建并启动容器（端口 ${PORT}）"
ssh_cmd bash -s "$DIR" "$PORT" "$COMPOSE_FILE" "${SKIP_GIT_PULL:-}" <<'REMOTE_EOF'
set -euo pipefail
cd "$1"
PORT="$2"
COMPOSE_FILE="$3"
SKIP_GIT_PULL="${4:-}"

start_container_runtime() {
  if systemctl list-unit-files docker.service 2>/dev/null | grep -q '^docker.service'; then
    systemctl enable --now docker
    return
  fi
  if systemctl list-unit-files podman.socket 2>/dev/null | grep -q '^podman.socket'; then
    systemctl enable --now podman.socket
    return
  fi
  echo "警告: 未找到 docker.service / podman.socket，继续尝试 compose…" >&2
}

install_container_tools() {
  if command -v docker >/dev/null 2>&1 || command -v podman >/dev/null 2>&1; then
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y podman podman-docker 2>/dev/null \
      || dnf install -y docker docker-compose-plugin 2>/dev/null \
      || dnf install -y docker
  elif command -v yum >/dev/null 2>&1; then
    yum install -y podman podman-docker 2>/dev/null || yum install -y docker
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y docker.io docker-compose-plugin 2>/dev/null \
      || apt-get install -y docker.io docker-compose
  else
    echo "请先安装 Docker 或 Podman" >&2
    exit 1
  fi
}

container_cmd() {
  if command -v docker >/dev/null 2>&1; then echo docker; elif command -v podman >/dev/null 2>&1; then echo podman; else echo ""; fi
}

direct_build_run() {
  echo "==> 无 compose 插件，使用 podman-prod-minimal.sh（web + BFF + Redis）"
  export WEB_TMA_PORT="$PORT"
  export CTR="$(container_cmd)"
  chmod +x deploy/single-node/podman-prod-minimal.sh deploy/single-node/podman-prod-up.sh
  bash deploy/single-node/podman-prod-minimal.sh
}

compose_up() {
  export WEB_TMA_PORT="$PORT"
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" up -d --build
  elif podman compose version >/dev/null 2>&1; then
    podman compose -f "$COMPOSE_FILE" up -d --build
  elif docker-compose version >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" up -d --build
  else
    # 阿里云 Alibaba Cloud Linux：通常仅有 podman-docker，无 compose 插件
    direct_build_run
  fi
}

install_container_tools
start_container_runtime

if [[ "$SKIP_GIT_PULL" != "1" ]] && [[ -d .git ]] && command -v git >/dev/null 2>&1; then
  git pull --ff-only origin main || true
fi

# 生产环境：关闭 Dev 登录绕过；前端 API 勿用 localhost（手机/TG 会 Load Failed）
if [[ -f .env ]]; then
  sed -i 's/^BFF_DEV_SKIP_TELEGRAM_AUTH=true/BFF_DEV_SKIP_TELEGRAM_AUTH=false/' .env || true
  if grep -q '^VITE_BFF_BASE_URL=.*localhost' .env 2>/dev/null || ! grep -q '^VITE_BFF_BASE_URL=' .env 2>/dev/null; then
    if grep -q '^VITE_BFF_BASE_URL=' .env; then
      sed -i 's|^VITE_BFF_BASE_URL=.*|VITE_BFF_BASE_URL=https://www.188facai.com/api/v1|' .env
    else
      echo 'VITE_BFF_BASE_URL=https://www.188facai.com/api/v1' >> .env
    fi
  fi
fi

compose_up

# 配置 Nginx 反向代理 /api/ → BFF（宝塔面板）
NGINX_BFF_CONF="/www/server/panel/vhost/nginx/proxy/188facai.com/bff-api.conf"
if [[ -f deploy/single-node/nginx-bff-proxy.conf ]] && [[ ! -f "$NGINX_BFF_CONF" ]]; then
  echo "==> 安装 Nginx BFF 反向代理"
  cp deploy/single-node/nginx-bff-proxy.conf "$NGINX_BFF_CONF"
  nginx -t && nginx -s reload || systemctl reload nginx || true
fi

if docker ps --filter name=tma-web-tma 2>/dev/null | grep -q tma-web-tma; then
  docker ps -a --filter name=tma- --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker ps --filter name=tma-web-tma
elif podman ps --filter name=tma-web-tma 2>/dev/null | grep -q tma-web-tma; then
  podman ps -a --filter name=tma- --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || podman ps --filter name=tma-web-tma
else
  docker ps -a 2>/dev/null || podman ps -a
fi
echo ""
echo "客户端已启动: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):${PORT}"
REMOTE_EOF

echo "==> 完成"
