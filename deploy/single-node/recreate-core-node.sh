#!/usr/bin/env bash
# 重建 core-node 容器并替换（.env 变更后使用，podman restart 不会重读 env）
set -euo pipefail

cd "$(dirname "$0")/../.."
DIR="$(pwd)"
CTR="${CTR:-podman}"
NET="${TMA_PODMAN_NETWORK:-tma-prod}"
LOG_OPTS=(--log-driver=json-file --log-opt max-size=50m --log-opt max-file=3)

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ [[:space:]] ]] && continue
    export "${key}=${val}"
  done < .env
fi

MYSQL_BETOGO_USER="${MYSQL_BETOGO_USER:-betogo}"
MYSQL_BETOGO_PASSWORD="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}"
REDIS_URL_WIRED="${REDIS_URL:-redis://redis:6379}"

run() { if [[ "$CTR" == podman ]]; then podman "$@"; else docker "$@"; fi; }

# P1-0d：固定 IP + hosts 注入，绕开 musl 并行 DNS 导致的 ENOTFOUND
source "$DIR/deploy/single-node/peer-hosts.sh"
# 必须在 rm 之前钉住：默认值是测试机的地址，拿到生产用会把容器钉错位置
peer_pin_live_ips
mapfile -t ADD_HOSTS < <(peer_host_args tma-core-node)

run build -t betogo-core-node:latest -f apps/core-node/Dockerfile apps/core-node
run rm -f tma-core-node 2>/dev/null || true
run run -d --name tma-core-node --network "$NET" --ip "$PEER_IP_CORE_NODE" --restart=always \
  "${LOG_OPTS[@]}" \
  "${ADD_HOSTS[@]}" \
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
  -e MYSQL_PLATFORM_DATABASE="${MYSQL_PLATFORM_DATABASE:-betogo_platform}" \
  -e MYSQL_PLATFORM_POOL_SIZE="${MYSQL_PLATFORM_POOL_SIZE:-4}" \
  -e CORE_POOL_SIZE="${CORE_POOL_SIZE:-10}" \
  -e CORE_POOL_MIN="${CORE_POOL_MIN:-2}" \
  -e CORE_QUEUE_LIMIT="${CORE_QUEUE_LIMIT:-0}" \
  -e TENANT_RESOLVE_STRICT="${TENANT_RESOLVE_STRICT:-false}" \
  -e WIN568_BASE_URL="${WIN568_BASE_URL:-https://test-api.568win.com}" \
  -e WIN568_COMPANY_KEY="${WIN568_COMPANY_KEY:-}" \
  -e WIN568_SERVER_ID="${WIN568_SERVER_ID:-}" \
  -e WIN568_SW_COMPANY_KEY="${WIN568_SW_COMPANY_KEY:-}" \
  -e WIN568_SW_ALLOWED_IPS="${WIN568_SW_ALLOWED_IPS:-}" \
  -e WIN568_DEFAULT_CURRENCY="${WIN568_DEFAULT_CURRENCY:-PHP}" \
  -e SG_MERCHANT_ID="${SG_MERCHANT_ID:-}" \
  -e SG_MERCHANT_KEY="${SG_MERCHANT_KEY:-}" \
  -e SG_CURRENCY="${SG_CURRENCY:-EUR}" \
  -e YFPAY_API_KEY="${YFPAY_API_KEY:-}" \
  -e UNISPAY_API_KEY="${UNISPAY_API_KEY:-}" \
  -e USDT_TO_IDR_RATE="${USDT_TO_IDR_RATE:-16646}" \
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

echo "tma-core-node recreated"
curl -sf http://127.0.0.1:4000/health && echo " health ok"
