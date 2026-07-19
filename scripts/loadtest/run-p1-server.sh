#!/usr/bin/env bash
# P1 单接口拐点批跑 · 服务器本机版 —— k6 在被测机上跑(LOCAL=1 钉域名到127.0.0.1)，
# 走本地 nginx 完整链路(TLS+gzip)但绕开公网带宽墙(测试机仅~2.5Mbps,外部发压量不到服务器真实容量)。
# 注意探针效应：k6 与被测服务共享 2 核，高档位 CPU 有挤占，数字略保守。
# 用法(服务器上): nohup bash run-p1-server.sh > p1-server.log 2>&1 &   结果: p1-server-results.csv
set -u
cd "$(dirname "$0")"
OUT=${OUT:-p1-server-results.csv}
DUR=${DUR:-45s}
K6DIR=${K6DIR:-/root/loadtest-k6}
HOST=${HOST:-www.188facai.com}          # 生产验收: HOST=www.betogo.games
MEM_ABORT_MB=${MEM_ABORT_MB:-150}       # 内存熔断阈值(2G 测试机 150；16G 生产建议 2000)
[[ -f "$OUT" ]] || echo "ep,umin,umax,vus,rps,med_ms,p95_ms,p99_ms,err_rate" > "$OUT"

run() { # run <ep> <umin> <umax> <vus...>
  local ep=$1 umin=$2 umax=$3; shift 3
  for vus in "$@"; do
    k6 run -q -e LOCAL=1 -e HOST="$HOST" -e EP="$ep" -e UMIN="$umin" -e UMAX="$umax" -e VUS="$vus" -e DUR="$DUR" \
      --summary-export /tmp/k6sum.json --summary-trend-stats "med,p(95),p(99)" "$K6DIR/endpoint.js" >/dev/null 2>&1
    EP_="$ep" A_="$umin" B_="$umax" V_="$vus" python3 - >> "$OUT" <<'PY'
import json, os
m = json.load(open('/tmp/k6sum.json'))['metrics']
d = m['http_req_duration']; e = os.environ
print(','.join([e['EP_'], e['A_'], e['B_'], e['V_'], f"{m['http_reqs']['rate']:.1f}",
  str(round(d['med'])), str(round(d['p(95)'])), str(round(d['p(99)'])), f"{m['http_req_failed']['value']:.4f}"]))
PY
    tail -1 "$OUT" >&2
    # 保护被测机：内存吃紧立即中止
    avail=$(free -m | awk '/Mem:/{print $7}')
    if [[ "$avail" -lt "$MEM_ABORT_MB" ]]; then echo "ABORT: available mem ${avail}MB < ${MEM_ABORT_MB}MB" >&2; exit 1; fi
    sleep 10
  done
}

# VUS 阶梯可按机器规格覆盖(2核测试机默认；4核16G 生产建议 VUS_HEAVY="5 10 20 40 80" VUS_LIGHT="10 40 80")
VUS_HEAVY=${VUS_HEAVY:-"5 10 20 40"}
VUS_LIGHT=${VUS_LIGHT:-"10 40"}
VUS_CFG=${VUS_CFG:-"20"}

# 优先级①：JOIN/聚合重查询
run '/api/v1/bets?limit=20'                          1 50 $VUS_HEAVY
run '/api/v1/promotions/team/tree'                  51 80 $VUS_HEAVY
run '/api/v1/promotions/team/downlines?level=1&page=1' 51 80 $VUS_HEAVY
run '/api/v1/rebate/progress'                        1 50 $VUS_HEAVY
run '/api/v1/ledger?limit=20'                        1 50 $VUS_HEAVY

# 优先级②：高频单表/Redis
run '/api/v1/wallet/balances'                        1 500 $VUS_LIGHT
run '/api/v1/user/me'                                1 500 $VUS_LIGHT
run '/api/v1/slots/games?limit=30&offset=0'          1 500 $VUS_LIGHT
run '/api/v1/tasks'                                  1 50 $VUS_LIGHT
run '/api/v1/vip/progress'                           1 50 $VUS_LIGHT
run '/api/v1/promotions/checkin/status'              1 500 $VUS_LIGHT
run '/api/v1/deposits'                               1 50 $VUS_LIGHT
run '/api/v1/withdrawals'                            1 50 $VUS_LIGHT

# 优先级③：低频配置类
run '/api/v1/home/content'                           1 500 $VUS_CFG
run '/api/v1/slots/homepage'                         1 500 $VUS_CFG
run '/api/v1/vip/levels'                             1 500 $VUS_CFG
run '/api/v1/rebate/config'                          1 500 $VUS_CFG
run '/api/v1/promotions/config'                      1 500 $VUS_CFG

echo "P1-server done -> $OUT" >&2
