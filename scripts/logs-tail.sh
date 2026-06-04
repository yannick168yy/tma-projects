#!/usr/bin/env bash
# 快速 tail 应用容器日志（无 Grafana 时）
set -euo pipefail
CTR="${CTR:-podman}"
target="${1:-bff}"
case "$target" in
  bff)  name=tma-bff-node ;;
  core) name=tma-core-node ;;
  *)    name="$target" ;;
esac
exec "$CTR" logs -f --tail 100 "$name"
