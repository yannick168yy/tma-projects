#!/usr/bin/env bash
# 清理测试环境全部用户数据，保留设置数据和游戏商数据
# 用法：bash scripts/clear-all-user-data.sh
#
# 注意：本脚本不修改后台设置、运营配置、支付渠道、游戏商、游戏目录和 568Win Agent 配置。
#       会清空所有用户、钱包、注单、充提、KYC、客服会话、奖励/任务/VIP/风控用户台账。
set -euo pipefail

HOST=root@47.84.34.139
KEY=/Users/yannicky/TMA_FILES/aliyun.pem
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ServerAliveInterval=10 -o ServerAliveCountMax=12"
WORK_DIR=/root/workspace/tma-projects

echo "==> [1/3] 同步清理 SQL 到服务器..."
scp -i "$KEY" -o StrictHostKeyChecking=no \
  "$(dirname "$0")/clear-all-user-data.sql" \
  "$HOST:$WORK_DIR/scripts/clear-all-user-data.sql"

echo "==> [2/3] 清理 MySQL 用户数据（保留设置数据和游戏商数据）..."
$SSH "$HOST" "bash -s" <<'REMOTE'
DB_USER=$(grep -m1 '^MYSQL_BETOGO_USER=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_USER=${DB_USER:-$(grep -m1 '^MYSQL_USER=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")}
DB_PASS=$(grep -m1 '^MYSQL_BETOGO_PASSWORD=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")
DB_PASS=${DB_PASS:-$(grep -m1 '^MYSQL_PASSWORD=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'")}
DB_NAME=$(grep -m1 '^MYSQL_DATABASE=' /root/workspace/tma-projects/.env | cut -d= -f2- | tr -d "\"'"); DB_NAME=${DB_NAME:-betogo}
if [ "$DB_NAME" != "betogo" ]; then
  echo "MYSQL_DATABASE must be betogo, got: $DB_NAME" >&2
  exit 1
fi
podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < /root/workspace/tma-projects/scripts/clear-all-user-data.sql 2>&1 | grep -v Warning
REMOTE

echo "==> [3/3] 清理 Redis 用户缓存与 KYC 文件..."
$SSH "$HOST" "bash -s" <<'REMOTE'
for pattern in \
  'tma:user:*' 'tma:identity:*' 'tma:identities:user:*' 'tma:invite:*' 'tma:session:*' \
  'tma:wallet:*' 'tma:deposit:*' 'tma:deposits:user:*' 'tma:withdraw:*' 'tma:withdrawals:user:*' 'tma:ledger:user:*' \
  'tma:kyc:*' 'kyc:otp:*' 'kyc:otp:sent:*' 'kyc:otp:lock:*' 'kyc:rl:*' 'kyc:idlock:*' 'kyc:fail:*' \
  'auth:forgot:*' 'auth:login:*' 'withdraw:lock:*' 'sms:daily:*'; do
  podman exec tma-redis sh -c "
    n=0
    for k in \$(redis-cli --scan --pattern '$pattern'); do
      redis-cli del \"\$k\" >/dev/null
      n=\$((n+1))
    done
    echo \"已清理 Redis 键 $pattern: \$n\"
  "
done

KYC_IMG_DIR=/root/workspace/tma-projects/data/kyc
if [ -d "$KYC_IMG_DIR" ]; then
  # 保留 covers/(游戏封面),只清 KYC 用户上传件
  find "$KYC_IMG_DIR" -mindepth 1 -maxdepth 1 ! -name covers -exec rm -rf {} +
  echo "已清理 KYC 影像文件（保留 covers/）"
fi
REMOTE
