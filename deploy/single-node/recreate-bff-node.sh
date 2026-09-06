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

# P1-0d：固定 IP + hosts 注入，绕开 musl 并行 DNS 导致的 ENOTFOUND
source "$DIR/deploy/single-node/peer-hosts.sh"
# 必须在 rm 之前钉住：默认值是测试机的地址，拿到生产用会把容器钉错位置
peer_pin_live_ips
mapfile -t ADD_HOSTS < <(peer_host_args tma-bff-node)

run build -t betogo-bff-node:latest -f apps/bff-node/Dockerfile apps/bff-node
run rm -f tma-bff-node 2>/dev/null || true
run run -d --name tma-bff-node --network "$NET" --ip "$PEER_IP_BFF_NODE" --restart=always \
  "${LOG_OPTS[@]}" \
  "${ADD_HOSTS[@]}" \
  --memory=256m --memory-swap=256m \
  -p 127.0.0.1:3000:3000 \
  -v "${DIR}/apps/bff-node/dist:/app/dist:ro" \
  -v "$DIR/infra":/app/infra:ro \
  -v "${DIR}/data/kyc:/app/data/kyc" \
  -v "${DIR}/backups:/app/data/backups" \
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
  -e BI_REPORT_CHAT_ID="${BI_REPORT_CHAT_ID:-}" \
  -e ADMIN_WEB_URL="${ADMIN_WEB_URL:-https://www.188facai.com/admin-panel}" \
  -e BFF_DEV_SKIP_TELEGRAM_AUTH="${BFF_DEV_SKIP_TELEGRAM_AUTH:-false}" \
  -e BFF_DISABLE_RATE_LIMIT="${BFF_DISABLE_RATE_LIMIT:-false}" \
  -e BFF_ADMIN_TOTP_REQUIRED="${BFF_ADMIN_TOTP_REQUIRED:-false}" \
  -e BFF_DISABLE_SINGLETON_JOBS="${BFF_DISABLE_SINGLETON_JOBS:-false}" \
  -e MYSQL_POOL_SIZE="${MYSQL_POOL_SIZE:-10}" \
  -e MYSQL_POOL_MIN="${MYSQL_POOL_MIN:-2}" \
  -e MYSQL_QUEUE_LIMIT="${MYSQL_QUEUE_LIMIT:-0}" \
  -e MYSQL_TOTAL_CONN_BUDGET="${MYSQL_TOTAL_CONN_BUDGET:-30}" \
  -e MYSQL_PLATFORM_DATABASE="${MYSQL_PLATFORM_DATABASE:-betogo_platform}" \
  -e MYSQL_PLATFORM_POOL_SIZE="${MYSQL_PLATFORM_POOL_SIZE:-4}" \
  -e TENANT_RESOLVE_STRICT="${TENANT_RESOLVE_STRICT:-false}" \
  -e PLATFORM_ADMIN_USERNAME="${PLATFORM_ADMIN_USERNAME:-}" \
  -e PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-}" \
  -e MYSQL_PROVISION_USER="${MYSQL_PROVISION_USER:-}" \
  -e MYSQL_PROVISION_PASSWORD="${MYSQL_PROVISION_PASSWORD:-}" \
  -e SCHEMA_BASELINE_PATH="${SCHEMA_BASELINE_PATH:-/app/infra/database/betogo/schema_baseline.sql}" \
  -e PLATFORM_ROOT_DOMAIN="${PLATFORM_ROOT_DOMAIN:-betogo.games}" \
  -e PLATFORM_CREDENTIAL_KEY="${PLATFORM_CREDENTIAL_KEY:-}" \
  -e RISK_FEDERATION_PEPPER="${RISK_FEDERATION_PEPPER:-}" \
  -e BILLING_DUNNING_WARN_DAYS="${BILLING_DUNNING_WARN_DAYS:-1}" \
  -e BILLING_DUNNING_WITHDRAW_DAYS="${BILLING_DUNNING_WITHDRAW_DAYS:-3}" \
  -e BILLING_DUNNING_DEPOSIT_DAYS="${BILLING_DUNNING_DEPOSIT_DAYS:-7}" \
  -e BILLING_DUNNING_SITE_DAYS="${BILLING_DUNNING_SITE_DAYS:-14}" \
  -e SERVER_PUBLIC_IP="${SERVER_PUBLIC_IP:-}" \
  -e ADMIN_NOTIFY_ENV_LABEL="${ADMIN_NOTIFY_ENV_LABEL:-}" \
  -e SESSION_TTL_SECONDS="${SESSION_TTL_SECONDS:-86400}" \
  -e MARKET_DOMAIN_MAP="${MARKET_DOMAIN_MAP:-}" \
  -e APP_ROUTE_SIGNING_KEY="${APP_ROUTE_SIGNING_KEY:-}" \
  -e GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  -e GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  -e GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}" \
  -e TELEGRAM_OIDC_CLIENT_SECRET="${TELEGRAM_OIDC_CLIENT_SECRET:-}" \
  -e TELEGRAM_OIDC_CLIENTS="${TELEGRAM_OIDC_CLIENTS:-}" \
  -e TELEGRAM_OIDC_BOT_TOKENS="${TELEGRAM_OIDC_BOT_TOKENS:-}" \
  -e TELEGRAM_OIDC_REDIRECT_URI="${TELEGRAM_OIDC_REDIRECT_URI:-https://www.188facai.com/auth/telegram/callback}" \
  -e AMMER_PAY_PROVIDER_TOKEN="${AMMER_PAY_PROVIDER_TOKEN:-}" \
  -e TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-}" \
  -e USDT_TO_PHP_RATE="${USDT_TO_PHP_RATE:-58}" \
  -e USDT_TO_IDR_RATE="${USDT_TO_IDR_RATE:-16646}" \
  -e YFPAY_USERNAME="${YFPAY_USERNAME:-}" \
  -e YFPAY_API_KEY="${YFPAY_API_KEY:-}" \
  -e YFPAY_NOTIFY_URL="${YFPAY_NOTIFY_URL:-https://www.188facai.com/api/v1/callback/yfpay}" \
  -e UNISPAY_BASE_URL="${UNISPAY_BASE_URL:-https://asia666.unispay.vip}" \
  -e UNISPAY_MCH_NO="${UNISPAY_MCH_NO:-}" \
  -e UNISPAY_API_KEY="${UNISPAY_API_KEY:-}" \
  -e UNISPAY_NOTIFY_URL="${UNISPAY_NOTIFY_URL:-https://www.188facai.com/api/v1/callback/unispay}" \
  -e UNISPAY_RETURN_URL="${UNISPAY_RETURN_URL:-https://www.188facai.com}" \
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
  -e DB_BACKUP_DIR="${DB_BACKUP_DIR:-/app/data/backups}" \
  -e IMAGE_CDN_BASE="${IMAGE_CDN_BASE:-}" \
  -e S3_BUCKET="${S3_BUCKET:-}" \
  -e S3_REGION="${S3_REGION:-}" \
  -e S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}" \
  -e S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}" \
  -e S3_ENDPOINT="${S3_ENDPOINT:-}" \
  -e S3_PUBLIC_BASE_URL="${S3_PUBLIC_BASE_URL:-}" \
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
