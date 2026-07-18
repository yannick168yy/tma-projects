#!/usr/bin/env bash
# 默认走 2C2G 最小栈；全量组件见 podman-prod-full.sh
exec "$(dirname "$0")/podman-prod-minimal.sh" "$@"
