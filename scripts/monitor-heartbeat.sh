#!/usr/bin/env bash
# 服务心跳监控：健康接口 + 容器存活 + 磁盘阈值 + 外部 URL 交叉探测，异常推 Telegram（带冷却与恢复通知）。
# 由 cron 每分钟执行；正常时静默无输出。
#
# 环境变量：
#   WORK_DIR             项目目录，读 .env 拿 ADMIN_TG_BOT_TOKEN / ADMIN_TG_CHAT_ID（默认脚本上两级目录）
#   LOCAL_HEALTH         逗号分隔本机健康 URL（默认 bff:3000 + core:4000 的 /health；设为空串跳过）
#   EXPECTED_CONTAINERS  逗号分隔必须 running 的容器名（默认测试机布局；设为空串跳过）
#   EXTERNAL_URLS        逗号分隔外部探测 URL（可选，用于从本机交叉监控另一环境）
#   DISK_LIMIT           磁盘使用率告警阈值百分比（默认 85）
#   COOLDOWN_SEC         同一告警重复通知冷却秒数（默认 1800）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="${WORK_DIR:-$(dirname "$SCRIPT_DIR")}"
LOCAL_HEALTH="${LOCAL_HEALTH-http://127.0.0.1:3000/health,http://127.0.0.1:4000/health}"
EXPECTED_CONTAINERS="${EXPECTED_CONTAINERS-tma-mysql,tma-redis,tma-nats,tma-bff-node,tma-core-node,tma-web-tma,tma-web-admin}"
EXTERNAL_URLS="${EXTERNAL_URLS-}"
DISK_LIMIT="${DISK_LIMIT:-85}"
COOLDOWN_SEC="${COOLDOWN_SEC:-1800}"
STATE_DIR="/var/tmp/betogo-monitor"
mkdir -p "$STATE_DIR"

TG_TOKEN="$(grep '^ADMIN_TG_BOT_TOKEN=' "$WORK_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
TG_CHAT="$(grep '^ADMIN_TG_CHAT_ID=' "$WORK_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"

notify() {
  local text="$1"
  [[ -z "$TG_TOKEN" || -z "$TG_CHAT" ]] && { echo "[monitor] TG 未配置: $text"; return; }
  curl -sf -m 10 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=${text}" >/dev/null || echo "[monitor] TG 推送失败: $text"
}

# report <唯一键> <ok|fail> <告警文案>
# fail：冷却期外发告警并记状态；ok：若之前有告警状态则发恢复通知
report() {
  local key state msg now last
  key="$(echo -n "$1" | md5sum | cut -d' ' -f1)"
  state="$2"
  msg="$3"
  now="$(date +%s)"
  local f="$STATE_DIR/$key"
  if [[ "$state" == fail ]]; then
    last="$(cat "$f" 2>/dev/null || echo 0)"
    if (( now - last >= COOLDOWN_SEC )); then
      echo "$now" > "$f"
      echo "[monitor] $(date '+%F %T') ALERT: $msg"
      notify "🔴 $(hostname) $msg"
    fi
  else
    if [[ -f "$f" ]]; then
      rm -f "$f"
      echo "[monitor] $(date '+%F %T') RECOVERED: $msg"
      notify "🟢 $(hostname) 已恢复: $msg"
    fi
  fi
}

IFS=',' read -ra urls <<< "$LOCAL_HEALTH"
for url in "${urls[@]}"; do
  [[ -z "$url" ]] && continue
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url" || echo 000)"
  if [[ "$code" == 200 ]]; then
    report "health:$url" ok "健康检查 $url"
  else
    report "health:$url" fail "健康检查失败 $url (HTTP $code)"
  fi
done

if [[ -n "$EXPECTED_CONTAINERS" ]] && command -v podman >/dev/null; then
  running="$(podman ps --format '{{.Names}}' 2>/dev/null)"
  IFS=',' read -ra names <<< "$EXPECTED_CONTAINERS"
  for name in "${names[@]}"; do
    [[ -z "$name" ]] && continue
    if grep -qx "$name" <<< "$running"; then
      report "container:$name" ok "容器 $name"
    else
      report "container:$name" fail "容器 $name 不在运行"
    fi
  done
fi

usage="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [[ -n "$usage" ]]; then
  if (( usage >= DISK_LIMIT )); then
    report "disk:/" fail "磁盘使用率 ${usage}% (阈值 ${DISK_LIMIT}%)"
  else
    report "disk:/" ok "磁盘使用率"
  fi
fi

IFS=',' read -ra exts <<< "$EXTERNAL_URLS"
for url in "${exts[@]}"; do
  [[ -z "$url" ]] && continue
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$url" || echo 000)"
  if [[ "$code" == 200 ]]; then
    report "ext:$url" ok "外部探测 $url"
  else
    report "ext:$url" fail "外部探测失败 $url (HTTP $code)"
  fi
done
