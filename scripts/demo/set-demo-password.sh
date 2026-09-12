#!/usr/bin/env bash
# 重置演示后台管理员密码。
#
# 🔴 手动执行脚本，不接进部署流程。
#
# 改库还不够，必须同时重出 demo-admin-seed.sql —— 每日 reset-demo.sh 第 4 步
# 会拿那个文件恢复管理员账号，只改库的话明天凌晨密码就被还原成旧的。
#
# 用法（生产）：
#   sudo env APP_DIR=/opt/tma-projects DEMO_PASSWORD=88888888 \
#     bash /opt/tma-projects/scripts/demo/set-demo-password.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
DEMO_TENANT="${DEMO_TENANT:-demo}"
DEMO_DB="betogo_${DEMO_TENANT}"
DEMO_PASSWORD="${DEMO_PASSWORD:?请设置 DEMO_PASSWORD}"
ADMIN_SEED="${ADMIN_SEED:-$APP_DIR/data/demo/demo-admin-seed.sql}"
CTR="${CTR:-podman}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
BFF_CTR="${BFF_CTR:-tma-bff-node}"
PF_DB="${PF_DB:-betogo_platform}"

cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }

. "$(dirname "$0")/lib/mysql-pw.sh"
resolve_mysql_pw || exit 1
MYQ() { $CTR exec "$MYSQL_CTR" mysql --default-character-set=utf8mb4 -uroot -p"$PW" -sN -e "$1" 2>/dev/null; }

# 安全闸：和 reset-demo.sh 同一道 —— 只允许动标了 is_demo 的库，防止租户名传错改到客户后台密码
IS_DEMO=$(MYQ "SELECT is_demo FROM $PF_DB.pf_tenant WHERE code='$DEMO_TENANT' AND db_name='$DEMO_DB'")
if [ "$IS_DEMO" != "1" ]; then
  echo "🔴 拒绝执行：租户 $DEMO_TENANT / 库 $DEMO_DB 没有 is_demo=1 标记" >&2
  exit 1
fi

# 哈希必须和 bff 的 hashPassword 完全一致（scrypt，salt:hash，keylen 64），
# 所以借 bff 容器里的 node 现算，不在宿主上另装 node
HASH=$($CTR exec -i "$BFF_CTR" node -e '
const { scryptSync, randomBytes } = require("node:crypto")
const salt = randomBytes(16).toString("hex")
process.stdout.write(salt + ":" + scryptSync(process.argv[1], salt, 64).toString("hex"))
' "$DEMO_PASSWORD")
[ -n "$HASH" ] || { echo "🔴 哈希生成失败" >&2; exit 1; }

echo "==> 改库 $DEMO_DB.admin_accounts"
MYQ "UPDATE $DEMO_DB.admin_accounts SET password_hash='$HASH'"
MYQ "SELECT CONCAT('    ', username, ' / ', role, ' / ', status) FROM $DEMO_DB.admin_accounts"

echo "==> 重出种子 $ADMIN_SEED（否则每日重置会还原旧密码）"
mkdir -p "$(dirname "$ADMIN_SEED")"
$CTR exec "$MYSQL_CTR" mysqldump --default-character-set=utf8mb4 -uroot -p"$PW" \
  --no-create-info --skip-comments "$DEMO_DB" admin_accounts 2>/dev/null > "$ADMIN_SEED.tmp"
grep -q 'INSERT INTO' "$ADMIN_SEED.tmp" || { echo "🔴 导出为空，保留原种子不动" >&2; rm -f "$ADMIN_SEED.tmp"; exit 1; }
mv "$ADMIN_SEED.tmp" "$ADMIN_SEED"

echo "✅ 演示后台密码已更新，种子已同步"
