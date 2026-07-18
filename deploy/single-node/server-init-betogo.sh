#!/usr/bin/env bash
# 在阿里云服务器上执行：宝塔 MySQL 建库 + 表结构（最小栈不依赖 Nacos）
# 用法: cd /opt/tma-projects && bash deploy/single-node/server-init-betogo.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ [[:space:]] ]] && continue
    export "${key}=${val}"
  done < .env
fi

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
BETOGO_DB="${MYSQL_DATABASE:-betogo}"

mysql_root() {
  if [[ -n "$MYSQL_ROOT_PASSWORD" ]]; then
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -uroot -p"$MYSQL_ROOT_PASSWORD" "$@"
  else
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -uroot "$@"
  fi
}

echo "==> 创建数据库 ${BETOGO_DB}"
mysql_root < deploy/mysql/create-betogo-database.sql

echo "==> 应用表结构"
if [[ -n "${MYSQL_BETOGO_PASSWORD:-}" ]]; then
  mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"${MYSQL_BETOGO_USER:-betogo}" -p"$MYSQL_BETOGO_PASSWORD" "$BETOGO_DB" \
    < infra/database/betogo/001_schema.sql
else
  mysql_root "$BETOGO_DB" < infra/database/betogo/001_schema.sql
fi

if [[ "${SKIP_NACOS:-1}" != "1" ]]; then
  echo "==> Nacos namespace + bff-node 配置"
  NACOS_ADDR="${NACOS_SERVER_ADDR:-http://127.0.0.1:8848}"
  NS="${NACOS_NAMESPACE:-batogo}"
  if [[ "$NACOS_ADDR" != http* ]]; then
    NACOS_ADDR="http://${NACOS_ADDR}"
  fi
  for i in $(seq 1 15); do
    curl -sf "${NACOS_ADDR}/nacos/v1/console/health/readiness" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf -X POST "${NACOS_ADDR}/nacos/v1/console/namespaces" \
    -d "customNamespaceId=${NS}&namespaceName=BetoGo&namespaceDesc=prod" >/dev/null || true
  BFF_NACOS_CONTENT="$(cat <<EOF
NODE_ENV=production
USDT_TO_PHP_RATE=${USDT_TO_PHP_RATE:-58}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
AMMER_PAY_PROVIDER_TOKEN=${AMMER_PAY_PROVIDER_TOKEN:-}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:-https://www.188facai.com/auth/google/callback}
MYSQL_DATABASE=${BETOGO_DB}
EOF
)"
  curl -sf -X POST "${NACOS_ADDR}/nacos/v1/cs/configs" \
    --data-urlencode "dataId=bff-node" \
    --data-urlencode "group=DEFAULT_GROUP" \
    --data-urlencode "tenant=${NS}" \
    --data-urlencode "type=properties" \
    --data-urlencode "content=${BFF_NACOS_CONTENT}" || echo "  Nacos publish skipped"
else
  echo "==> 跳过 Nacos（SKIP_NACOS=1，BFF 使用服务器 .env）"
fi

echo "==> 完成: DB ${BETOGO_DB}"
