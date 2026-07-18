#!/usr/bin/env bash
# 重建 bff-node 镜像并替换容器（package.json 变更后使用）
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

run build -t betogo-bff-node:latest -f apps/bff-node/Dockerfile apps/bff-node
run rm -f tma-bff-node 2>/dev/null || true
run run -d --name tma-bff-node --network "$NET" --restart=always \
  "${LOG_OPTS[@]}" \
  --memory=256m --memory-swap=256m \
  -p 127.0.0.1:3000:3000 \
  -v "${DIR}/apps/bff-node/dist:/app/dist:ro" \
  -v "${DIR}/data/kyc:/app/data/kyc" \
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
  -e ADMIN_TG_BOT_TOKEN="${ADMIN_TG_BOT_TOKEN:-}" \
  -e ADMIN_TG_CHAT_ID="${ADMIN_TG_CHAT_ID:-}" \
  -e ADMIN_WEB_URL="${ADMIN_WEB_URL:-https://www.188facai.com/admin-panel}" \
  -e BFF_DEV_SKIP_TELEGRAM_AUTH="${BFF_DEV_SKIP_TELEGRAM_AUTH:-false}" \
  -e BFF_DISABLE_RATE_LIMIT="${BFF_DISABLE_RATE_LIMIT:-false}" \
  -e BFF_DISABLE_SINGLETON_JOBS="${BFF_DISABLE_SINGLETON_JOBS:-false}" \
  -e MYSQL_POOL_SIZE="${MYSQL_POOL_SIZE:-10}" \
  -e ADMIN_NOTIFY_ENV_LABEL="${ADMIN_NOTIFY_ENV_LABEL:-}" \
  -e SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-86400}" \
  -e GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  -e GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  -e GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  -e TELEGRAM_OIDC_CLIENT_SECRET="${TELEGRAM_OIDC_CLIENT_SECRET:-}" \
  -e TELEGRAM_OIDC_REDIRECT_URI="${TELEGRAM_OIDC_REDIRECT_URI:-https://www.188facai.com/auth/telegram/callback}" \
  -e AMMER_PAY_PROVIDER_TOKEN="${AMMER_PAY_PROVIDER_TOKEN:-}" \
  -e TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}" \
  -e USDT_TO_PHP_RATE="${USDT_TO_PHP_RATE:-58}" \
  -e YFPAY_USERNAME="${YFPAY_USERNAME:-}" \
  -e YFPAY_API_KEY="${YFPAY_API_KEY:-}" \
  -e YFPAY_NOTIFY_URL="${YFPAY_NOTIFY_URL:-https://www.188facai.com/api/v1/callback/yfpay}" \
  -e BEEPAY_BASE_URL="${BEEPAY_BASE_URL:-}" \
  -e BEEPAY_MID_NO="${BEEPAY_MID_NO:-}" \
  -e BEEPAY_API_KEY="${BEEPAY_API_KEY:-}" \
  -e BEEPAY_NOTIFY_URL="${BEEPAY_NOTIFY_URL:-https://www.188facai.com/api/v1/callback/beepay}" \
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
  -e TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-}" \
  -e TELESMS_BASE_URL="${TELESMS_BASE_URL:-https://api2.santo.cc}" \
  -e TELESMS_CPID="${TELESMS_CPID:-}" \
  -e TELESMS_CPPWD="${TELESMS_CPPWD:-}" \
  -e TELESMS_SENDER="${TELESMS_SENDER:-}" \
  -e KYC_GEMINI_MIN_CONFIDENCE="${KYC_GEMINI_MIN_CONFIDENCE:-0.85}" \
  -e KYC_STORAGE_DIR="${KYC_STORAGE_DIR:-/app/data/kyc}" \
  -e IMAGE_CDN_BASE="${IMAGE_CDN_BASE:-}" \
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

echo "tma-bff-node recreated"
curl -sf http://127.0.0.1:3000/health && echo " health ok"
