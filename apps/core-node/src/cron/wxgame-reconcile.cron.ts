import type { FastifyInstance } from 'fastify'
import { reconcileWxgame } from '../services/wxgame-reconcile.service.js'
import { runForProviderTenants } from '../lib/tenant-jobs.js'

// 30 分钟一轮，配合服务里 30 分钟的游标回退，等于每条记录至少被比对两次。
// 更频繁没意义：上游注单状态从 BET 变 SETTLED 本身有延迟，扫太勤只是反复看到同一批未结算局。
const INTERVAL_MS = 30 * 60 * 1000

export function startWxgameReconcileCron(app: FastifyInstance): void {
  const run = () => void runForProviderTenants(app, 'wxgame-recon', 'wxgame', () => reconcileWxgame(app))
  const interval = setInterval(run, INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[wxgame-recon] started, checking every 30 minutes')
}
