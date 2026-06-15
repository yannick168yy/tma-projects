#!/usr/bin/env bash
# 清空所有实名认证：MySQL 记录 + Redis OTP/索引 + 证件/活体影像
# 用法（测试/运维手动）:
#   bash scripts/clear-all-kyc.sh
# 远程:
#   ssh ... 'bash -s' < scripts/clear-all-kyc.sh
set -euo pipefail

ROOT="${ROOT:-/root/workspace/tma-projects}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

DB_USER=$(grep -m1 '^MYSQL_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'")
DB_PASS=$(grep -m1 '^MYSQL_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'")
DB_NAME=$(grep '^MYSQL_DATABASE=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'")
DB_NAME=${DB_NAME:-betogo}

echo "==> [1/3] 清空 MySQL KYC 表..."
podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  < "$ROOT/scripts/clear-all-kyc.sql" 2>&1 | grep -v Warning

echo "==> [2/3] 清理 Redis KYC 相关键..."
for pattern in 'tma:kyc:*' 'kyc:otp:*' 'kyc:otp:sent:*' 'kyc:rl:*' 'kyc:idlock:*'; do
  podman exec tma-redis sh -c "
    n=0
    for k in \$(redis-cli --scan --pattern '$pattern'); do
      redis-cli del \"\$k\" >/dev/null
      n=\$((n+1))
    done
    echo \"  $pattern: deleted \$n keys\"
  "
done

echo "==> [3/3] 删除证件/活体影像..."
KYC_IMG_DIR="$ROOT/data/kyc"
if [ -d "$KYC_IMG_DIR" ]; then
  find "$KYC_IMG_DIR" -mindepth 1 -delete 2>/dev/null || rm -rf "$KYC_IMG_DIR"/* 2>/dev/null || true
  echo "  已清空 $KYC_IMG_DIR"
else
  echo "  目录不存在，跳过: $KYC_IMG_DIR"
fi

echo "==> 完成"
