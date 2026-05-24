#!/usr/bin/env bash
# 本地 Docker / 阿里云 Podman：统一应用 betogo 库与表结构
# 唯一来源：deploy/mysql/create-betogo-database.sql + infra/database/betogo/001_schema.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MYSQL_CONTAINER="${MYSQL_CONTAINER:-tma-mysql}"
ROOT_PW="${MYSQL_ROOT_PASSWORD:-root_dev_only}"
BETOGO_DB="${MYSQL_DATABASE:-betogo}"
BETOGO_USER="${MYSQL_BETOGO_USER:-betogo}"
BETOGO_PW="${MYSQL_BETOGO_PASSWORD:-${MYSQL_PASSWORD:-}}"
RUNTIME="${CTR:-}"

log() { printf '==> %s\n' "$*"; }

detect_runtime() {
  if [[ -n "$RUNTIME" ]]; then
    echo "$RUNTIME"
    return
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MYSQL_CONTAINER"; then
    echo docker
  elif command -v podman >/dev/null && podman ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MYSQL_CONTAINER"; then
    echo podman
  else
    echo host
  fi
}

mysql_cli() {
  local rt="$1"
  shift
  case "$rt" in
    docker)
      docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@"
      ;;
    podman)
      podman exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" "$@"
      ;;
    host)
      mysql -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" -uroot ${ROOT_PW:+-p"$ROOT_PW"} "$@"
      ;;
    *)
      echo "unknown runtime: $rt" >&2
      exit 1
      ;;
  esac
}

wait_mysql() {
  local rt="$1"
  log "Waiting for MySQL ($rt / $MYSQL_CONTAINER)..."
  for i in $(seq 1 40); do
    if mysql_cli "$rt" -e "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "MySQL not ready" >&2
  exit 1
}

RT="$(detect_runtime)"
log "Runtime: $RT (container=$MYSQL_CONTAINER)"

wait_mysql "$RT"

if [[ -z "$BETOGO_PW" ]]; then
  echo "Set MYSQL_BETOGO_PASSWORD or MYSQL_PASSWORD in .env" >&2
  exit 1
fi

log "Ensure database and app user ($BETOGO_USER)"
mysql_cli "$RT" <<EOF
CREATE DATABASE IF NOT EXISTS \`${BETOGO_DB}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${BETOGO_USER}'@'%' IDENTIFIED BY '${BETOGO_PW}';
CREATE USER IF NOT EXISTS '${BETOGO_USER}'@'localhost' IDENTIFIED BY '${BETOGO_PW}';
GRANT ALL PRIVILEGES ON \`${BETOGO_DB}\`.* TO '${BETOGO_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${BETOGO_DB}\`.* TO '${BETOGO_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

TABLE_COUNT="$(mysql_cli "$RT" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${BETOGO_DB}';" | tr -d ' ')"

if [[ "${TABLE_COUNT:-0}" -lt 1 ]]; then
  log "Applying schema: infra/database/betogo/001_schema.sql"
  mysql_cli "$RT" "$BETOGO_DB" < "${ROOT}/infra/database/betogo/001_schema.sql"
else
  log "Schema exists (${TABLE_COUNT} tables in ${BETOGO_DB}), skip 001_schema.sql"
fi

log "Done. ${BETOGO_DB} @ ${MYSQL_CONTAINER:-host}"
