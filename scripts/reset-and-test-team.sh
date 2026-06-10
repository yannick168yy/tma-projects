#!/usr/bin/env bash
# 重置测试数据并执行三级分销测试
# 用法：bash scripts/reset-and-test-team.sh
set -euo pipefail

HOST=root@47.84.34.139
KEY=~/Downloads/yannick.pem
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ServerAliveInterval=10 -o ServerAliveCountMax=12"
WORK_DIR=/root/workspace/tma-projects

echo "==> [1/3] 同步脚本到服务器..."
scp -i "$KEY" -o StrictHostKeyChecking=no \
  "$(dirname "$0")/test-team-distribution.mjs" \
  "$HOST:/tmp/test-team-distribution.mjs"
$SSH "$HOST" "podman cp /tmp/test-team-distribution.mjs tma-core-node:/app/test-team-distribution.mjs"

echo "==> [2/3] 重置测试数据..."
$SSH "$HOST" "bash -s" <<'REMOTE'
DB_USER=$(grep -m1 '^MYSQL_USER=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_PASS=$(grep -m1 '^MYSQL_PASSWORD=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_NAME=$(grep '^MYSQL_DATABASE=' /root/workspace/tma-projects/.env | tail -1 | cut -d= -f2- | tr -d "\"'"); DB_NAME=${DB_NAME:-betogo}
podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < /root/workspace/tma-projects/scripts/reset-test-data.sql 2>&1 | grep -v Warning
REMOTE

echo "==> [3/3] 执行三级分销测试..."
MYSQL_IP=$($SSH "$HOST" "podman inspect tma-mysql | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d[0]['NetworkSettings']['Networks']['tma-prod']['IPAddress'])\"")
CORE_IP=$($SSH "$HOST" "podman inspect tma-core-node | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d[0]['NetworkSettings']['Networks']['tma-prod']['IPAddress'])\"")

$SSH "$HOST" "
podman exec \
  -e MYSQL_HOST=$MYSQL_IP \
  -e CORE_NODE_URL=http://$CORE_IP:4000 \
  -e INTERNAL_TOKEN=betogo_internal_2026 \
  tma-core-node node /app/test-team-distribution.mjs
"
