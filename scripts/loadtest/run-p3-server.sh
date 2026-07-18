#!/usr/bin/env bash
# P3 混合真实流量 · 服务器本机版 —— mixed-full.js 按页面权重定并发逐档，找系统级拐点。
# 用法(服务器上): nohup bash run-p3-server.sh > p3-server.log 2>&1 &   结果: p3-server-results.csv
set -u
cd "$(dirname "$0")"
OUT=${OUT:-p3-server-results.csv}
K6DIR=${K6DIR:-/root/loadtest-k6}
HOST=${HOST:-www.188facai.com}          # 生产验收: HOST=www.betogo.games
MEM_ABORT_MB=${MEM_ABORT_MB:-150}       # 内存熔断阈值(2G 测试机 150；16G 生产建议 2000)
VUS_LIST=${VUS_LIST:-"10 20 40 60"}     # 4核16G 生产建议 "10 20 40 60 100 150"
[[ -f "$OUT" ]] || echo "vus,page_opens_per_s,req_rps,iter_med_ms,iter_p95_ms,req_p95_ms,err_rate,load1_end,mem_avail_end" > "$OUT"

for vus in $VUS_LIST; do
  k6 run -q -e LOCAL=1 -e HOST="$HOST" -e VUS="$vus" -e DUR=60s \
    --summary-export /tmp/k6sum.json --summary-trend-stats "med,p(95),p(99)" "$K6DIR/mixed-full.js" >/dev/null 2>&1
  V_="$vus" L_="$(cut -d' ' -f1 /proc/loadavg)" M_="$(free -m | awk '/Mem:/{print $7}')" python3 - >> "$OUT" <<'PY'
import json, os
m = json.load(open('/tmp/k6sum.json'))['metrics']
it = m['iteration_duration']; e = os.environ
print(','.join([e['V_'], f"{m['iterations']['rate']:.1f}", f"{m['http_reqs']['rate']:.1f}",
  str(round(it['med'])), str(round(it['p(95)'])),
  str(round(m['http_req_duration']['p(95)'])), f"{m['http_req_failed']['value']:.4f}", e['L_'], e['M_']]))
PY
  tail -1 "$OUT" >&2
  avail=$(free -m | awk '/Mem:/{print $7}')
  if [[ "$avail" -lt "$MEM_ABORT_MB" ]]; then echo "ABORT: available mem ${avail}MB < ${MEM_ABORT_MB}MB" >&2; exit 1; fi
  sleep 15
done
echo "P3-server done -> $OUT" >&2
