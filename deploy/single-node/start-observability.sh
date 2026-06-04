#!/usr/bin/env bash
# 启动/更新 Loki + Promtail + Grafana（podman run，不依赖 podman-compose）
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
CTR="${CTR:-podman}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"
NGINX_LOG_DIR="${NGINX_LOG_DIR:-/www/wwwlogs}"
DIR="${DEPLOY_DIR:-$ROOT}"
OBS="${DIR}/deploy/single-node/observability"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-changeme}"

run() {
  if [[ "$CTR" == podman ]]; then podman "$@"; else docker "$@"; fi
}

if [[ ! -S /var/run/docker.sock ]] && [[ -S /run/podman/podman.sock ]]; then
  ln -sf /run/podman/podman.sock /var/run/docker.sock 2>/dev/null || true
fi

run network inspect "$NET" >/dev/null 2>&1 || run network create "$NET"

run volume create tma-loki-data 2>/dev/null || true
run volume create tma-grafana-data 2>/dev/null || true
run volume create tma-promtail-positions 2>/dev/null || true

echo "==> Loki"
run rm -f tma-loki 2>/dev/null || true
run run -d --name tma-loki --network "$NET" --network-alias loki --restart=always \
  --memory=256m --memory-swap=256m \
  -p 127.0.0.1:3100:3100 \
  -v "${OBS}/loki-config.yaml:/etc/loki/local-config.yaml:ro" \
  -v tma-loki-data:/loki:Z \
  grafana/loki:3.0.0 \
  -config.file=/etc/loki/local-config.yaml

echo "==> Promtail"
run rm -f tma-promtail 2>/dev/null || true
run run -d --name tma-promtail --network "$NET" --restart=always \
  --memory=96m --memory-swap=96m \
  -v "${OBS}/promtail-config.yaml:/etc/promtail/config.yml:ro" \
  -v "${NGINX_LOG_DIR}:/host/nginx:ro" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/containers/storage:/var/lib/containers/storage:ro \
  -v tma-promtail-positions:/tmp:Z \
  grafana/promtail:3.0.0 \
  -config.file=/etc/promtail/config.yml

echo "==> Grafana"
run rm -f tma-grafana 2>/dev/null || true
run run -d --name tma-grafana --network "$NET" --restart=always \
  --memory=128m --memory-swap=128m \
  -p 127.0.0.1:3001:3000 \
  -e "GF_SECURITY_ADMIN_USER=${GRAFANA_ADMIN_USER}" \
  -e "GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}" \
  -e GF_USERS_ALLOW_SIGN_UP=false \
  -e GF_SERVER_ROOT_URL=http://127.0.0.1:3001/ \
  -e GF_SERVER_DOMAIN=127.0.0.1 \
  -e GF_SERVER_HTTP_PORT=3000 \
  -e GF_SERVER_SERVE_FROM_SUB_PATH=false \
  -v "${OBS}/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v tma-grafana-data:/var/lib/grafana:Z \
  grafana/grafana:11.0.0

sleep 3
echo ""
echo "日志栈已启动（仅本机）："
echo "  Grafana:  http://127.0.0.1:3001  用户 ${GRAFANA_ADMIN_USER}"
echo "  Loki:     http://127.0.0.1:3100"
echo "  Nginx 日志: ${NGINX_LOG_DIR}"
run ps --filter name=tma-loki --filter name=tma-promtail --filter name=tma-grafana --format "table {{.Names}}\t{{.Status}}"
