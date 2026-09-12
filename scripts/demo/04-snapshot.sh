#!/usr/bin/env bash
# 把脱敏后的临时库导成快照文件，供 reset-demo.sh 每日还原。
#
# 🔴 必须先跑过 03-verify.mjs 且通过。这里会再确认一次 SKIP 表为空，
# 但真正的把关在 03 —— 这道只是防手滑跳步骤。

set -euo pipefail
APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
STAGE_DB="${STAGE_DB:-betogo_demo_stage}"
OUT="${OUT:-$APP_DIR/data/demo/demo-snapshot.sql.gz}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"

cd "$APP_DIR"
. "$(dirname "$0")/lib/mysql-pw.sh"
resolve_mysql_pw || exit 1
MYQ() { $CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>/dev/null; }

N=$(MYQ "SELECT COUNT(*) FROM $STAGE_DB.admin_accounts")
if [ "${N:-1}" != "0" ]; then
  echo "🔴 admin_accounts 不为空（$N 行）。没跑脱敏或跑失败了，拒绝出快照" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
echo "==> 导出 $STAGE_DB → $OUT"
$CTR exec "$MYSQL_CTR" sh -c \
  "mysqldump -uroot -p'$PW' --single-transaction --no-tablespaces --routines=false --triggers=false '$STAGE_DB'" 2>/dev/null \
  | gzip -9 > "$OUT"

echo "✅ 快照已生成：$(du -h "$OUT" | cut -f1)"
echo "   下一步：bash reset-demo.sh 把它导进演示库"
