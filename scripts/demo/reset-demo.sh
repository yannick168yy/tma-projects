#!/usr/bin/env bash
# 演示库每日重置。由 cron 调用，也可手动跑。
#
# 🔴 手动执行脚本，不接进部署流程。它会 DROP DATABASE。
#
# 五步顺序不能调换，每一步都对应一个真会踩到的坑：
#   1. drop + 建库      —— 只重建业务库，绝不碰 pf_tenant 的登记
#   2. 导入快照          —— 快照是脱敏后的固定样本
#   3. 补跑迁移          —— 快照自带 schema_migrations（记录打快照那天的版本），
#                          执行器据此只补跑之后的新迁移
#   4. 恢复管理员账号    —— 快照里 admin_accounts 是空的（脱敏时清掉了，不能
#                          把源站管理员带出来），不补回来演示后台直接登不进去
#   5. 时间戳平移        —— 否则第二天仪表盘显示"最近登录 3 天前"，一眼是死数据
#   6. 清 Redis 租户前缀 —— 库换了但缓存还是旧的，页面数字和库里对不上
#
# 用法：
#   APP_DIR=/root/workspace/tma-projects DEMO_TENANT=demo bash reset-demo.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
DEMO_TENANT="${DEMO_TENANT:-demo}"
DEMO_DB="betogo_${DEMO_TENANT}"
SNAPSHOT="${SNAPSHOT:-$APP_DIR/data/demo/demo-snapshot.sql.gz}"
# 管理员种子与快照分开存：快照每次刷新数据都会重出，而演示账号要一直是同一个
# （销售记住一套凭据就行）。客人在演示中改了密码，第二天重置会还原成初始密码。
ADMIN_SEED="${ADMIN_SEED:-$APP_DIR/data/demo/demo-admin-seed.sql}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
REDIS_CTR="${REDIS_CTR:-tma-redis}"
PF_DB="${PF_DB:-betogo_platform}"

cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }
[ -f "$SNAPSHOT" ] || { echo "找不到快照 $SNAPSHOT" >&2; exit 1; }

. "$(dirname "$0")/lib/mysql-pw.sh"
resolve_mysql_pw || exit 1
MY() { $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$@" 2>/dev/null; }
MYQ() { $CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>/dev/null; }

# 安全闸：只允许操作标了 is_demo 的租户库。防止 DEMO_TENANT 传错把客户库 drop 了
IS_DEMO=$(MYQ "SELECT is_demo FROM $PF_DB.pf_tenant WHERE code='$DEMO_TENANT' AND db_name='$DEMO_DB'")
if [ "$IS_DEMO" != "1" ]; then
  echo "🔴 拒绝执行：租户 $DEMO_TENANT / 库 $DEMO_DB 没有 is_demo=1 标记" >&2
  exit 1
fi
TENANT_ID=$(MYQ "SELECT id FROM $PF_DB.pf_tenant WHERE code='$DEMO_TENANT'")

echo "==> [1/6] 重建 $DEMO_DB（pf_tenant 登记保持不动）"
MY -e "DROP DATABASE IF EXISTS \`$DEMO_DB\`; CREATE DATABASE \`$DEMO_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> [2/6] 导入快照"
gunzip -c "$SNAPSHOT" | $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$DEMO_DB" 2>/dev/null

echo "==> [3/6] 补跑快照之后的新迁移"
APP_DIR="$APP_DIR" CTR="$CTR" MYSQL_CTR="$MYSQL_CTR" \
  bash "$APP_DIR/deploy/single-node/remote-migrate.sh" tenants 2>&1 | grep -E "$DEMO_DB|失败" || true

echo "==> [4/6] 恢复演示管理员账号"
if [ -f "$ADMIN_SEED" ]; then
  $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$DEMO_DB" < "$ADMIN_SEED" 2>/dev/null
  N=$(MYQ "SELECT COUNT(*) FROM $DEMO_DB.admin_accounts")
  echo "    已恢复 ${N:-0} 个管理员账号"
else
  echo "  🔴 找不到 $ADMIN_SEED，演示后台将无法登录" >&2
  echo "     生成方式：mysqldump --no-create-info <演示库> admin_accounts > $ADMIN_SEED" >&2
  exit 1
fi

echo "==> [5/6] 时间戳平移到今天"
# 以注单最新时间为基准算偏移天数：演示时仪表盘要有"今天"的数据
SHIFT=$(MYQ "SELECT GREATEST(0, DATEDIFF(CURDATE(), DATE(MAX(created_at)))) FROM $DEMO_DB.bg_bet_order")
SHIFT=${SHIFT:-0}
if [ "$SHIFT" -gt 0 ]; then
  # 所有 datetime/timestamp/date 字段统一平移。用 information_schema 生成语句，
  # 避免漏表 —— 手写清单在 132 张表上必漏，漏掉的那张就会显示成几个月前
  # 两步走，不能合成一步。
  #
  # 第一步整体平移：相对关系原样保持，绝不会撞唯一键。
  # 曾经试过一步到位写成 LEAST(DATE_ADD(...), CURDATE())，结果 bg_checkin_log
  # 的唯一键 (user_id, date) 直接炸了 —— 多条超过今天的签到被 LEAST 压平到
  # 同一天，Duplicate entry。而 SQL 文件是一次性喂给 mysql 的，那条一失败，
  # 后面所有表的平移全部没执行，库里一半平移过一半没有，比不平移还糟。
  MYQ "SELECT CONCAT('UPDATE \`', table_name, '\` SET \`', column_name, '\` = DATE_ADD(\`', column_name, '\`, INTERVAL $SHIFT DAY) WHERE \`', column_name, '\` IS NOT NULL;')
       FROM information_schema.columns
       WHERE table_schema='$DEMO_DB' AND data_type IN ('datetime','timestamp','date')
         AND table_name <> 'schema_migrations'" > /tmp/demo_shift.sql

  # 第二步把越过当下的拉回来。SHIFT 是按业务时间（注单 created_at）算的，
  # 业务时间平移后正好落在今天，不会越界；越界的是 updated_at 这类记录
  # 抽取时刻的字段 —— 它们本就接近抽取当天，再加 41 天就到了未来。
  # 只处理 datetime/timestamp：date 列多是业务日期且常在唯一键里，
  # 把它们往回压就会重演上面那个 Duplicate entry。
  MYQ "SELECT CONCAT('UPDATE \`', table_name, '\` SET \`', column_name, '\` = NOW(3) WHERE \`', column_name, '\` > NOW(3);')
       FROM information_schema.columns
       WHERE table_schema='$DEMO_DB' AND data_type IN ('datetime','timestamp')
         AND table_name <> 'schema_migrations'" >> /tmp/demo_shift.sql

  $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$DEMO_DB" < /tmp/demo_shift.sql 2>&1 \
    | grep -v "Using a password" | grep "^ERROR" && { echo "  🔴 平移出错，演示库时间处于半平移状态" >&2; exit 1; }
  echo "    已平移 $SHIFT 天"
  rm -f /tmp/demo_shift.sql
else
  echo "    快照已是当天数据，无需平移"
fi

echo "==> [6/6] 清演示租户的 Redis 键（前缀 t${TENANT_ID}:）"
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
