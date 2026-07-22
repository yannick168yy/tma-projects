#!/usr/bin/env bash
# 生产清库的服务器端执行脚本（由 clear-all-user-data.prod.sh 上传后调用，勿单独手动跑）
# 用法：bash _prod-clear-remote.sh <backup|clear> <STAMP>
#   backup  仅备份到 /tmp/betogo-preclean-<STAMP>.sql.gz 并自校验
#   clear   执行清空 + AUTO_INCREMENT 归零 + Redis + KYC 图片，并打印清后行数
set -uo pipefail

WORK_DIR=/opt/tma-projects
CTN=tma-mysql
RCTN=tma-redis
DB_USER=betogo
DB_NAME=betogo
DB_PASS=$(grep -m1 '^MYSQL_BETOGO_PASSWORD=' "$WORK_DIR/.env" | cut -d= -f2- | tr -d "\"'")

ACTION="${1:-}"
STAMP="${2:-}"
[ -n "$STAMP" ] || { echo "缺少 STAMP 参数"; exit 2; }
DUMP="/tmp/betogo-preclean-$STAMP.sql.gz"

mysql_c()     { sudo podman exec -i "$CTN" mysql --default-character-set=utf8mb4 -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" "$@"; }
mysql_raw()   { sudo podman exec -i "$CTN" mysql -u"$DB_USER" -p"$DB_PASS" -N "$@"; }

do_backup() {
  mysql_raw -e "SELECT 1 FROM information_schema.schemata WHERE schema_name='betogo'" 2>/dev/null | grep -q 1 \
    || { echo "❌ 找不到 betogo schema"; exit 1; }
  echo "清库前行数快照:"
  mysql_c -N -e "SELECT CONCAT('  bg_user=',(SELECT COUNT(*) FROM bg_user),' wallet=',(SELECT COUNT(*) FROM bg_wallet),' ledger=',(SELECT COUNT(*) FROM bg_wallet_ledger),' bet=',(SELECT COUNT(*) FROM bg_bet_order),' 568bet=',(SELECT COUNT(*) FROM bg_568win_report_bet),' team_node=',(SELECT COUNT(*) FROM bg_team_node));" 2>/dev/null
  sudo podman exec -i "$CTN" mysqldump --default-character-set=utf8mb4 --single-transaction --quick --no-tablespaces \
    -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" 2>/tmp/de | gzip > "$DUMP"
  rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] || { echo "❌ mysqldump 失败 rc=$rc"; grep -vi insecure /tmp/de | head; rm -f "$DUMP"; exit 1; }
  local tbls; tbls=$(gzip -dc "$DUMP" | grep -c 'CREATE TABLE')
  echo "✅ 备份: $(ls -lh "$DUMP" | awk '{print $5}')  表数=$tbls"
  [ "$tbls" -ge 10 ] || { echo "❌ 表数异常($tbls)，中止"; exit 1; }
}

do_clear() {
  [ -s "$DUMP" ] || { echo "❌ 找不到备份 $DUMP，拒绝清理"; exit 1; }
  echo "-- 清空用户数据 --"
  mysql_c < "$WORK_DIR/scripts/clear-all-user-data.sql" 2>&1 | grep -vi insecure || true
  echo "-- AUTO_INCREMENT 归零 --"
  mysql_c < "$WORK_DIR/scripts/reset-autoinc.prod.sql" 2>&1 | grep -vi insecure || true

  echo "-- 清 Redis 用户缓存 --"
  for pattern in \
    'tma:user:*' 'tma:identity:*' 'tma:identities:user:*' 'tma:invite:*' 'tma:session:*' \
    'tma:wallet:*' 'tma:deposit:*' 'tma:deposits:user:*' 'tma:withdraw:*' 'tma:withdrawals:user:*' 'tma:ledger:user:*' \
    'tma:kyc:*' 'kyc:otp:*' 'kyc:otp:sent:*' 'kyc:otp:lock:*' 'kyc:rl:*' 'kyc:idlock:*' 'kyc:fail:*' \
    'auth:forgot:*' 'auth:login:*' 'withdraw:lock:*' 'sms:daily:*'; do
    n=$(sudo podman exec -i "$RCTN" sh -c "c=0; for k in \$(redis-cli --scan --pattern '$pattern'); do redis-cli del \"\$k\" >/dev/null; c=\$((c+1)); done; echo \$c")
    [ "${n:-0}" != "0" ] && echo "  Redis $pattern: $n"
  done

  echo "-- 清 KYC 上传图片（保留 covers/ 游戏封面，勿删）--"
  if [ -d "$WORK_DIR/data/kyc" ]; then
    # covers/ 是游戏封面(全站资产)，与 KYC 用户上传件同放 data/kyc,清用户数据时必须排除
    find "$WORK_DIR/data/kyc" -mindepth 1 -maxdepth 1 ! -name covers -exec rm -rf {} + 2>/dev/null || true
    echo "  已清 $WORK_DIR/data/kyc（保留 covers/）"
  else
    echo "  KYC 目录不存在，跳过"
  fi

  echo "-- 清后行数校验（应全 0）--"
  mysql_c -N -e "SELECT CONCAT('  bg_user=',(SELECT COUNT(*) FROM bg_user),' wallet=',(SELECT COUNT(*) FROM bg_wallet),' ledger=',(SELECT COUNT(*) FROM bg_wallet_ledger),' bet=',(SELECT COUNT(*) FROM bg_bet_order),' deposit=',(SELECT COUNT(*) FROM bg_deposit_order),' withdraw=',(SELECT COUNT(*) FROM bg_withdraw_order),' 568bet=',(SELECT COUNT(*) FROM bg_568win_report_bet),' team_node=',(SELECT COUNT(*) FROM bg_team_node),' session=',(SELECT COUNT(*) FROM bg_session));" 2>/dev/null
  echo "-- 保留项抽查（应保留>0）--"
  mysql_c -N -e "SELECT CONCAT('  admin_accounts=',(SELECT COUNT(*) FROM admin_accounts),' 568win_game=',(SELECT COUNT(*) FROM bg_568win_game),' schema_migrations=',(SELECT COUNT(*) FROM schema_migrations));" 2>/dev/null
  echo "-- bg_user 下一个自增ID（应为1）--"
  mysql_raw -e "SELECT AUTO_INCREMENT FROM information_schema.tables WHERE table_schema='betogo' AND table_name='bg_user';" 2>/dev/null | sed 's/^/  next_id=/'
}

case "$ACTION" in
  backup) do_backup ;;
  clear)  do_clear ;;
  *) echo "用法: bash $0 <backup|clear> <STAMP>"; exit 2 ;;
esac
