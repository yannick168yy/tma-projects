// 场景 A —— /wallet/balances 纯 Redis 读，摸 Node 单进程吞吐天花板
import http from 'k6/http'
import { check } from 'k6'
import { BASE, authParams, stages, thresholds } from './lib.js'

export const options = {
  scenarios: { a: { executor: 'ramping-vus', startVUs: 0, stages } },
  thresholds,
}

export default function () {
  const res = http.get(`${BASE}/api/v1/wallet/balances`, authParams({ ep: 'balances' }))
  check(res, { '200': (r) => r.status === 200 })
}
