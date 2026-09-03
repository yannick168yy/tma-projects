#!/usr/bin/env bash
# 一键开站所需的数据库账号与授权（每台机器执行一次）。
#
# 两件事：
#   1. 给应用账号通配授权 `betogo\_%`.*，新开的租户库自动覆盖 ——
#      开站流程因此不需要动态 GRANT，开站账号也就不需要 GRANT OPTION（那等同 root）
#   2. 建一个只用于开站的账号：能建库/删库/建表/读写，但不能授权、不能改别人权限
#
# 用法：
#   DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/setup-provision-account.sh
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
APP_USER=${APP_USER:-betogo}

PROV_USER=$(grep -m1 '^MYSQL_PROVISION_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
PROV_PASS=$(grep -m1 '^MYSQL_PROVISION_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")
if [ -z "$PROV_USER" ]; then
  PROV_USER=provision
  PROV_PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  printf '\n# 一键开站专用账号（建库/建表/读写，无 GRANT OPTION）\nMYSQL_PROVISION_USER=%s\nMYSQL_PROVISION_PASSWORD=%s\n' "$PROV_USER" "$PROV_PASS" >> .env
  echo "  已生成开站账号并写入 .env：$PROV_USER"
else
  echo "  .env 已有开站账号：$PROV_USER"
fi

podman exec tma-mysql mysql -uroot -p"$RPW" -e "
GRANT ALL PRIVILEGES ON \`betogo\\_%\`.* TO '${APP_USER}'@'%';
CREATE USER IF NOT EXISTS '${PROV_USER}'@'%' IDENTIFIED BY '${PROV_PASS}';
ALTER USER '${PROV_USER}'@'%' IDENTIFIED BY '${PROV_PASS}';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE VIEW, SHOW VIEW, TRIGGER, EXECUTE, CREATE ROUTINE, ALTER ROUTINE ON *.* TO '${PROV_USER}'@'%';
FLUSH PRIVILEGES;
" 2>&1 | grep -v "Using a password"

echo "  --- 应用账号授权 ---"
podman exec tma-mysql mysql -uroot -p"$RPW" -sN -e "SHOW GRANTS FOR '${APP_USER}'@'%'" 2>/dev/null | sed 's/^/    /'
echo "  --- 开站账号授权 ---"
podman exec tma-mysql mysql -uroot -p"$RPW" -sN -e "SHOW GRANTS FOR '${PROV_USER}'@'%'" 2>/dev/null | sed 's/^/    /'
REMOTE
