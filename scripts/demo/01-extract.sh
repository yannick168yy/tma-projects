#!/usr/bin/env bash
# 从源库抽取样本到临时库 betogo_demo_stage。
#
# 🔴 对源库全程只读（mysqldump --single-transaction，不加锁不写入）。
# 🔴 手动执行，不接进部署流程。
#
# 采样口径：近 N 天 + 限定用户数。演示要的是"每个页面都有数据可点"，
# 不是完整历史 —— 全量导会让每日重置变慢，而客人根本翻不到第二页。
#
# BI 日表（bi_daily_*）单独按更长的窗口导：报表页面要有连续曲线才好看，
# 它和明细的数量级对不上是可以接受的（客人不会去核对汇总和明细）。
#
# 用法：
#   SRC_DB=betogo DAYS=30 USERS=500 \
#   MYSQL_CTR=tma-mysql bash 01-extract.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
SRC_DB="${SRC_DB:-betogo}"
STAGE_DB="${STAGE_DB:-betogo_demo_stage}"
DAYS="${DAYS:-30}"
BI_DAYS="${BI_DAYS:-90}"
USERS="${USERS:-500}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"

[[ "$STAGE_DB" == *_stage ]] || { echo "STAGE_DB 必须以 _stage 结尾" >&2; exit 1; }

cd "$APP_DIR"
PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")
MY() { $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$@" 2>/dev/null; }
MYQ() { $CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>/dev/null; }

echo "==> 建临时库 $STAGE_DB"
MY -e "DROP DATABASE IF EXISTS \`$STAGE_DB\`; CREATE DATABASE \`$STAGE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> 复制结构（全部 132 张表，只要结构）"
$CTR exec "$MYSQL_CTR" sh -c \
  "mysqldump -uroot -p'$PW' --single-transaction --no-tablespaces --no-data --routines=false --triggers=false '$SRC_DB'" 2>/dev/null \
  | $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$STAGE_DB" 2>/dev/null

echo "==> 选定样本用户（近 $DAYS 天有活动的，上限 $USERS 个）"
MY "$STAGE_DB" -e "
CREATE TEMPORARY TABLE IF NOT EXISTS _pick (id VARCHAR(32) PRIMARY KEY);
"
# 优先挑"有完整链路"的用户：有充值、有注单的，演示时点进去才不是空页
MYQ "INSERT INTO $STAGE_DB.bg_user
     SELECT u.* FROM $SRC_DB.bg_user u
     WHERE u.id IN (
       SELECT user_id FROM $SRC_DB.bg_deposit_order
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL $DAYS DAY)
        GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT $USERS
     )"
PICKED=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
echo "    选中 $PICKED 个用户"

if [ "${PICKED:-0}" -eq 0 ]; then
  echo "⚠️  近 $DAYS 天没有充值用户，回退为按注册时间取最新 $USERS 个"
  MYQ "INSERT INTO $STAGE_DB.bg_user SELECT * FROM $SRC_DB.bg_user ORDER BY registered_at DESC LIMIT $USERS"
  PICKED=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
  echo "    选中 $PICKED 个用户"
fi

echo "==> 按 user_id 关联导入明细（近 $DAYS 天）"
# 有 user_id 且有时间字段的表：双重过滤。只有 user_id 的：只按用户过滤
for T in $(MYQ "SELECT DISTINCT c.table_name FROM information_schema.columns c
                WHERE c.table_schema='$SRC_DB' AND c.column_name='user_id'"); do
  HAS_CREATED=$(MYQ "SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema='$SRC_DB' AND table_name='$T' AND column_name='created_at'")
  if [ "$HAS_CREATED" = "1" ]; then
    WHERE="user_id IN (SELECT id FROM $STAGE_DB.bg_user) AND created_at >= DATE_SUB(NOW(), INTERVAL $DAYS DAY)"
  else
    WHERE="user_id IN (SELECT id FROM $STAGE_DB.bg_user)"
  fi
  N=$(MYQ "INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` WHERE $WHERE; SELECT ROW_COUNT()")
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo "==> 导入配置与参考表（全量）"
node --input-type=module -e "
import { COPY } from '$APP_DIR/scripts/demo/config.mjs'
console.log(COPY.join(' '))
" 2>/dev/null | tr ' ' '\n' | while read -r T; do
  [ -n "$T" ] || continue
  # 大表带时间窗，不全量搬 —— 全量复制 5 万行汇率表足以把单机 IO 打满
  WIN=$(node --input-type=module -e "
import { COPY_WINDOWED } from '$APP_DIR/scripts/demo/config.mjs'
const w = COPY_WINDOWED['$T']
if (w) console.log(\`WHERE \${w.column} >= DATE_SUB(NOW(), INTERVAL \${w.days} DAY)\`)
" 2>/dev/null)
  N=$(MYQ "INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` ${WIN}; SELECT ROW_COUNT()") || continue
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo "==> 导入 BI 日表（近 $BI_DAYS 天，让报表曲线连续）"
for T in $(MYQ "SELECT table_name FROM information_schema.tables
                WHERE table_schema='$SRC_DB' AND table_name LIKE 'bi\\_%'"); do
  DCOL=$(MYQ "SELECT column_name FROM information_schema.columns
              WHERE table_schema='$SRC_DB' AND table_name='$T'
                AND column_name IN ('stat_date','date','day') LIMIT 1")
  [ -n "$DCOL" ] || continue
  N=$(MYQ "INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\`
           WHERE \`$DCOL\` >= DATE_SUB(CURDATE(), INTERVAL $BI_DAYS DAY); SELECT ROW_COUNT()")
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo
echo "✅ 抽取完成。下一步：02-mask.mjs 脱敏"
MYQ "SELECT CONCAT('   用户 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_user),
                   ' / 注单 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_bet_order),
                   ' / 充值单 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_deposit_order))"
