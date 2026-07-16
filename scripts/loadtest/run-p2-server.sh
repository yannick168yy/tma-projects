#!/usr/bin/env bash
# P2 页面首屏批跑 · 服务器本机版 —— 每页首屏请求 http.batch 并发发出，量"打开一个页面"的成本。
# 判读: iter_rps=每秒可支撑的页面打开数, iter_p95=打开一个页面的P95耗时
# 用法(服务器上): nohup bash run-p2-server.sh > p2-server.log 2>&1 &   结果: p2-server-results.csv
set -u
cd "$(dirname "$0")"
OUT=${OUT:-p2-server-results.csv}
DUR=${DUR:-45s}
K6DIR=${K6DIR:-/root/loadtest-k6}
[[ -f "$OUT" ]] || echo "page,vus,iter_rps,iter_med_ms,iter_p95_ms,req_p95_ms,err_rate" > "$OUT"

for page in startup home bonuses team games menu tasks rebate vip wallet-history bets; do
  for vus in 10 20; do
    k6 run -q -e LOCAL=1 -e PAGE="$page" -e VUS="$vus" -e DUR="$DUR" \
      --summary-export /tmp/k6sum.json --summary-trend-stats "med,p(95),p(99)" "$K6DIR/pages.js" >/dev/null 2>&1
    PAGE_="$page" V_="$vus" python3 - >> "$OUT" <<'PY'
import json, os
m = json.load(open('/tmp/k6sum.json'))['metrics']
it = m['iteration_duration']; e = os.environ
print(','.join([e['PAGE_'], e['V_'], f"{m['iterations']['rate']:.1f}",
  str(round(it['med'])), str(round(it['p(95)'])),
  str(round(m['http_req_duration']['p(95)'])), f"{m['http_req_failed']['value']:.4f}"]))
PY
    tail -1 "$OUT" >&2
    avail=$(free -m | awk '/Mem:/{print $7}')
    if [[ "$avail" -lt 150 ]]; then echo "ABORT: available mem ${avail}MB" >&2; exit 1; fi
    sleep 8
  done
done
echo "P2-server done -> $OUT" >&2
