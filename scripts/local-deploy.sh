#!/usr/bin/env bash
# BetoGo 本地：mysql + redis + bff + web（与生产共用 infra/database/betogo/ 表结构）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '==> %s\n' "$*"; }

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

for name in tma-nacos tma-rabbitmq tma-core-java; do
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    docker stop "$name" 2>/dev/null || true
    log "Stopped optional container: ${name}"
  fi
done

log "Starting mysql + redis"
docker compose up -d mysql redis

chmod +x scripts/apply-betogo-schema.sh
bash scripts/apply-betogo-schema.sh

export BFF_STORAGE="${BFF_STORAGE:-mysql}"
export MYSQL_HOST=mysql
export NACOS_SERVER_ADDR=

log "Building bff-node + web-tma (BFF_STORAGE=${BFF_STORAGE})"
docker compose up -d --build bff-node web-tma

docker compose ps
curl -sf "http://127.0.0.1:${BFF_PORT:-3000}/health" >/dev/null && log "  BFF /health: ok" || log "  BFF /health: FAIL"
curl -sf -o /dev/null "http://127.0.0.1:${WEB_TMA_PORT:-8080}/" && log "  web-tma: ok" || log "  web-tma: FAIL"

if [[ "${LOCAL_DEPLOY_FULL:-}" == "1" ]]; then
  log "LOCAL_DEPLOY_FULL=1 — nacos + rabbitmq"
  docker compose --profile full up -d nacos rabbitmq
  [[ -x scripts/publish-nacos-config.sh ]] && ./scripts/publish-nacos-config.sh || true
fi

log "Done. Client: http://localhost:${WEB_TMA_PORT:-8080}  MySQL: localhost:${MYSQL_PORT:-3306}  betogo"
log "Schema sync: edit infra/database/betogo/*.sql then ./scripts/apply-betogo-schema.sh"
