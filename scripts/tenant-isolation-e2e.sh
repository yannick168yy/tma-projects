#!/usr/bin/env bash
# 跨租户隔离端到端验收（方案文档第 9 节清单）。
#
# 会真开一个临时租户（独立库、基线建表、独立域名），驱动流量后断言隔离，最后清理。
# 只在测试环境跑；不改自营站业务数据，并校验自营站关键表在验收前后未变。
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/tenant-isolation-e2e.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST}"
SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)

ssh "${SSH_ARGS[@]}" "$HOST" "bash -s" <<'REMOTE'
set -uo pipefail
cd /root/workspace/tma-projects
RPW=$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2- | tr -d "\"'")
APP_USER=$(grep -m1 '^MYSQL_BETOGO_USER=' .env | cut -d= -f2- | tr -d "\"'")
TDB=betogo_iso_e2e
TCODE=isoe2e
TDOMAIN=iso-e2e.local
BFF=http://127.0.0.1:3000
CORE=http://127.0.0.1:4000
TID=999

r()  { podman exec tma-mysql mysql --default-character-set=utf8mb4 -uroot -p"$RPW" -sN "$@" 2>/dev/null; }
rc() { podman exec tma-redis redis-cli "$@" 2>/dev/null; }
delkeys() { podman exec tma-redis sh -c "redis-cli --scan --pattern '$1' | xargs -r redis-cli DEL" >/dev/null 2>&1; }
PASS=0; FAIL=0
ok()   { echo "  [OK] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [NG] $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1（$2）"; else bad "$1：期望 $3，实际 $2"; fi }

cleanup() {
  echo
  echo "-- 清理 --"
  r betogo -e "DELETE FROM bg_admin_settings WHERE \`key\`='iso_e2e_marker';"
  r betogo_platform -e "DELETE FROM pf_tenant_domain WHERE domain='$TDOMAIN'; DELETE FROM pf_tenant WHERE code='$TCODE';"
  r -e "DROP DATABASE IF EXISTS \`$TDB\`;"
  delkeys "t${TID}:*"
  delkeys 'platform:tenant-by-*'
  echo "  剩余租户: $(r betogo_platform -e 'SELECT GROUP_CONCAT(code) FROM pf_tenant')"
  echo "  剩余 betogo* 库: $(r -e "SELECT GROUP_CONCAT(SCHEMA_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'betogo%'")"
  echo "  残留 t${TID}: 键: $(rc --scan --pattern "t${TID}:*" | wc -l)"
}
trap cleanup EXIT

echo "===== 跨租户隔离端到端验收 ====="
echo
echo "-- 准备：自营站基线快照 --"
BASE_USERS=$(r betogo -e "SELECT COUNT(*) FROM bg_user")
BASE_WALLET=$(r betogo -e "SELECT CONCAT(COALESCE(SUM(available),0),'/',COALESCE(SUM(frozen),0)) FROM bg_wallet")
BASE_LEDGER=$(r betogo -e "SELECT COUNT(*) FROM bg_wallet_ledger")
# 空值说明 SQL 没查成（表名/列名错），此时断言会变成「空==空」的假通过，必须直接失败
if [ -z "$BASE_USERS" ] || [ -z "$BASE_WALLET" ] || [ -z "$BASE_LEDGER" ]; then
  echo "  基线查询失败，终止验收（避免空值导致断言假通过）" >&2
  exit 1
fi
echo "  自营站 bg_user=$BASE_USERS  钱包(可用/冻结)=$BASE_WALLET  账变流水=$BASE_LEDGER"

echo
echo "-- 步骤 1：开出临时租户（独立库 + 独立域名）--"
r -e "DROP DATABASE IF EXISTS \`$TDB\`;
      CREATE DATABASE \`$TDB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      GRANT ALL PRIVILEGES ON \`$TDB\`.* TO '$APP_USER'@'%'; FLUSH PRIVILEGES;"
podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -uroot -p"$RPW" "$TDB" \
  < infra/database/betogo/schema_baseline.sql 2>/dev/null
r betogo_platform -e "INSERT INTO pf_tenant (code,name,db_name,status,self_operated)
  VALUES ('$TCODE','隔离验收租户','$TDB','active',0)
  ON DUPLICATE KEY UPDATE db_name=VALUES(db_name), status='active';"
TID=$(r betogo_platform -e "SELECT id FROM pf_tenant WHERE code='$TCODE'")
r betogo_platform -e "INSERT IGNORE INTO pf_tenant_domain (tenant_id,domain,market,purpose)
  VALUES ($TID,'$TDOMAIN','PH','site');"
delkeys 'platform:tenant-by-*'
echo "  租户 id=$TID 库=$TDB 表数=$(r -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TDB'")"

echo
echo "-- 清单 1：两租户同名配置项互不可见 --"
r betogo -e "INSERT INTO bg_admin_settings (\`key\`,\`value\`) VALUES ('iso_e2e_marker','SELF') ON DUPLICATE KEY UPDATE \`value\`='SELF';"
r "$TDB" -e "INSERT INTO bg_admin_settings (\`key\`,\`value\`) VALUES ('iso_e2e_marker','TENANT') ON DUPLICATE KEY UPDATE \`value\`='TENANT';"
check "自营库标记" "$(r betogo -e "SELECT \`value\` FROM bg_admin_settings WHERE \`key\`='iso_e2e_marker'")" "SELF"
check "租户库标记" "$(r "$TDB" -e "SELECT \`value\` FROM bg_admin_settings WHERE \`key\`='iso_e2e_marker'")" "TENANT"

echo
echo "-- 清单 2：同名 Redis 键落到不同实际键 --"
for i in 1 2 3; do curl -s -o /dev/null -H "Host: $TDOMAIN" $BFF/api/v1/site/config; done
for i in 1 2 3; do curl -s -o /dev/null -H "Host: 188facai.com" $BFF/api/v1/site/config; done
sleep 1
TKEYS=$(rc --scan --pattern "t${TID}:*" | wc -l)
if [ "${TKEYS:-0}" -gt 0 ]; then
  ok "租户键带前缀 t${TID}:（$TKEYS 个）"
  echo "     样例: $(rc --scan --pattern "t${TID}:*" | head -3 | tr '\n' ' ')"
else
  bad "租户流量未产生 t${TID}: 前缀键"
fi

echo
echo "-- 清单 3：回调归属 --"
check "错误租户段必须拒绝" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $CORE/t/nosuch/api/v1/callback/unispay)" "503"
check "本租户段可路由（401=验签失败）" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $CORE/t/$TCODE/api/v1/callback/unispay)" "401"
check "自营站原路径仍可用" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $CORE/api/v1/callback/unispay)" "401"

echo
echo "-- 清单 4：租户流量不改动自营站资金数据 --"
check "自营站用户数未变" "$(r betogo -e 'SELECT COUNT(*) FROM bg_user')" "$BASE_USERS"
check "自营站钱包(可用/冻结)未变" "$(r betogo -e "SELECT CONCAT(COALESCE(SUM(available),0),'/',COALESCE(SUM(frozen),0)) FROM bg_wallet")" "$BASE_WALLET"
check "自营站账变流水未新增" "$(r betogo -e 'SELECT COUNT(*) FROM bg_wallet_ledger')" "$BASE_LEDGER"
check "租户库用户数为 0" "$(r "$TDB" -e 'SELECT COUNT(*) FROM bg_user')" "0"
check "租户库账变流水为 0" "$(r "$TDB" -e 'SELECT COUNT(*) FROM bg_wallet_ledger')" "0"

echo
echo "-- 清单 6：库级权限边界（现状说明，非断言）--"
r -e "SHOW GRANTS FOR '$APP_USER'@'%'" | sed 's/^/     /'
echo "     当前单应用服务全部租户，应用账号必然要能访问平台库与各租户库。"
echo "     「每租户独立 DB 账号」属 P1 开站流水线：每开一站建一个只授权自己库的账号。"

echo
echo "===== 结果：通过 $PASS，失败 $FAIL ====="
[ "$FAIL" -eq 0 ] || exit 1
REMOTE
