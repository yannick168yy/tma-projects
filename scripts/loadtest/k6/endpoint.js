// P1 单接口拐点探测 —— 定并发压一个接口，逐档 VUS 找 p95 劣化点。
//   k6 run -e EP='/api/v1/bets?limit=20' -e VUS=10 -e DUR=45s -e UMIN=1 -e UMAX=50 endpoint.js
// UMIN/UMAX 绑定用户段：重历史组 1-50(bets/ledger/存提)、团队组 51-80(team/*)、其余任意
import http from 'k6/http'
import { check } from 'k6'
import { BASE } from './lib.js'

const EP = __ENV.EP || '/api/v1/wallet/balances'
const VUS = Number(__ENV.VUS || 10)
const DUR = __ENV.DUR || '45s'
const UMIN = Number(__ENV.UMIN || 1)
const UMAX = Number(__ENV.UMAX || 500)

export const options = {
  scenarios: { ep: { executor: 'constant-vus', vus: VUS, duration: DUR } },
}

export default function () {
  const i = UMIN + ((__VU - 1) % (UMAX - UMIN + 1))
  const res = http.get(`${BASE}${EP}`, {
    headers: { Authorization: `Bearer LTK-${i}`, 'X-Device-Id': `lt-LT-${i}` },
  })
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 })
}
