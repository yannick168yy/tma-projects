// 场景 B —— MySQL 读：/slots/games 分页 + /bets 最重 JOIN 聚合
// 注：LT 用户无注单，/bets 返回空但查询照跑；要压真实 JOIN 成本需给部分用户灌注单历史（见 README）
import http from 'k6/http'
import { check } from 'k6'
import { BASE, authParams, stages, thresholds } from './lib.js'

export const options = {
  scenarios: { b: { executor: 'ramping-vus', startVUs: 0, stages } },
  thresholds,
}

export default function () {
  const games = http.get(`${BASE}/api/v1/slots/games?limit=30&offset=0`, authParams({ ep: 'games' }))
  check(games, { 'games 200': (r) => r.status === 200 })

  const bets = http.get(`${BASE}/api/v1/bets?limit=20&offset=0`, authParams({ ep: 'bets' }))
  check(bets, { 'bets 200': (r) => r.status === 200 })
}
