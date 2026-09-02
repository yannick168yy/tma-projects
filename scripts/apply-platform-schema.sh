#!/usr/bin/env bash
# 本地应用平台库（betogo_platform）：建库 + 授权 + 按 schema_migrations 执行增量迁移
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ [[:space:]] ]] && continue
    export "${key}=${val}"
  done < .env
fi

MYSQL_CONTAINER="${MYSQL_CONTAINER:-tma-mysql}"
ROOT_PW="${MYSQL_ROOT_PASSWORD:-root_dev_only}"
PLATFORM_DB="${MYSQL_PLATFORM_DATABASE:-betogo_platform}"
APP_USER="${MYSQL_BETOGO_USER:-betogo}"
APP_PW="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}"

log() { printf '==> %s\n' "$*"; }

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MYSQL_CONTAINER"; then RT=docker
elif command -v podman >/dev/null && podman ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MYSQL_CONTAINER"; then RT=podman
else RT=host
fi

# 查询用：不带 -i。容器 exec 带 -i 会抢占 stdin，脚本若被管道喂入会被吞掉后续内容
mysql_cli() {
  case "$RT" in
    docker) docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@" ;;
    podman) podman exec "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@" ;;
    host)   mysql -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" -uroot ${ROOT_PW:+-p"$ROOT_PW"} "$@" ;;
  esac
}

# 灌文件用：必须带 -i，且调用方显式重定向
mysql_file() {
  case "$RT" in
    docker) docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@" ;;
    podman) podman exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@" ;;
    host)   mysql -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" -uroot ${ROOT_PW:+-p"$ROOT_PW"} "$@" ;;
  esac
}

[[ -z "$APP_PW" ]] && { echo "请在 .env 设置 MYSQL_BETOGO_PASSWORD 或 MYSQL_PASSWORD" >&2; exit 1; }

log "Runtime: $RT，平台库: $PLATFORM_DB"

# 应用账号同时需要访问平台库与租户库，这里只补平台库授权，租户库授权不动
mysql_file <<EOF
CREATE DATABASE IF NOT EXISTS \`${PLATFORM_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`${PLATFORM_DB}\`.* TO '${APP_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${PLATFORM_DB}\`.* TO '${APP_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

mysql_cli "$PLATFORM_DB" -e "CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
)"

# 已执行版本一次性取回本地比对，不做每文件一次 SQL 往返
APPLIED="$(mysql_cli "$PLATFORM_DB" -sN -e "SELECT version FROM schema_migrations")"
RAN=0; SKIP=0
for f in "$ROOT"/infra/database/platform/[0-9][0-9][0-9]_*.sql; do
  [[ -f "$f" ]] || continue
  ver="$(basename "$f" .sql)"
  if grep -qx "$ver" <<<"$APPLIED"; then SKIP=$((SKIP+1)); continue; fi
  mysql_file --default-character-set=utf8mb4 "$PLATFORM_DB" < "$f"
  mysql_cli "$PLATFORM_DB" -e "INSERT INTO schema_migrations (version) VALUES ('$ver')"
  echo "  ran: $ver"
  RAN=$((RAN+1))
done
log "平台库迁移完成（执行 $RAN，跳过 $SKIP）"
