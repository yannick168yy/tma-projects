#!/usr/bin/env bash
# 重置测试数据并执行三级分销测试
# 用法：bash scripts/reset-and-test.sh
#       SKIP_DB_RESET=1 bash scripts/reset-and-test.sh   # 跳过重置，仅跑测试（保留用户/注单/费率）
#
# 注意：本脚本不修改 bg_team_rate_plan / bg_team_config（佣金套餐与费率）。
#       勿在 bff-node 部署迁移中用 team_config 覆盖已配置的套餐（见 044 迁移）。
#       重置会清空投注记录、操作日志、KYC 数据、Redis KYC 缓存与 data/kyc 影像文件（含 BG-10001）。
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
# 同步最新的重置 SQL（确保 KYC 等新增清理项生效）
scp -i "$KEY" -o StrictHostKeyChecking=no \
  "$(dirname "$0")/reset-test-data.sql" \
  "$HOST:$WORK_DIR/scripts/reset-test-data.sql"

if [[ "${SKIP_DB_RESET:-}" == "1" ]]; then
  echo "==> [2/3] 跳过重置（SKIP_DB_RESET=1）"
else
  echo "==> [2/3] 重置测试数据（不触碰佣金费率/套餐）..."
  $SSH "$HOST" "bash -s" <<'REMOTE'
DB_USER=$(grep -m1 '^MYSQL_USER=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_PASS=$(grep -m1 '^MYSQL_PASSWORD=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_NAME=$(grep '^MYSQL_DATABASE=' /root/workspace/tma-projects/.env | tail -1 | cut -d= -f2- | tr -d "\"'"); DB_NAME=${DB_NAME:-betogo}
podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < /root/workspace/tma-projects/scripts/reset-test-data.sql 2>&1 | grep -v Warning

# 清理 KYC / OTP Redis 缓存
for pattern in 'tma:kyc:*' 'kyc:otp:*' 'kyc:otp:sent:*' 'kyc:otp:lock:*' 'kyc:rl:*' 'kyc:idlock:*' 'auth:forgot:*' 'sms:daily:*'; do
  podman exec tma-redis sh -c "
    n=0
    for k in \$(redis-cli --scan --pattern '$pattern'); do
      redis-cli del \"\$k\" >/dev/null
      n=\$((n+1))
    done
    echo \"已清理 Redis KYC 键 $pattern: \$n\"
  "
done

# 清理 KYC 影像文件（证件照 + 活体帧，含 BG-10001）
KYC_IMG_DIR=/root/workspace/tma-projects/data/kyc
if [ -d "$KYC_IMG_DIR" ]; then
  find "$KYC_IMG_DIR" -mindepth 1 -delete
  echo "已清理 KYC 影像文件（含 BG-10001）"
fi
REMOTE
fi

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
