#!/usr/bin/env sh
# 在 Nacos 就绪后创建 namespace「batogo」（幂等）
# 本地: docker compose exec nacos sh /home/nacos/init-namespace.sh
set -e
NACOS_ADDR="${NACOS_ADDR:-http://127.0.0.1:8848}"
NAMESPACE_ID="${NACOS_NAMESPACE_ID:-batogo}"
NAMESPACE_NAME="${NACOS_NAMESPACE_NAME:-BetoGo}"

curl -sf -X POST "${NACOS_ADDR}/nacos/v1/console/namespaces" \
  -d "customNamespaceId=${NAMESPACE_ID}&namespaceName=${NAMESPACE_NAME}&namespaceDesc=BetoGo%20apps" \
  || true

echo "Namespace ${NAMESPACE_ID} ensured."
