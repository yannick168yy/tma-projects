#!/usr/bin/env bash
# 一键开站所需的数据库账号与授权（每台机器执行一次）。
#
# 两件事：
#   1. 给应用账号通配授权 `betogo\_%`.*，新开的租户库自动覆盖 ——
#      开站流程因此不需要动态 GRANT，开站账号也就不需要 GRANT OPTION（那等同 root）
#   2. 建一个只用于开站的账号：能建库/删库/建表/读写，但不能授权、不能改别人权限
#
# 用法：
#   测试：DEPLOY_HOST=root@47.84.34.139 SSH_IDENTITY_FILE=... bash scripts/setup-provision-account.sh
#   生产：DEPLOY_HOST=ubuntu@13.213.107.231 SSH_IDENTITY_FILE=... \
#         REMOTE_DIR=/opt/tma-projects REMOTE_PREFIX=sudo bash scripts/setup-provision-account.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST}"
SSH_ARGS=()
[[ -n "${SSH_IDENTITY_FILE:-}" ]] && SSH_ARGS+=(-i "${SSH_IDENTITY_FILE/#\~/$HOME}")
[[ -n "${SSH_OPTS:-}" ]] && SSH_ARGS+=($SSH_OPTS)

REMOTE_DIR="${REMOTE_DIR:-/root/workspace/tma-projects}"

# 生产的 .env 是 root:root 600，且本脚本要往里追加开站账号 —— 需要 REMOTE_PREFIX=sudo
ssh "${SSH_ARGS[@]}" "$HOST" \
  "${REMOTE_PREFIX:-} env APP_DIR='$REMOTE_DIR' CTR='${REMOTE_CTR:-}' MYSQL_CTR='${MYSQL_CTR:-tma-mysql}' bash -s" <<'REMOTE'
set -uo pipefail
APP_DIR="${APP_DIR:-/root/workspace/tma-projects}"
CTR="${CTR:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
MYSQL_CTR="${MYSQL_CTR:-tma-mysql}"
cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }

# root 密码：容器自身的环境变量优先。生产上 .env 里那份与容器实际值对不上（历史手工改过），
# 只信 .env 会以 Access denied 收场，而授权语句失败是不会中断这个脚本的。
RPW=""
for cand in \
  "$($CTR inspect "$MYSQL_CTR" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -m1 '^MYSQL_ROOT_PASSWORD=' | cut -d= -f2-)" \
  "$(grep -m1 '^MYSQL_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'")"
do
  [ -n "$cand" ] || continue
  if $CTR exec "$MYSQL_CTR" mysql -uroot -p"$cand" -e "SELECT 1" >/dev/null 2>&1; then RPW="$cand"; break; fi
done
[ -n "$RPW" ] || { echo "拿不到可用的 root 密码，建账号与授权都需要 root" >&2; exit 1; }

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

$CTR exec "$MYSQL_CTR" mysql -uroot -p"$RPW" -e "
GRANT ALL PRIVILEGES ON \`betogo\\_%\`.* TO '${APP_USER}'@'%';
CREATE USER IF NOT EXISTS '${PROV_USER}'@'%' IDENTIFIED BY '${PROV_PASS}';
ALTER USER '${PROV_USER}'@'%' IDENTIFIED BY '${PROV_PASS}';
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE, CREATE VIEW, SHOW VIEW, TRIGGER, EXECUTE, CREATE ROUTINE, ALTER ROUTINE ON *.* TO '${PROV_USER}'@'%';
FLUSH PRIVILEGES;
" 2>&1 | grep -v "Using a password"

echo "  --- 应用账号授权 ---"
$CTR exec "$MYSQL_CTR" mysql -uroot -p"$RPW" -sN -e "SHOW GRANTS FOR '${APP_USER}'@'%'" 2>/dev/null | sed 's/^/    /'
echo "  --- 开站账号授权 ---"
$CTR exec "$MYSQL_CTR" mysql -uroot -p"$RPW" -sN -e "SHOW GRANTS FOR '${PROV_USER}'@'%'" 2>/dev/null | sed 's/^/    /'
REMOTE
