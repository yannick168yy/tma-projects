import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { syncWxgameGames } from '../services/wxgame-game.service.js'
import { runForProviderTenants } from '../lib/tenant-jobs.js'

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000

export function startWxgameGameSyncCron(app: FastifyInstance): void {
  // 没配 AccessKey 就不启动。runForProviderTenants 会无条件把自营站算进目标，
  // 所以哪怕没有任何租户接入 WXGame，这个 cron 照样会跑 —— 凭据为空时它会带着
  // 空 key 去调 WXGAME_BASE_URL 的默认值（对方的**测试环境**），每轮失败一次、
  // 刷一条 error。生产不该有这种无谓的外部请求。
  if (!env.WXGAME_ACCESS_KEY_ID) {
    app.log.info('[wxgame-game-sync] 未配置 WXGAME_ACCESS_KEY_ID，不启动')
    return
  }
  // 与 568win 同理：AccessKey 全平台共用，按租户跑会重复拉同一份游戏列表
  const run = () => void runForProviderTenants(app, 'wxgame-game-sync', 'wxgame', () => syncWxgameGames(app))
  const interval = setInterval(run, SYNC_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[wxgame-game-sync] started, checking every 4 hours')
}
