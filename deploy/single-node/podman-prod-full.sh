#!/usr/bin/env bash
# 阿里云全量栈（Nacos + Podman MySQL + RabbitMQ + core-java）— 仅 4G+ 或本地压测
# 默认生产请用 podman-prod-minimal.sh
# 在服务器 /opt/tma-projects 目录内执行；由 deploy-web-tma.sh 调用

set -euo pipefail

cd "$(dirname "$0")/../.."
CTR="${CTR:-podman}"
PORT="${WEB_TMA_PORT:-8080}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"

if [[ "$CTR" != podman ]] && [[ "$CTR" != docker ]]; then
  echo "CTR 必须是 podman 或 docker" >&2
  exit 1
fi

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ [[:space:]] ]] && continue
    export "${key}=${val}"
  done < .env
  sed -i 's/^BFF_DEV_SKIP_TELEGRAM_AUTH=true/BFF_DEV_SKIP_TELEGRAM_AUTH=false/' .env || true
fi

run() {
  if [[ "$CTR" == podman ]]; then
    podman "$@"
  else
    docker "$@"
  fi
}

echo "==> [${CTR}] 创建网络 ${NET}"
run network inspect "$NET" >/dev/null 2>&1 || run network create "$NET"

echo "==> [${CTR}] 拉取基础镜像"
run pull redis:7.0-alpine
run pull mysql:8.0
run pull rabbitmq:3.13-management-alpine
run pull nacos/nacos-server:v2.3.2-slim

echo "==> [${CTR}] Nacos (limit 384m)"
run rm -f tma-nacos 2>/dev/null || true
run volume create tma-nacos-data 2>/dev/null || true
run run -d --name tma-nacos --network "$NET" --network-alias nacos --restart=always \
  --memory=384m --memory-swap=384m \
  -p 127.0.0.1:8848:8848 \
  -v tma-nacos-data:/home/nacos/data:Z \
  -e MODE=standalone \
  -e NACOS_AUTH_ENABLE=false \
  -e JVM_XMS=256m \
  -e JVM_XMX=256m \
  -e JVM_XMN=128m \
  nacos/nacos-server:v2.3.2-slim

echo "==> [${CTR}] MySQL (limit 384m)"
run rm -f tma-mysql 2>/dev/null || true
run volume create tma-mysql-data 2>/dev/null || true
run run -d --name tma-mysql --network "$NET" --restart=always \
  --memory=384m --memory-swap=384m \
  -p 127.0.0.1:13306:3306 \
  -v tma-mysql-data:/var/lib/mysql:Z \
  -v "$(pwd)/infra/docker/mysql/init:/docker-entrypoint-initdb.d:ro,Z" \
  -e MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-root_dev_only}" \
  -e MYSQL_DATABASE="${MYSQL_DATABASE:-betogo}" \
  -e MYSQL_USER="${MYSQL_BETOGO_USER:-betogo}" \
  -e MYSQL_PASSWORD="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}" \
  -e TZ=UTC \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --default-authentication-plugin=mysql_native_password \
  --max_connections=50 \
  --innodb_buffer_pool_size=48M \
  --performance_schema=OFF \
  --table_open_cache=200

echo "==> [${CTR}] Redis (limit 96m, maxmemory 64mb)"
run rm -f tma-redis 2>/dev/null || true
run run -d --name tma-redis --network "$NET" --network-alias redis --restart=always \
  --memory=96m --memory-swap=96m \
  -p 127.0.0.1:6379:6379 \
  redis:7.0-alpine \
  redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru --save "" --appendonly no

echo "==> [${CTR}] RabbitMQ (limit 256m)"
run rm -f tma-rabbitmq 2>/dev/null || true
run volume create tma-rabbitmq-data 2>/dev/null || true
run run -d --name tma-rabbitmq --network "$NET" --restart=always \
  --memory=256m --memory-swap=256m \
  -p 127.0.0.1:5672:5672 \
  -p 127.0.0.1:15672:15672 \
  -v tma-rabbitmq-data:/var/lib/rabbitmq:Z \
  -v "$(pwd)/deploy/single-node/rabbitmq-prod.conf:/etc/rabbitmq/rabbitmq.conf:ro,Z" \
  -e RABBITMQ_DEFAULT_USER="${RABBITMQ_USER:-tma}" \
  -e RABBITMQ_DEFAULT_PASS="${RABBITMQ_PASSWORD:-tma_dev}" \
  rabbitmq:3.13-management-alpine

echo "==> [${CTR}] core-java 占位 (limit 128m)"
run rm -f tma-core-java 2>/dev/null || true
run build -t betogo-core-java:placeholder -f apps/core-java/Dockerfile apps/core-java
run run -d --name tma-core-java --network "$NET" --restart=always \
  --memory=128m --memory-swap=128m \
  -p 127.0.0.1:8081:8080 \
  betogo-core-java:placeholder

echo "==> [${CTR}] bff-node (limit 256m)"
NACOS_IP="$(run inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' tma-nacos 2>/dev/null || echo "")"
REDIS_IP="$(run inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' tma-redis 2>/dev/null || echo "")"
if [[ -z "$NACOS_IP" ]]; then
  NACOS_ADDR="127.0.0.1:8848"
else
  NACOS_ADDR="${NACOS_IP}:8848"
fi
REDIS_URL_WIRED="redis://${REDIS_IP:-127.0.0.1}:6379"
run rm -f tma-bff-node 2>/dev/null || true
run build -t betogo-bff-node:latest -f apps/bff-node/Dockerfile apps/bff-node
# 宝塔 MySQL 在宿主机 3306；容器内用 host.containers.internal（勿在 Nacos 写 127.0.0.1）
MYSQL_HOST_WIRED="${MYSQL_HOST:-host.containers.internal}"
MYSQL_PORT_WIRED="${MYSQL_PORT:-3306}"
run run -d --name tma-bff-node --network "$NET" --restart=always \
  --memory=256m --memory-swap=256m \
  --add-host=host.containers.internal:host-gateway \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e BFF_PORT=3000 \
  -e REDIS_URL="${REDIS_URL_WIRED}" \
  -e TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?缺少 TELEGRAM_BOT_TOKEN}" \
  -e BFF_DEV_SKIP_TELEGRAM_AUTH="${BFF_DEV_SKIP_TELEGRAM_AUTH:-false}" \
  -e BFF_ADMIN_TOTP_REQUIRED="${BFF_ADMIN_TOTP_REQUIRED:-false}" \
  -e SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-86400}" \
  -e GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  -e GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  -e GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  -e TELEGRAM_OIDC_BOT_TOKENS="${TELEGRAM_OIDC_BOT_TOKENS:-}" \
  -e IMAGE_CDN_BASE="${IMAGE_CDN_BASE:-}" \
  -e S3_BUCKET="${S3_BUCKET:-}" \
  -e S3_REGION="${S3_REGION:-}" \
  -e S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}" \
  -e S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}" \
  -e S3_ENDPOINT="${S3_ENDPOINT:-}" \
  -e S3_PUBLIC_BASE_URL="${S3_PUBLIC_BASE_URL:-}" \
  -e NACOS_SERVER_ADDR="${NACOS_ADDR}" \
  -e NACOS_NAMESPACE="${NACOS_NAMESPACE:-batogo}" \
  -e NACOS_DATA_ID="${NACOS_DATA_ID:-bff-node}" \
  -e NACOS_GROUP="${NACOS_GROUP:-DEFAULT_GROUP}" \
  -e AMMER_PAY_PROVIDER_TOKEN="${AMMER_PAY_PROVIDER_TOKEN:-}" \
  -e USDT_TO_PHP_RATE="${USDT_TO_PHP_RATE:-58}" \
  -e MYSQL_HOST="${MYSQL_HOST_WIRED}" \
  -e MYSQL_PORT="${MYSQL_PORT_WIRED}" \
  -e MYSQL_DATABASE="${MYSQL_DATABASE:-betogo}" \
  -e MYSQL_USER="${MYSQL_BETOGO_USER:-betogo}" \
  -e MYSQL_PASSWORD="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}" \
  betogo-bff-node:latest

echo "==> [${CTR}] web-tma (limit 64m)"
run rm -f tma-web-tma 2>/dev/null || true
run build -t tma-web-tma:latest \
  --build-arg "VITE_BFF_BASE_URL=${VITE_BFF_BASE_URL:-https://www.188facai.com/api/v1}" \
  --build-arg VITE_USE_MOCK_API=false \
  --build-arg "VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}" \
  --build-arg "VITE_GOOGLE_REDIRECT_URI=${VITE_GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  --build-arg "VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME:-BetoGoBot}" \
  --build-arg "VITE_TELEGRAM_WEB_APP_URL=${VITE_TELEGRAM_WEB_APP_URL:-https://www.188facai.com}" \
  -f apps/web-tma/Dockerfile apps/web-tma
run run -d --name tma-web-tma --restart=always \
  --memory=64m --memory-swap=64m \
  -p "${PORT}:80" \
  tma-web-tma:latest

echo "==> 等待 Nacos 并发布 bff-node 配置"
sleep 15
if curl -sf "http://127.0.0.1:8848/nacos/v1/console/health/readiness" >/dev/null 2>&1; then
  NS="${NACOS_NAMESPACE:-batogo}"
  curl -sf -X POST "http://127.0.0.1:8848/nacos/v1/console/namespaces" \
    -d "customNamespaceId=${NS}&namespaceName=BetoGo&namespaceDesc=prod" >/dev/null || true
  BFF_NACOS_CONTENT="# prod from podman-prod-up
NODE_ENV=production
USDT_TO_PHP_RATE=${USDT_TO_PHP_RATE:-58}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
AMMER_PAY_PROVIDER_TOKEN=${AMMER_PAY_PROVIDER_TOKEN:-}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}
MYSQL_DATABASE=betogo
MYSQL_USER=${MYSQL_BETOGO_USER:-betogo}
MYSQL_PASSWORD=${MYSQL_BETOGO_PASSWORD:-}
"
  curl -sf -X POST "http://127.0.0.1:8848/nacos/v1/cs/configs" \
    --data-urlencode "dataId=bff-node" \
    --data-urlencode "group=DEFAULT_GROUP" \
    --data-urlencode "tenant=${NS}" \
    --data-urlencode "type=properties" \
    --data-urlencode "content=${BFF_NACOS_CONTENT}" >/dev/null && echo "  nacos config: ok" || echo "  nacos config: fail"
else
  echo "  nacos: 未就绪（跳过配置发布）"
fi

echo "==> 等待服务就绪…"
sleep 8
curl -sf http://127.0.0.1:3000/health >/dev/null && echo "  bff-node: ok" || echo "  bff-node: 未就绪"
run exec tma-redis redis-cli ping 2>/dev/null | grep -q PONG && echo "  redis: ok" || echo "  redis: 未就绪"
run exec tma-mysql mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-root_dev_only}" 2>/dev/null | grep -q alive && echo "  mysql: ok" || echo "  mysql: 启动中"
run exec tma-rabbitmq rabbitmq-diagnostics -q ping 2>/dev/null && echo "  rabbitmq: ok" || echo "  rabbitmq: 启动中"

echo ""
run ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
