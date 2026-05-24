#!/usr/bin/env bash
# BetoGo 本地一键部署（最小栈：redis + bff-node + web-tma）
# 全量组件: docker compose --profile full up -d --build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '==> %s\n' "$*"; }

# ── 1. Merge missing keys from .env.example → .env ─────────────────
if [[ ! -f .env ]]; then
  log "Creating .env from .env.example"
  cp .env.example .env
fi

merge_env_key() {
  local key="$1"
  if grep -q "^${key}=" .env 2>/dev/null; then
    return 0
  fi
  local line
  line="$(grep "^${key}=" .env.example 2>/dev/null | head -1 || true)"
  if [[ -n "$line" ]]; then
    printf '%s\n' "$line" >> .env
    log "Added to .env: ${key}"
  fi
}

while IFS= read -r key; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  merge_env_key "$key"
done < <(grep -E '^[A-Z][A-Z0-9_]*=' .env.example | cut -d= -f1)

# ── 2. 停掉已弃用的本地容器（若曾跑过 full 栈）────────────────────
for name in tma-nacos tma-mysql tma-rabbitmq tma-core-java; do
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    docker stop "$name" 2>/dev/null || true
    log "Stopped optional container: ${name}"
  fi
done

# ── 3. Docker Compose 最小栈 ───────────────────────────────────────
# 覆盖 .env 里可能残留的 MYSQL_HOST / NACOS（避免连不到已停用的容器）
export BFF_STORAGE="${BFF_STORAGE:-redis}"
export MYSQL_HOST=
export MYSQL_PASSWORD=
export NACOS_SERVER_ADDR=

log "Starting minimal stack (redis + bff-node + web-tma, BFF_STORAGE=${BFF_STORAGE})"
docker compose up -d redis
docker compose up -d --build bff-node web-tma

log "Service status:"
docker compose ps

log "Health checks"
curl -sf "http://127.0.0.1:${BFF_PORT:-3000}/health" >/dev/null && log "  BFF /health: ok" || log "  BFF /health: FAIL"
curl -sf -o /dev/null "http://127.0.0.1:${WEB_TMA_PORT:-5173}/" && log "  web-tma :5173: ok" || log "  web-tma: FAIL"

if [[ "${LOCAL_DEPLOY_FULL:-}" == "1" ]]; then
  log "LOCAL_DEPLOY_FULL=1 — starting profile full (mysql, nacos, rabbitmq)"
  docker compose --profile full up -d mysql nacos rabbitmq
  log "Waiting for MySQL..."
  for i in $(seq 1 30); do
    if docker exec tma-mysql mysqladmin ping -h localhost -uroot -p"${MYSQL_ROOT_PASSWORD:-root_dev_only}" --silent 2>/dev/null; then
      break
    fi
    sleep 2
  done
  docker exec tma-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-root_dev_only}" -e \
    "CREATE DATABASE IF NOT EXISTS betogo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true
  TABLE_COUNT="$(docker exec tma-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-root_dev_only}" -N -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='betogo';" 2>/dev/null | tr -d ' ' || echo 0)"
  if [[ "${TABLE_COUNT:-0}" -lt 1 ]]; then
    docker exec -i tma-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-root_dev_only}" betogo \
      < "${ROOT}/infra/database/betogo/001_schema.sql"
  fi
  if [[ -x scripts/publish-nacos-config.sh ]]; then
    ./scripts/publish-nacos-config.sh || log "Nacos publish skipped"
  fi
  log "Recreate BFF with MYSQL_HOST=mysql (set BFF_STORAGE=mysql in .env to persist)"
  docker compose up -d --build bff-node
fi

log "Done. Client: http://localhost:${WEB_TMA_PORT:-5173}  BFF: http://localhost:${BFF_PORT:-3000}/api/v1"
log "Optional full stack: LOCAL_DEPLOY_FULL=1 ./scripts/local-deploy.sh"
