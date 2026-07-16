// P3 全页面混合真实流量 —— 按用户行为权重随机"打开页面"(整页 batch)，找系统级拐点。
//   阶梯: k6 run -e PROFILE=small mixed-full.js   定并发: k6 run -e VUS=10 -e DUR=60s mixed-full.js
// 权重：startup30 home15 games15 wallet-history10 bonuses8 tasks7 vip5 team4 rebate3 bets3
import http from 'k6/http'
import { check } from 'k6'
import { BASE, HOSTS, stages } from './lib.js'
import { PAGES } from './pages.js'

const WEIGHTS = [
  ['startup', 0.30], ['home', 0.15], ['games', 0.15], ['wallet-history', 0.10],
  ['bonuses', 0.08], ['tasks', 0.07], ['vip', 0.05], ['team', 0.04], ['rebate', 0.03], ['bets', 0.03],
]

const VUS = Number(__ENV.VUS || 0)
export const options = {
  scenarios: VUS
    ? { mix: { executor: 'constant-vus', vus: VUS, duration: __ENV.DUR || '60s' } }
    : { mix: { executor: 'ramping-vus', startVUs: 0, stages } },
  hosts: HOSTS,
}

function pickPage() {
  let r = Math.random()
  for (const [name, w] of WEIGHTS) { if ((r -= w) < 0) return name }
  return 'home'
}

export default function () {
  const page = pickPage()
  const [paths, UMIN, UMAX] = PAGES[page]
  const i = UMIN + ((__VU - 1) % (UMAX - UMIN + 1))
  const params = { headers: { Authorization: `Bearer LTK-${i}`, 'X-Device-Id': `lt-LT-${i}`, 'Accept-Encoding': 'gzip' }, tags: { page } }
  const reqs = paths.map(p => ['GET', `${BASE}/api/v1${p}`, null, params])
  for (const r of http.batch(reqs)) check(r, { '2xx': (x) => x.status >= 200 && x.status < 300 })
}
