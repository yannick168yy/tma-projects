// 精细拐点探测 —— 定并发(constant-vus)跑混合真实流量，逐档看 p95 何时破 800ms
//   k6 run -e VUS=10 -e DUR=60s -e POOL=200 knee.js
// 逐档 VUS ∈ {5,10,15,20,25,30} 各跑一遍，记录每档 RPS / p95 / 错误率
import http from 'k6/http'
import { check } from 'k6'
import { BASE, authParams } from './lib.js'

const VUS = Number(__ENV.VUS || 10)
const DUR = __ENV.DUR || '60s'

export const options = {
  scenarios: { knee: { executor: 'constant-vus', vus: VUS, duration: DUR } },
  // 不设 threshold：拐点靠读 p95 判断，避免 exit code 噪音
}

// 与 c-mixed 同配比：余额40% / 游戏25% / 用户15% / 注单10% / 任务10%
function weighted() {
  const r = Math.random()
  if (r < 0.4) return '/api/v1/wallet/balances'
  if (r < 0.65) return '/api/v1/slots/games?limit=30'
  if (r < 0.8) return '/api/v1/user/me'
  if (r < 0.9) return '/api/v1/bets?limit=20'
  return '/api/v1/tasks'
}

export default function () {
  const res = http.get(`${BASE}${weighted()}`, authParams())
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 })
}
