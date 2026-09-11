import type { FastifyInstance } from 'fastify'
import { syncWxgameGames } from '../services/wxgame-game.service.js'
import { runForProviderTenants } from '../lib/tenant-jobs.js'

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000

export function startWxgameGameSyncCron(app: FastifyInstance): void {
  // 与 568win 同理：AccessKey 全平台共用，按租户跑会重复拉同一份游戏列表
  const run = () => void runForProviderTenants(app, 'wxgame-game-sync', 'wxgame', () => syncWxgameGames(app))
  const interval = setInterval(run, SYNC_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[wxgame-game-sync] started, checking every 4 hours')
}
