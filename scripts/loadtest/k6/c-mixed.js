// 场景 C —— 混合真实流量：按「读多写少」配比编排，逼近真实峰值找系统级拐点
// 权重（每个 VU 迭代随机命中一条）：余额40% / 游戏列表25% / 用户信息15% / 注单10% / 任务列表10%
import http from 'k6/http'
import { check } from 'k6'
import { BASE, authParams, stages, thresholds } from './lib.js'

export const options = {
  scenarios: { c: { executor: 'ramping-vus', startVUs: 0, stages } },
  thresholds,
}

function weighted() {
  const r = Math.random()
  if (r < 0.4) return ['balances', '/api/v1/wallet/balances']
  if (r < 0.65) return ['games', '/api/v1/slots/games?limit=30']
  if (r < 0.8) return ['me', '/api/v1/user/me']
  if (r < 0.9) return ['bets', '/api/v1/bets?limit=20']
  return ['tasks', '/api/v1/tasks']
}

export default function () {
  const [ep, path] = weighted()
  const res = http.get(`${BASE}${path}`, authParams({ ep }))
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 })
}
