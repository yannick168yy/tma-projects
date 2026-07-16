// P2 页面级首屏场景 —— 一次迭代 = 该页首屏全部 GET 并发发出(http.batch)，模拟真实打开页面。
//   k6 run -e PAGE=home -e VUS=10 -e DUR=45s pages.js
// 判读：iteration_duration ≈ 单次"打开页面"耗时；iterations/s ≈ 每秒可支撑的页面打开数
import http from 'k6/http'
import { check } from 'k6'
import { BASE } from './lib.js'

// 每页 = [首屏请求列表, 用户段min, 用户段max]
export const PAGES = {
  startup: [['/auth/session', '/user/me', '/promotions/config', '/promotions/new-player-summary', '/wallet/balances'], 1, 500],
  home: [['/home/content', '/slots/homepage', '/wallet/balances', '/slots/betting-activity'], 1, 500],
  bonuses: [['/promotions', '/promotions/app-download', '/promotions/red-packets', '/promotions/checkin/status', '/promotions/config'], 1, 500],
  team: [['/promotions/team/status', '/promotions/team/tree', '/promotions/team/downlines?level=1&page=1', '/promotions/team/commissions', '/promotions/team/wallet'], 51, 80],
  games: [['/slots/games?limit=30&offset=0', '/slots/providers', '/slots/history?limit=10'], 1, 500],
  menu: [['/user/me', '/wallet/balances', '/vip/progress', '/kyc/status'], 1, 500],
  tasks: [['/tasks', '/vip/progress', '/rebate/progress'], 1, 50],
  rebate: [['/rebate/config', '/rebate/progress', '/rebate/summary'], 1, 50],
  vip: [['/vip/progress', '/vip/levels', '/vip/rewards', '/vip/loss-rebate-status', '/rebate/progress'], 1, 50],
  'wallet-history': [['/deposits', '/withdrawals', '/ledger?limit=20', '/turnover'], 1, 50],
  bets: [['/bets?limit=20'], 1, 50],
}

const PAGE = __ENV.PAGE || 'home'
const [paths, UMIN, UMAX] = PAGES[PAGE]
const VUS = Number(__ENV.VUS || 10)
const DUR = __ENV.DUR || '45s'

export const options = {
  scenarios: { page: { executor: 'constant-vus', vus: VUS, duration: DUR } },
}

export default function () {
  const i = UMIN + ((__VU - 1) % (UMAX - UMIN + 1))
  const params = { headers: { Authorization: `Bearer LTK-${i}`, 'X-Device-Id': `lt-LT-${i}` } }
  const reqs = paths.map(p => ['GET', `${BASE}/api/v1${p}`, null, params])
  const responses = http.batch(reqs)
  for (const r of responses) check(r, { '2xx': (x) => x.status >= 200 && x.status < 300 })
}
