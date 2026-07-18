#!/usr/bin/env bash
# 已合并到 deploy-fast.sh；保留本脚本兼容旧命令。
# 用法：bash deploy/single-node/deploy-web-tma-fast.sh
# 或：  bash deploy/single-node/deploy-fast.sh web-tma

set -euo pipefail
exec "$(dirname "$0")/deploy-fast.sh" web-tma
