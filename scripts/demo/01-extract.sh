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
# node 一律在 bff 容器里跑：服务器宿主机没装 node（生产同样是容器化部署），
# 而 mysql2 也只在容器的 /app/node_modules 里。02/03 两步也走同一个容器。
BFF_CTR="${BFF_CTR:-tma-bff-node}"

[[ "$STAGE_DB" == *_stage ]] || { echo "STAGE_DB 必须以 _stage 结尾" >&2; exit 1; }

cd "$APP_DIR"
PW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")

# 把脚本送进容器，后续 node 调用（含 02/03 两步）都从这里读
$CTR exec "$BFF_CTR" rm -rf /tmp/demo-scripts
$CTR cp "$APP_DIR/scripts/demo" "$BFF_CTR:/tmp/demo-scripts"
NODE_IN_CTR() { $CTR exec -i "$BFF_CTR" node --input-type=module; }
# 只滤掉密码告警，其余 stderr 必须透出来 —— 全部 2>/dev/null 加上 set -e，
# 出错时脚本会一声不吭地退出，查起来毫无线索（踩过）
MY() { $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$@" 2>&1 | grep -v "Using a password" || true; }
MYQ() {
  local out
  out=$($CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>&1 | grep -v "Using a password" || true)
  if echo "$out" | grep -q "^ERROR"; then
    echo "  [SQL 失败] $out" >&2
    echo "  语句：$(echo "$1" | head -c 200)" >&2
    return 1
  fi
  echo "$out"
}

echo "==> 建临时库 $STAGE_DB"
MY -e "DROP DATABASE IF EXISTS \`$STAGE_DB\`; CREATE DATABASE \`$STAGE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> 复制结构（全部 132 张表，只要结构）"
$CTR exec "$MYSQL_CTR" sh -c \
  "mysqldump -uroot -p'$PW' --single-transaction --no-tablespaces --no-data --routines=false --triggers=false '$SRC_DB'" 2>/dev/null \
  | $CTR exec -i "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" "$STAGE_DB" 2>/dev/null

echo "==> 选定样本用户（近 $DAYS 天有活动的，上限 $USERS 个）"
# 优先挑"有完整链路"的用户：有充值、有注单的，演示时点进去才不是空页
# 外层的派生表不能省：MySQL 不允许 IN 子查询直接带 LIMIT
# （ERROR 1235: doesn't yet support 'LIMIT & IN/ALL/ANY/SOME subquery'）
MYQ "INSERT INTO $STAGE_DB.bg_user
     SELECT u.* FROM $SRC_DB.bg_user u
     WHERE u.id IN (
       SELECT id FROM (
         SELECT user_id AS id FROM $SRC_DB.bg_deposit_order
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL $DAYS DAY)
          GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT $USERS
       ) picked
     )"
PICKED=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
echo "    选中 $PICKED 个用户"

if [ "${PICKED:-0}" -eq 0 ]; then
  echo "⚠️  近 $DAYS 天没有充值用户，回退为按注册时间取最新 $USERS 个"
  MYQ "INSERT INTO $STAGE_DB.bg_user SELECT * FROM $SRC_DB.bg_user ORDER BY registered_at DESC LIMIT $USERS"  # 直接 LIMIT，没有 IN 子查询，合法
  PICKED=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
  echo "    选中 $PICKED 个用户"
fi

echo "==> 按 user_id 关联导入明细（近 $DAYS 天）"

# SKIP 表在这一步就排除，不等 02-mask 去 TRUNCATE。
# 让敏感数据先进来再清掉，中间任何一步失败都会把它留在库里
SKIP_TABLES=$(echo "import { SKIP } from '/tmp/demo-scripts/config.mjs'; console.log(Object.keys(SKIP).join(' '))" | NODE_IN_CTR)
COPY_TABLES=$(echo "import { COPY } from '/tmp/demo-scripts/config.mjs'; console.log(COPY.join(' '))" | NODE_IN_CTR)

# 三个导入阶段的表清单是会重叠的，同一张表导两次就是主键冲突：
#   bg_turnover_requirements / bg_redep_offer 既在 COPY 里又有 user_id 列
#   bi_daily_user / bi_user_active_day 既是 BI 表又有 user_id 列
# 按"哪个阶段的规则更合适"来分配归属：配置表走 COPY（要全量），
# BI 表走 BI 阶段（按 stat_date 窗口），user_id 阶段把这两类都让出去。
in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }

# bg_user.id 的 collation 要显式带上：源库里部分表的 user_id 是
# utf8mb4_0900_ai_ci（MySQL 8 默认），与 bg_user.id 的 utf8mb4_unicode_ci
# 撞在一起会报 ERROR 1267 Illegal mix of collations
UID_COLL=$(MYQ "SELECT collation_name FROM information_schema.columns
                 WHERE table_schema='$STAGE_DB' AND table_name='bg_user' AND column_name='id'")
UID_COLL=${UID_COLL:-utf8mb4_unicode_ci}

# 有 user_id 且有时间字段的表：双重过滤。只有 user_id 的：只按用户过滤
for T in $(MYQ "SELECT DISTINCT c.table_name FROM information_schema.columns c
                WHERE c.table_schema='$SRC_DB' AND c.column_name='user_id'"); do
  in_list "$T" "$SKIP_TABLES" && continue
  in_list "$T" "$COPY_TABLES" && continue          # 配置表由 COPY 阶段全量导
  case "$T" in bi_*) continue ;; esac              # BI 表由 BI 阶段按窗口导
  HAS_CREATED=$(MYQ "SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema='$SRC_DB' AND table_name='$T' AND column_name='created_at'")
  IN_USERS="user_id COLLATE $UID_COLL IN (SELECT id FROM $STAGE_DB.bg_user)"
  if [ "$HAS_CREATED" = "1" ]; then
    WHERE="$IN_USERS AND created_at >= DATE_SUB(NOW(), INTERVAL $DAYS DAY)"
  else
    WHERE="$IN_USERS"
  fi
  N=$(MYQ "INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` WHERE $WHERE; SELECT ROW_COUNT()")
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo "==> 导入配置与参考表"
echo "import { COPY } from '/tmp/demo-scripts/config.mjs'; console.log(COPY.join(' '))" \
  | NODE_IN_CTR | tr ' ' '\n' | while read -r T; do
  [ -n "$T" ] || continue
  in_list "$T" "$SKIP_TABLES" && continue
  # 大表带时间窗，不全量搬 —— 全量复制 5 万行汇率表足以把单机 IO 打满
  WIN=$(echo "import { COPY_WINDOWED } from '/tmp/demo-scripts/config.mjs'
const w = COPY_WINDOWED['$T']
if (w) console.log(\`WHERE \${w.column} >= DATE_SUB(NOW(), INTERVAL \${w.days} DAY)\`)" | NODE_IN_CTR)
  N=$(MYQ "INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` ${WIN}; SELECT ROW_COUNT()") || continue
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo "==> 导入 BI 日表（近 $BI_DAYS 天，让报表曲线连续）"
for T in $(MYQ "SELECT table_name FROM information_schema.tables
                WHERE table_schema='$SRC_DB' AND table_name LIKE 'bi\\_%'"); do
  in_list "$T" "$SKIP_TABLES" && continue
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
