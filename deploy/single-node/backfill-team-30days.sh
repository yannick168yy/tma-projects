#!/bin/bash
# 回填 BG-10001 代理近 30 天佣金数据
# 用法：bash deploy/single-node/backfill-team-30days.sh [admin_token] [days]
#
# 会顺序调用 POST /admin/team/settle { date, force:true }
# 从今天往前推 DAYS 天，每天一次（force 覆盖旧数据）

set -e

ADMIN_TOKEN="${1:-}"          # 传入 admin JWT 或直接用 curl -u
DAYS="${2:-30}"
BFF_URL="http://localhost:3000"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "[backfill] 用法: $0 <admin_jwt_token> [days=30]"
  echo "[backfill] 示例: $0 'Bearer eyJ...' 30"
  exit 1
fi

echo "[backfill] 开始回填近 ${DAYS} 天数据 ..."

for i in $(seq $((DAYS - 1)) -1 0); do
  # macOS/Linux 兼容的日期偏移
  if date -v-1d +%Y-%m-%d >/dev/null 2>&1; then
    DATE=$(date -v-${i}d +%Y-%m-%d)   # macOS
  else
    DATE=$(date -d "-${i} days" +%Y-%m-%d)  # Linux
  fi

  echo -n "[backfill] ${DATE} ... "
  RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${BFF_URL}/admin/team/settle" \
    -H "Content-Type: application/json" \
    -H "Authorization: ${ADMIN_TOKEN}" \
    -d "{\"date\": \"${DATE}\", \"force\": true}")

  if [ "$RESP" = "200" ]; then
    echo "OK"
  else
    echo "FAIL (HTTP ${RESP})"
  fi
  sleep 0.5
done

echo "[backfill] 完成！"
