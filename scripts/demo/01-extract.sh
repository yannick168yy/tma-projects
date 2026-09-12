#!/usr/bin/env bash
# 从源库抽取样本到临时库 betogo_demo_stage。
#
# 🔴 对源库全程只读（mysqldump --single-transaction，不加锁不写入）。
# 🔴 手动执行，不接进部署流程。
#
# 采样口径：**固定日期区间**，而不是"最近 N 天"。
#
# 默认取 2026-07-26 ~ 2026-08-01 —— 那是一次买量投放的高峰期，7 天里有
# 1829 个新注册、828 笔充值、86 万注单；而同样长度的"最近 7 天"只有 26 个
# 注册、23 笔充值。差 70 倍，演示效果完全不是一回事。
#
# 两类数据分开对待：
#   BI 日表（bi_daily_*）区间内**全取** —— 报表读的就是这些预聚合表，
#     而它们在买量期总共才几千行，全取零成本，曲线完整有波峰。
#   百万级明细（注单/流水）按**每用户 N 条**限量（见 PER_USER_LIMIT），
#     保证每个用户点开都有内容，而总量压在几万行。
# 代价是 BI 汇总与明细对不上（报表说 12 万注单、明细只有 2.5 万），
# 已确认可以接受 —— 客人不会去核对这两个数。
#
# 🔴 区间末日必须选数据完整的那天。BI 日报由定时任务聚合前一天，区间最后
# 一天常常只有充值没有注单 —— 平移后它就成了"今天"，工作台的今日 GGR 与
# 今日投注额全是 0。8/1 是峰值且当天完整（103 笔充值、87762 注单），
# 所以取到 8/1 为止，8/2 舍掉。
#
# 抽完由 reset-demo.sh 把时间戳整体平移到今天：数据是买量期的饱满形态，
# 显示出来却是"最近 7 天"，客人看到的是这个站现在很火。
#
# 用法：
#   SRC_DB=betogo FROM_DATE=2026-07-26 TO_DATE=2026-08-01 USERS=800 \
#   MYSQL_CTR=tma-mysql bash 01-extract.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
SRC_DB="${SRC_DB:-betogo}"
STAGE_DB="${STAGE_DB:-betogo_demo_stage}"
# 演示区间（含首尾两天）。默认是那次买量投放的高峰期
FROM_DATE="${FROM_DATE:-2026-07-26}"
TO_DATE="${TO_DATE:-2026-08-01}"
USERS="${USERS:-800}"
FROM_TS="$FROM_DATE 00:00:00"
TO_TS="$TO_DATE 23:59:59"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
# node 一律在 bff 容器里跑：服务器宿主机没装 node（生产同样是容器化部署），
# 而 mysql2 也只在容器的 /app/node_modules 里。02/03 两步也走同一个容器。
BFF_CTR="${BFF_CTR:-tma-bff-node}"

[[ "$STAGE_DB" == *_stage ]] || { echo "STAGE_DB 必须以 _stage 结尾" >&2; exit 1; }

cd "$APP_DIR"
. "$(dirname "$0")/lib/mysql-pw.sh"
resolve_mysql_pw || exit 1

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

echo "==> 选定样本用户（$FROM_DATE ~ $TO_DATE，上限 $USERS 个）"

# 分两批挑，两类用户缺一不可：
#   充值用户 —— 他们名下有订单、注单、流水、KYC，点进去每一页都有内容
#   新注册用户 —— 没有他们，「新增用户」「注册转化」这些指标全是平的，
#                而买量演示恰恰要看这两个数
# 外层派生表不能省：MySQL 不允许 IN 子查询直接带 LIMIT（ERROR 1235）
MYQ "INSERT INTO $STAGE_DB.bg_user
     SELECT u.* FROM $SRC_DB.bg_user u
     WHERE u.id IN (
       SELECT id FROM (
         SELECT user_id AS id FROM $SRC_DB.bg_deposit_order
          WHERE created_at BETWEEN '$FROM_TS' AND '$TO_TS'
          GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT $USERS
       ) picked
     )"
PAYING=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
echo "    充值用户 $PAYING 个"

REMAIN=$(( USERS - ${PAYING:-0} ))
if [ "$REMAIN" -gt 0 ]; then
  # INSERT IGNORE：充值用户里本来就可能有区间内注册的，重复插会撞主键
  MYQ "INSERT IGNORE INTO $STAGE_DB.bg_user
       SELECT u.* FROM $SRC_DB.bg_user u
       WHERE u.registered_at BETWEEN '$FROM_TS' AND '$TO_TS'
       ORDER BY u.registered_at DESC LIMIT $REMAIN"
  TOTAL=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
  echo "    补入区间内新注册，合计 $TOTAL 个"
fi

PICKED=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.bg_user")
if [ "${PICKED:-0}" -eq 0 ]; then
  echo "🔴 区间 $FROM_DATE ~ $TO_DATE 内既无充值用户也无新注册，确认日期是否写对" >&2
  exit 1
fi

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

echo "==> 导入配置与参考表"
echo "import { COPY } from '/tmp/demo-scripts/config.mjs'; console.log(COPY.join(' '))" \
  | NODE_IN_CTR | tr ' ' '\n' | while read -r T; do
  [ -n "$T" ] || continue
  in_list "$T" "$SKIP_TABLES" && continue
  # 大表带时间窗，不全量搬 —— 全量复制 5 万行汇率表足以把单机 IO 打满
  WIN=$(echo "import { COPY_WINDOWED } from '/tmp/demo-scripts/config.mjs'
const w = COPY_WINDOWED['$T']
if (w) console.log(\`WHERE \${w.column} >= DATE_SUB('$TO_TS', INTERVAL \${w.days} DAY) AND \${w.column} <= '$TO_TS'\`)" | NODE_IN_CTR)
  N=$(MYQ "SET FOREIGN_KEY_CHECKS=0; INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` ${WIN}; SELECT ROW_COUNT()") || continue
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo "==> 按 user_id 关联导入明细（$FROM_DATE ~ $TO_DATE）"

# bg_user.id 的 collation 要显式带上：源库里部分表的 user_id 是
# utf8mb4_0900_ai_ci（MySQL 8 默认），与 bg_user.id 的 utf8mb4_unicode_ci
# 撞在一起会报 ERROR 1267 Illegal mix of collations
UID_COLL=$(MYQ "SELECT collation_name FROM information_schema.columns
                 WHERE table_schema='$STAGE_DB' AND table_name='bg_user' AND column_name='id'")
UID_COLL=${UID_COLL:-utf8mb4_unicode_ci}

for T in $(MYQ "SELECT DISTINCT c.table_name FROM information_schema.columns c
                WHERE c.table_schema='$SRC_DB' AND c.column_name='user_id'"); do
  in_list "$T" "$SKIP_TABLES" && continue
  in_list "$T" "$COPY_TABLES" && continue          # 配置表由 COPY 阶段全量导
  case "$T" in bi_*) continue ;; esac              # BI 表由 BI 阶段按区间导

  # 时间列不一定叫 created_at（bg_bet_round 叫 first_at）。找错了会退化成
  # "该用户全部历史"，区间过滤形同虚设 —— 实测因此多导了 58 万行、281MB
  TCOL=$(echo "import { TIME_COLUMN } from '/tmp/demo-scripts/config.mjs'
console.log(TIME_COLUMN['$T'] ?? 'created_at')" | NODE_IN_CTR)
  HAS_TIME=$(MYQ "SELECT COUNT(*) FROM information_schema.columns
                  WHERE table_schema='$SRC_DB' AND table_name='$T' AND column_name='$TCOL'")
  IN_USERS="user_id COLLATE $UID_COLL IN (SELECT id FROM $STAGE_DB.bg_user)"
  if [ "$HAS_TIME" = "1" ]; then
    WHERE="$IN_USERS AND \`$TCOL\` BETWEEN '$FROM_TS' AND '$TO_TS'"
  else
    WHERE="$IN_USERS"
  fi

  # 百万级的表按「每用户最多 N 条」取，其余整段取。
  # 用窗口函数排名后按 id 回捞 —— 直接 SELECT * 带上 rn 列会让列数对不上。
  LIMIT_N=$(echo "import { PER_USER_LIMIT } from '/tmp/demo-scripts/config.mjs'
console.log(PER_USER_LIMIT['$T'] ?? '')" | NODE_IN_CTR)
  if [ -n "$LIMIT_N" ] && [ "$HAS_TIME" = "1" ]; then
    N=$(MYQ "SET FOREIGN_KEY_CHECKS=0;
             INSERT INTO $STAGE_DB.\`$T\`
             SELECT o.* FROM $SRC_DB.\`$T\` o JOIN (
               SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY \`$TCOL\` DESC) rn
                   FROM $SRC_DB.\`$T\` WHERE $WHERE
               ) ranked WHERE rn <= $LIMIT_N
             ) k ON k.id = o.id;
             SELECT ROW_COUNT()") || continue
    [ "${N:-0}" -gt 0 ] && printf "    %-34s %8s 行 (每用户≤%s)\n" "$T" "$N" "$LIMIT_N"
  else
    N=$(MYQ "SET FOREIGN_KEY_CHECKS=0; INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\` WHERE $WHERE; SELECT ROW_COUNT()") || continue
    [ "${N:-0}" -gt 0 ] && printf "    %-34s %8s 行\n" "$T" "$N"
  fi
done

echo "==> 导入二级关联表（挂在已导入的父表下）"
echo "import { RELATED_BY } from '/tmp/demo-scripts/config.mjs'
for (const [t, r] of Object.entries(RELATED_BY)) console.log(\`\${t} \${r.parent} \${r.fk} \${r.parentKey}\`)" \
  | NODE_IN_CTR | while read -r T PARENT FK PKEY; do
  [ -n "$T" ] || continue
  in_list "$T" "$SKIP_TABLES" && continue
  N=$(MYQ "SET FOREIGN_KEY_CHECKS=0; INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\`
           WHERE \`$FK\` IN (SELECT \`$PKEY\` FROM $STAGE_DB.\`$PARENT\`); SELECT ROW_COUNT()") || continue
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %8s 行 (挂 %s)\n" "$T" "$N" "$PARENT"
done

echo "==> 导入 BI 日表（$FROM_DATE ~ $TO_DATE，区间内全取）"
for T in $(MYQ "SELECT table_name FROM information_schema.tables
                WHERE table_schema='$SRC_DB' AND table_name LIKE 'bi\\_%'"); do
  in_list "$T" "$SKIP_TABLES" && continue
  DCOL=$(MYQ "SELECT column_name FROM information_schema.columns
              WHERE table_schema='$SRC_DB' AND table_name='$T'
                AND column_name IN ('stat_date','date','day') LIMIT 1")
  [ -n "$DCOL" ] || continue
  N=$(MYQ "SET FOREIGN_KEY_CHECKS=0; INSERT INTO $STAGE_DB.\`$T\` SELECT * FROM $SRC_DB.\`$T\`
           WHERE \`$DCOL\` BETWEEN '$FROM_DATE' AND '$TO_DATE'; SELECT ROW_COUNT()")
  [ "${N:-0}" -gt 0 ] && printf "    %-34s %s 行\n" "$T" "$N"
done

echo
echo "✅ 抽取完成。下一步：02-mask.mjs 脱敏"
MYQ "SELECT CONCAT('   用户 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_user),
                   ' / 注单 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_bet_order),
                   ' / 充值单 ', (SELECT COUNT(*) FROM $STAGE_DB.bg_deposit_order))"
