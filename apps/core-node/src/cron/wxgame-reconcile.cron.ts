import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { reconcileWxgame } from '../services/wxgame-reconcile.service.js'
import { runForProviderTenants } from '../lib/tenant-jobs.js'

// 30 分钟一轮，配合服务里 30 分钟的游标回退，等于每条记录至少被比对两次。
// 更频繁没意义：上游注单状态从 BET 变 SETTLED 本身有延迟，扫太勤只是反复看到同一批未结算局。
const INTERVAL_MS = 30 * 60 * 1000

export function startWxgameReconcileCron(app: FastifyInstance): void {
  // 没配 AccessKey 就不启动。runForProviderTenants 会无条件把自营站算进目标，
  // 所以哪怕没有任何租户接入 WXGame，这个 cron 照样会跑 —— 凭据为空时它会带着
  // 空 key 去调 WXGAME_BASE_URL 的默认值（对方的**测试环境**），每轮失败一次、
  // 刷一条 error。生产不该有这种无谓的外部请求。
  if (!env.WXGAME_ACCESS_KEY_ID) {
    app.log.info('[wxgame-recon] 未配置 WXGAME_ACCESS_KEY_ID，不启动')
    return
  }
  const run = () => void runForProviderTenants(app, 'wxgame-recon', 'wxgame', () => reconcileWxgame(app))
  const interval = setInterval(run, INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[wxgame-recon] started, checking every 30 minutes')
}
