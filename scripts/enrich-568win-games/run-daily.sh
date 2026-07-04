#!/bin/bash
# 568Win AI 富化每日定时任务（本机 crontab 每天 16:20 调用）
# 16:20 北京时间 = 太平洋时间午夜后，Google grounding 免费额度刚刷新
# 每日消耗上限由服务器 bg_gemini_search_quota 表硬性兜底（默认 1200，与后台按钮共享）
set -uo pipefail
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/local/Cellar/node/25.8.0/bin:$PATH"

PEM=/Users/yannicky/TMA_FILES/aliyun.pem
HOST=root@47.84.34.139
PORT=13399
LOCK=/tmp/enrich-568win.lock
LAST_OUT=/tmp/enrich-568win-last.txt

notify() {
  osascript -e "display notification \"$1\" with title \"568Win AI 富化\"" 2>/dev/null || true
}

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[$(date '+%F %T')] 上一次任务仍在运行，跳过"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null; pkill -f "$PORT:127.0.0.1:13306" 2>/dev/null' EXIT

echo "[$(date '+%F %T')] ===== 开始 568Win AI 富化 ====="
notify "开始执行（每日上限 1200 次，免费额度内）"

# 隧道每次重建，避免复用假活的旧隧道
pkill -f "$PORT:127.0.0.1:13306" 2>/dev/null
sleep 1
ssh -i "$PEM" -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
  -f -N -L "$PORT:127.0.0.1:13306" "$HOST" || { echo "隧道建立失败"; notify "❌ SSH 隧道建立失败，本次跳过"; exit 1; }

GEMINI_API_KEY=$(ssh -i "$PEM" -o StrictHostKeyChecking=no "$HOST" "podman exec tma-bff-node printenv GEMINI_API_KEY")
MYSQL_PASSWORD=$(ssh -i "$PEM" -o StrictHostKeyChecking=no "$HOST" "podman exec tma-bff-node printenv MYSQL_PASSWORD")
[ -z "$GEMINI_API_KEY" ] && { echo "取 GEMINI_API_KEY 失败"; notify "❌ 获取 API Key 失败，本次跳过"; exit 1; }

export GEMINI_API_KEY MYSQL_PASSWORD
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=$PORT MYSQL_USER=betogo

npm start 2>&1 | tee "$LAST_OUT"

SUMMARY=$(grep -E '^完成：' "$LAST_OUT" | tail -1)
if grep -q '额度已用完' "$LAST_OUT"; then
  notify "⏸ ${SUMMARY:-已停止}（今日额度用尽，明天续跑）"
elif [ -n "$SUMMARY" ]; then
  notify "✅ $SUMMARY"
else
  notify "⚠️ 执行异常结束，请查看 enrich-cron.log"
fi
echo "[$(date '+%F %T')] ===== 本轮结束 ====="
