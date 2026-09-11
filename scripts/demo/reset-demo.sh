#!/usr/bin/env bash
# 演示库每日重置。由 cron 调用，也可手动跑。
#
# 🔴 手动执行脚本，不接进部署流程。它会 DROP DATABASE。
#
# 五步顺序不能调换，每一步都对应一个真会踩到的坑：
#   1. drop + 建库      —— 只重建业务库，绝不碰 pf_tenant 的登记
#   2. 导入快照          —— 快照是脱敏后的固定样本
#   3. 补跑迁移          —— 快照自带 schema_migrations，还原等于把 schema 退回打快照那天
#   4. 时间戳平移        —— 否则第二天仪表盘显示"最近登录 3 天前"，一眼是死数据
#   5. 清 Redis 租户前缀 —— 库换了但缓存还是旧的，页面数字和库里对不上
#
# 用法：
#   APP_DIR=/root/workspace/tma-projects DEMO_TENANT=demo bash reset-demo.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
DEMO_TENANT="${DEMO_TENANT:-demo}"
DEMO_DB="betogo_${DEMO_TENANT}"
SNAPSHOT="${SNAPSHOT:-$APP_DIR/data/demo/demo-snapshot.sql.gz}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
REDIS_CTR="${REDIS_CTR:-tma-redis}"
PF_DB="${PF_DB:-betogo_platform}"

cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }
[ -r .env ] || { echo "读不到 .env" >&2; exit 1; }
[ -f "$SNAPSHOT" ] || { echo "找不到快照 $SNAPSHOT" >&2; exit 1; }

PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")
MY() { $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$@" 2>/dev/null; }
MYQ() { $CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>/dev/null; }

# 安全闸：只允许操作标了 is_demo 的租户库。防止 DEMO_TENANT 传错把客户库 drop 了
IS_DEMO=$(MYQ "SELECT is_demo FROM $PF_DB.pf_tenant WHERE code='$DEMO_TENANT' AND db_name='$DEMO_DB'")
if [ "$IS_DEMO" != "1" ]; then
  echo "🔴 拒绝执行：租户 $DEMO_TENANT / 库 $DEMO_DB 没有 is_demo=1 标记" >&2
  exit 1
fi
TENANT_ID=$(MYQ "SELECT id FROM $PF_DB.pf_tenant WHERE code='$DEMO_TENANT'")

echo "==> [1/5] 重建 $DEMO_DB（pf_tenant 登记保持不动）"
MY -e "DROP DATABASE IF EXISTS \`$DEMO_DB\`; CREATE DATABASE \`$DEMO_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> [2/5] 导入快照"
gunzip -c "$SNAPSHOT" | $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$DEMO_DB" 2>/dev/null

echo "==> [3/5] 补跑快照之后的新迁移"
APP_DIR="$APP_DIR" CTR="$CTR" MYSQL_CTR="$MYSQL_CTR" \
  bash "$APP_DIR/deploy/single-node/remote-migrate.sh" tenants 2>&1 | grep -E "$DEMO_DB|失败" || true

echo "==> [4/5] 时间戳平移到今天"
# 以注单最新时间为基准算偏移天数：演示时仪表盘要有"今天"的数据
SHIFT=$(MYQ "SELECT GREATEST(0, DATEDIFF(CURDATE(), DATE(MAX(created_at)))) FROM $DEMO_DB.bg_bet_order")
SHIFT=${SHIFT:-0}
if [ "$SHIFT" -gt 0 ]; then
  # 所有 datetime/timestamp/date 字段统一平移。用 information_schema 生成语句，
  # 避免漏表 —— 手写清单在 132 张表上必漏，漏掉的那张就会显示成几个月前
  MYQ "SELECT CONCAT('UPDATE \`', table_name, '\` SET \`', column_name, '\` = DATE_ADD(\`', column_name, '\`, INTERVAL $SHIFT DAY) WHERE \`', column_name, '\` IS NOT NULL;')
       FROM information_schema.columns
       WHERE table_schema='$DEMO_DB' AND data_type IN ('datetime','timestamp','date')
         AND table_name <> 'schema_migrations'" > /tmp/demo_shift.sql
  $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$DEMO_DB" < /tmp/demo_shift.sql 2>/dev/null
  rm -f /tmp/demo_shift.sql
  echo "    已平移 $SHIFT 天"
else
  echo "    快照已是当天数据，无需平移"
fi

echo "==> [5/5] 清演示租户的 Redis 键（前缀 t${TENANT_ID}:）"
KEYS=$($CTR exec "$REDIS_CTR" redis-cli --scan --pattern "t${TENANT_ID}:*" 2>/dev/null | head -100000)
if [ -n "$KEYS" ]; then
  echo "$KEYS" | xargs -r $CTR exec -i "$REDIS_CTR" redis-cli DEL >/dev/null 2>&1 || true
  echo "    已清 $(echo "$KEYS" | wc -l | tr -d ' ') 个键"
else
  echo "    无缓存键"
fi
# 域名解析缓存是无前缀的全局键，租户没变所以不用清

echo
echo "✅ 演示库重置完成：$DEMO_DB"
MYQ "SELECT CONCAT('   用户 ', (SELECT COUNT(*) FROM $DEMO_DB.bg_user), ' / 注单 ', (SELECT COUNT(*) FROM $DEMO_DB.bg_bet_order), ' / 充值单 ', (SELECT COUNT(*) FROM $DEMO_DB.bg_deposit_order))"
