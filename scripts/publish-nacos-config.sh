#!/usr/bin/env bash
# 将 .env 中的配置发布到 Nacos（bff-node / core-java）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ -f .env ]] || { echo "missing .env"; exit 1; }
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  [[ "$key" =~ [[:space:]] ]] && continue
  export "${key}=${val}"
done < .env

NACOS_ADDR="${NACOS_PUBLISH_ADDR:-http://127.0.0.1:${NACOS_PORT:-8848}}"
NS="${NACOS_NAMESPACE:-batogo}"

for i in $(seq 1 30); do
  curl -sf "${NACOS_ADDR}/nacos/v1/console/health/readiness" >/dev/null 2>&1 && break
  sleep 2
done

curl -sf -X POST "${NACOS_ADDR}/nacos/v1/console/namespaces" \
  -d "customNamespaceId=${NS}&namespaceName=BetoGo" >/dev/null || true

publish() {
  local dataId="$1"
  local content="$2"
  curl -sf -X POST "${NACOS_ADDR}/nacos/v1/cs/configs" \
    --data-urlencode "dataId=${dataId}" \
    --data-urlencode "group=DEFAULT_GROUP" \
    --data-urlencode "tenant=${NS}" \
    --data-urlencode "type=properties" \
    --data-urlencode "content=${content}"
  echo "published ${dataId} @ ${NS}"
}

BFF_CONTENT="$(cat <<EOF
NODE_ENV=${NODE_ENV:-development}
BFF_PORT=${BFF_PORT:-3000}
USDT_TO_PHP_RATE=${USDT_TO_PHP_RATE:-58}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
AMMER_PAY_PROVIDER_TOKEN=${AMMER_PAY_PROVIDER_TOKEN:-}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}
# REDIS_URL / MYSQL_HOST：由 compose 或 podman -e 注入，勿写入 Nacos（容器内 127.0.0.1 会连错）
MYSQL_DATABASE=${MYSQL_DATABASE:-betogo}
MYSQL_USER=${MYSQL_BETOGO_USER:-betogo}
MYSQL_PASSWORD=${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}
MYSQL_USE_SSL=false
EOF
)"

CORE_CONTENT="$(cat <<EOF
spring.datasource.url=jdbc:mysql://${MYSQL_HOST:-127.0.0.1}:${MYSQL_PORT:-3306}/${MYSQL_DATABASE:-betogo}?useUnicode=true&characterEncoding=utf8mb4&serverTimezone=UTC
spring.datasource.username=${MYSQL_BETOGO_USER:-betogo}
spring.datasource.password=${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}
spring.flyway.enabled=true
spring.flyway.baseline-on-migrate=true
spring.flyway.baseline-version=1
EOF
)"

publish bff-node "$BFF_CONTENT"
publish core-java "$CORE_CONTENT"
