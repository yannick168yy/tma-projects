#!/usr/bin/env bash
# P1 单接口拐点批跑 —— 逐接口逐档 VUS 跑 endpoint.js，结果追加 CSV。
# 用法(本地Mac): bash run-p1.sh            结果: p1-results.csv
# 判读: p95>800ms 或 err>1% 的最低档 = 拐点
set -u
cd "$(dirname "$0")"
OUT=${OUT:-p1-results.csv}
DUR=${DUR:-45s}
[[ -f "$OUT" ]] || echo "ep,umin,umax,vus,rps,med_ms,p95_ms,p99_ms,err_rate" > "$OUT"

run() { # run <ep> <umin> <umax> <vus...>
  local ep=$1 umin=$2 umax=$3; shift 3
  for vus in "$@"; do
    k6 run -q -e EP="$ep" -e UMIN="$umin" -e UMAX="$umax" -e VUS="$vus" -e DUR="$DUR" \
      --summary-export /tmp/k6sum.json --summary-trend-stats "med,p(95),p(99)" k6/endpoint.js >/dev/null 2>&1
    EP_="$ep" A_="$umin" B_="$umax" V_="$vus" node -e '
      const m = require("/tmp/k6sum.json").metrics, e = process.env, r = Math.round
      const d = m.http_req_duration
      console.log([e.EP_, e.A_, e.B_, e.V_, m.http_reqs.rate.toFixed(1),
        r(d.med), r(d["p(95)"]), r(d["p(99)"]), m.http_req_failed.value.toFixed(4)].join(","))' >> "$OUT"
    tail -1 "$OUT" >&2
    sleep 10
  done
}

# 优先级①：JOIN/聚合重查询（4 档全扫）
run '/api/v1/bets?limit=20'                          1 50 5 10 20 40
run '/api/v1/promotions/team/tree'                  51 80 5 10 20 40
run '/api/v1/promotions/team/downlines?level=1&page=1' 51 80 5 10 20 40
run '/api/v1/rebate/progress'                        1 50 5 10 20 40
run '/api/v1/ledger?limit=20'                        1 50 5 10 20 40

# 优先级②：高频单表/Redis（两档，异常再补）
run '/api/v1/wallet/balances'                        1 500 10 40
run '/api/v1/user/me'                                1 500 10 40
run '/api/v1/slots/games?limit=30&offset=0'          1 500 10 40
run '/api/v1/tasks'                                  1 50 10 40
run '/api/v1/vip/progress'                           1 50 10 40
run '/api/v1/promotions/checkin/status'              1 500 10 40
run '/api/v1/deposits'                               1 50 10 40
run '/api/v1/withdrawals'                            1 50 10 40

# 优先级③：低频配置类（单档探底）
run '/api/v1/home/content'                           1 500 20
run '/api/v1/slots/homepage'                         1 500 20
run '/api/v1/vip/levels'                             1 500 20
run '/api/v1/rebate/config'                          1 500 20
run '/api/v1/promotions/config'                      1 500 20

echo "P1 done -> $OUT" >&2
