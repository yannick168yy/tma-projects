#!/usr/bin/env bash
# 阿里云 2C2G：web-tma + bff-node + core-node + nats + redis + 容器 MySQL（betogo）
# 表结构：infra/database/betogo/001_schema.sql（与本地 scripts/apply-betogo-schema.sh 同源）
set -euo pipefail

cd "$(dirname "$0")/../.."
DIR="${DEPLOY_DIR:-$(pwd)}"
CTR="${CTR:-podman}"
PORT="${WEB_TMA_PORT:-8080}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"

if [[ "$CTR" != podman ]] && [[ "$CTR" != docker ]]; then
  echo "CTR 必须是 podman 或 docker" >&2
  exit 1
fi

if [[ -f .env ]]; then
  # 安全解析 .env：逐行读取，避免含空格的 PEM key 值被 bash 当命令执行
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ [[:space:]] ]] && continue
    export "${key}=${val}"
  done < .env
  sed -i 's/^BFF_DEV_SKIP_TELEGRAM_AUTH=true/BFF_DEV_SKIP_TELEGRAM_AUTH=false/' .env || true
fi

WEB_BFF_API_URL="${VITE_BFF_BASE_URL:-}"
if [[ -z "$WEB_BFF_API_URL" || "$WEB_BFF_API_URL" == *localhost* || "$WEB_BFF_API_URL" == *127.0.0.1* ]]; then
  WEB_BFF_API_URL="${VITE_BFF_BASE_URL_PROD:-https://www.188facai.com/api/v1}"
fi

MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-root_dev_only}"
MYSQL_BETOGO_USER="${MYSQL_BETOGO_USER:-betogo}"
MYSQL_BETOGO_PASSWORD="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}"
if [[ -z "$MYSQL_BETOGO_PASSWORD" ]]; then
  echo "缺少 MYSQL_BETOGO_PASSWORD（或 MYSQL_PASSWORD）" >&2
  exit 1
fi

run() {
  if [[ "$CTR" == podman ]]; then
    podman "$@"
  else
    docker "$@"
  fi
}

OPTIONAL_CONTAINERS=(tma-nacos tma-rabbitmq tma-core-java tma-core-node tma-nats)

echo "==> [${CTR}] 停用非必需组件（保留 tma-mysql 数据卷）"
for name in "${OPTIONAL_CONTAINERS[@]}"; do
  if run ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    run stop "$name" 2>/dev/null || true
    run rm -f "$name" 2>/dev/null || true
    echo "  stopped ${name}"
  fi
done

echo "==> [${CTR}] 创建网络 ${NET}"
run network inspect "$NET" >/dev/null 2>&1 || run network create "$NET"

echo "==> [${CTR}] MySQL betogo (limit 512m, :13306)"
run rm -f tma-mysql 2>/dev/null || true
run volume create tma-mysql-data 2>/dev/null || true
run run -d --name tma-mysql --network "$NET" --network-alias mysql --restart=always \
  --memory=512m --memory-swap=512m \
  -p 127.0.0.1:13306:3306 \
  -v tma-mysql-data:/var/lib/mysql:Z \
  -e MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD}" \
  -e MYSQL_DATABASE="${MYSQL_DATABASE:-betogo}" \
  -e TZ=UTC \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --default-authentication-plugin=mysql_native_password \
  --max_connections=50 \
  --innodb_buffer_pool_size=256M \
  --performance_schema=OFF \
  --table_open_cache=200

export CTR
chmod +x scripts/apply-betogo-schema.sh
bash scripts/apply-betogo-schema.sh

echo "==> [${CTR}] Redis (limit 96m)"
run rm -f tma-redis 2>/dev/null || true
run run -d --name tma-redis --network "$NET" --network-alias redis --restart=always \
  --memory=96m --memory-swap=96m \
  -p 127.0.0.1:6379:6379 \
  redis:7.0-alpine \
  redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru --save "" --appendonly no

REDIS_URL_WIRED="redis://redis:6379"

echo "==> [${CTR}] NATS JetStream (limit 64m)"
run volume create tma-nats-data 2>/dev/null || true
run run -d --name tma-nats --network "$NET" --network-alias nats --restart=always \
  --memory=64m --memory-swap=64m \
  -p 127.0.0.1:4222:4222 \
  -v tma-nats-data:/data:Z \
  nats:2.10-alpine \
  -js --store_dir=/data

echo "==> 等待 NATS 就绪…"
for i in $(seq 1 10); do
  run exec tma-nats nats-server --version >/dev/null 2>&1 && break || sleep 1
done

echo "==> [${CTR}] core-node (Fastify, limit 192m)"
run rm -f tma-core-node 2>/dev/null || true
run build -t betogo-core-node:latest -f apps/core-node/Dockerfile apps/core-node
LOG_OPTS=(--log-driver=json-file --log-opt max-size=50m --log-opt max-file=3)

run run -d --name tma-core-node --network "$NET" --restart=always \
  "${LOG_OPTS[@]}" \
  --memory=192m --memory-swap=192m \
  -p 127.0.0.1:4000:4000 \
  -v "${DIR}/apps/core-node/dist:/app/dist:ro" \
  -e NODE_ENV=production \
  -e LOG_LEVEL="${LOG_LEVEL:-info}" \
  -e CORE_PORT=4000 \
  -e REDIS_URL="${REDIS_URL_WIRED}" \
  -e NATS_URL="nats://nats:4222" \
  -e NATS_STREAM="${NATS_STREAM:-BETOGO}" \
  -e NATS_LEDGER_SUBJECT="${NATS_LEDGER_SUBJECT:-betogo.ledger}" \
  -e NATS_CALLBACK_SUBJECT="${NATS_CALLBACK_SUBJECT:-betogo.callback}" \
  -e MYSQL_HOST=tma-mysql \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE="${MYSQL_DATABASE:-betogo}" \
  -e MYSQL_USER="${MYSQL_BETOGO_USER}" \
  -e MYSQL_PASSWORD="${MYSQL_BETOGO_PASSWORD}" \
  -e SG_MERCHANT_ID="${SG_MERCHANT_ID:-}" \
  -e SG_MERCHANT_KEY="${SG_MERCHANT_KEY:-}" \
  -e SG_CURRENCY="${SG_CURRENCY:-EUR}" \
  -e INTERNAL_TOKEN="${INTERNAL_TOKEN:-}" \
  -e MATRIX_GATEWAY_URL="${MATRIX_GATEWAY_URL:-}" \
  -e MATRIX_API_KEY="${MATRIX_API_KEY:-}" \
  -e MATRIX_MERCHANT_NO="${MATRIX_MERCHANT_NO:-}" \
  -e "MATRIX_PLATFORM_API_PUBLIC_KEY=${MATRIX_PLATFORM_API_PUBLIC_KEY:-}" \
  -e "MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY=${MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY:-}" \
  -e "MATRIX_MERCHANT_API_PRIVATE_KEY=${MATRIX_MERCHANT_API_PRIVATE_KEY:-}" \
  -e "MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY=${MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY:-}" \
  -e MATRIX_NOTIFY_URL="${MATRIX_NOTIFY_URL:-}" \
  -e MATRIX_WITHDRAW_CHECK_URL="${MATRIX_WITHDRAW_CHECK_URL:-}" \
  betogo-core-node:latest

echo "==> [${CTR}] bff-node (MySQL store + Redis session)"
run rm -f tma-bff-node 2>/dev/null || true
run build -t betogo-bff-node:latest -f apps/bff-node/Dockerfile apps/bff-node
run run -d --name tma-bff-node --network "$NET" --restart=always \
  "${LOG_OPTS[@]}" \
  --memory=256m --memory-swap=256m \
  -p 127.0.0.1:3000:3000 \
  -v "${DIR}/apps/bff-node/dist:/app/dist:ro" \
  -e NODE_ENV=production \
  -e LOG_LEVEL="${LOG_LEVEL:-info}" \
  -e BFF_PORT=3000 \
  -e BFF_STORAGE=mysql \
  -e REDIS_URL="${REDIS_URL_WIRED}" \
  -e MYSQL_HOST=tma-mysql \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE="${MYSQL_DATABASE:-betogo}" \
  -e MYSQL_USER="${MYSQL_BETOGO_USER}" \
  -e MYSQL_PASSWORD="${MYSQL_BETOGO_PASSWORD}" \
  -e TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?缺少 TELEGRAM_BOT_TOKEN}" \
  -e BFF_DEV_SKIP_TELEGRAM_AUTH="${BFF_DEV_SKIP_TELEGRAM_AUTH:-false}" \
  -e SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-86400}" \
  -e GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  -e GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  -e GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  -e AMMER_PAY_PROVIDER_TOKEN="${AMMER_PAY_PROVIDER_TOKEN:-}" \
  -e USDT_TO_PHP_RATE="${USDT_TO_PHP_RATE:-58}" \
  -e YFPAY_USERNAME="${YFPAY_USERNAME:-}" \
  -e YFPAY_API_KEY="${YFPAY_API_KEY:-}" \
  -e YFPAY_NOTIFY_URL="${YFPAY_NOTIFY_URL:-https://www.188facai.com/api/v1/callback/yfpay}" \
  -e MERCHANT_TON_ADDRESS="${MERCHANT_TON_ADDRESS:-UQBjAz1W6jUkH7WJbxwu7rSHbJaOg65TVFHv8w6b1Nx697rJ}" \
  -e TON_TO_PHP_RATE="${TON_TO_PHP_RATE:-350}" \
  -e TONCENTER_API_KEY="${TONCENTER_API_KEY:-}" \
  -e CORE_NODE_URL=http://tma-core-node:4000 \
  -e SG_BASE_URL="${SG_BASE_URL:-}" \
  -e SG_MERCHANT_ID="${SG_MERCHANT_ID:-}" \
  -e SG_MERCHANT_KEY="${SG_MERCHANT_KEY:-}" \
  -e SG_CURRENCY="${SG_CURRENCY:-EUR}" \
  -e SG_RETURN_URL="${SG_RETURN_URL:-https://www.188facai.com}" \
  -e GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  -e CS_ENABLED="${CS_ENABLED:-true}" \
  -e EXCHANGE_RATE_API_KEY="${EXCHANGE_RATE_API_KEY:-}" \
  -e COINGECKO_API_KEY="${COINGECKO_API_KEY:-}" \
  -e INTERNAL_TOKEN="${INTERNAL_TOKEN:-}" \
  -e MATRIX_GATEWAY_URL="${MATRIX_GATEWAY_URL:-}" \
  -e MATRIX_API_KEY="${MATRIX_API_KEY:-}" \
  -e MATRIX_MERCHANT_NO="${MATRIX_MERCHANT_NO:-}" \
  -e "MATRIX_PLATFORM_API_PUBLIC_KEY=${MATRIX_PLATFORM_API_PUBLIC_KEY:-}" \
  -e "MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY=${MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY:-}" \
  -e "MATRIX_MERCHANT_API_PRIVATE_KEY=${MATRIX_MERCHANT_API_PRIVATE_KEY:-}" \
  -e "MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY=${MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY:-}" \
  -e MATRIX_NOTIFY_URL="${MATRIX_NOTIFY_URL:-}" \
  -e MATRIX_WITHDRAW_CHECK_URL="${MATRIX_WITHDRAW_CHECK_URL:-}" \
  betogo-bff-node:latest

echo "==> [${CTR}] web-tma (limit 64m)"
run rm -f tma-web-tma 2>/dev/null || true
run build -t tma-web-tma:latest \
  --ulimit nofile=65535:65535 \
  --build-arg "VITE_BFF_BASE_URL=${WEB_BFF_API_URL}" \
  --build-arg VITE_USE_MOCK_API=false \
  --build-arg "VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}" \
  --build-arg "VITE_GOOGLE_REDIRECT_URI=${VITE_GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  --build-arg "VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME:-BetoGoBot}" \
  --build-arg "VITE_TELEGRAM_WEB_APP_URL=${VITE_TELEGRAM_WEB_APP_URL:-https://www.188facai.com}" \
  -f apps/web-tma/Dockerfile apps/web-tma
run run -d --name tma-web-tma --network "$NET" --restart=always \
  --memory=64m --memory-swap=64m \
  -v "${DIR}/apps/web-tma/dist:/usr/share/nginx/html:ro" \
  -p "${PORT}:80" \
  tma-web-tma:latest

echo "==> [${CTR}] web-admin (limit 64m)"
ADMIN_PORT="${WEB_ADMIN_PORT:-8085}"
run rm -f tma-web-admin 2>/dev/null || true
run build -t betogo-web-admin:latest -f apps/web-admin/Dockerfile apps/web-admin
run run -d --name tma-web-admin --network "$NET" --restart=always \
  --memory=64m --memory-swap=64m \
  -v "${DIR}/apps/web-admin/dist:/usr/share/nginx/html:ro" \
  -p "${ADMIN_PORT}:80" \
  betogo-web-admin:latest

echo "==> 等待服务就绪…"
sleep 10
curl -sf http://127.0.0.1:3000/health >/dev/null && echo "  bff-node: ok" || echo "  bff-node: 未就绪"
curl -sf http://127.0.0.1:4000/health >/dev/null && echo "  core-node: ok" || echo "  core-node: 未就绪"
run exec tma-redis redis-cli ping 2>/dev/null | grep -q PONG && echo "  redis: ok" || echo "  redis: 未就绪"
run exec tma-mysql mysqladmin ping -h localhost -uroot -p"${MYSQL_ROOT_PASSWORD}" 2>/dev/null | grep -q alive && echo "  mysql: ok" || echo "  mysql: 未就绪"
run exec tma-mysql mysql -u"${MYSQL_BETOGO_USER}" -p"${MYSQL_BETOGO_PASSWORD}" "${MYSQL_DATABASE:-betogo}" -e "SHOW TABLES LIKE 'bg_user';" 2>/dev/null | grep -q bg_user && echo "  betogo schema: ok" || echo "  betogo schema: check failed"

echo ""
echo "已启动：web + BFF + core-node + NATS + Redis + MySQL(:13306)"
echo "日志栈（可选）: cd deploy/single-node && bash start-observability.sh  → Grafana http://127.0.0.1:3001"
run ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
