#!/usr/bin/env bash
# P5 数据量敏感性 · 服务器本机版 —— 重历史组翻 3 倍(3000→9000局/人)后复跑 P1 优先级①接口，
# 与 p1-server-2026-07-16.csv 同口径对比：p95 随数据量线性=健康，超线性=缺索引/查询设计问题。
# team 系列数据未涨，当对照组。用法(服务器上): nohup bash run-p5-server.sh > p5-server.log 2>&1 &
set -u
cd "$(dirname "$0")"
OUT=${OUT:-p5-server-results.csv}
DUR=${DUR:-45s}
K6DIR=${K6DIR:-/root/loadtest-k6}
[[ -f "$OUT" ]] || echo "ep,umin,umax,vus,rps,med_ms,p95_ms,p99_ms,err_rate" > "$OUT"

run() { # run <ep> <umin> <umax> <vus...>
  local ep=$1 umin=$2 umax=$3; shift 3
  for vus in "$@"; do
    k6 run -q -e LOCAL=1 -e EP="$ep" -e UMIN="$umin" -e UMAX="$umax" -e VUS="$vus" -e DUR="$DUR" \
      --summary-export /tmp/k6sum.json --summary-trend-stats "med,p(95),p(99)" "$K6DIR/endpoint.js" >/dev/null 2>&1
    EP_="$ep" A_="$umin" B_="$umax" V_="$vus" python3 - >> "$OUT" <<'PY'
import json, os
m = json.load(open('/tmp/k6sum.json'))['metrics']
d = m['http_req_duration']; e = os.environ
print(','.join([e['EP_'], e['A_'], e['B_'], e['V_'], f"{m['http_reqs']['rate']:.1f}",
  str(round(d['med'])), str(round(d['p(95)'])), str(round(d['p(99)'])), f"{m['http_req_failed']['value']:.4f}"]))
PY
    tail -1 "$OUT" >&2
    avail=$(free -m | awk '/Mem:/{print $7}')
    if [[ "$avail" -lt 150 ]]; then echo "ABORT: available mem ${avail}MB < 150MB" >&2; exit 1; fi
    sleep 10
  done
}

# 数据敏感组（局数/ledger/流水 ×3）
run '/api/v1/bets?limit=20'                             1 50 5 10 20 40
run '/api/v1/ledger?limit=20'                           1 50 5 10 20 40
run '/api/v1/rebate/progress'                           1 50 5 10 20 40
run '/api/v1/vip/progress'                              1 50 10 40

# 对照组（team 数据未变，用于剥离环境漂移）
run '/api/v1/promotions/team/tree'                     51 80 10 40
run '/api/v1/promotions/team/downlines?level=1&page=1' 51 80 10 40

echo "P5-server done -> $OUT" >&2
