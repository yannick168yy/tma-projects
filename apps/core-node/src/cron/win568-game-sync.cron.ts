import type { FastifyInstance } from 'fastify'
import { Win568Client } from '../clients/win568.client.js'
import { saveWin568Games } from '../routes/win568-operation.routes.js'
import { getWin568OperationCompanyKey } from '../services/win568-key-settings.service.js'
import { probePendingGameIcons } from '../services/game-icon-probe.service.js'
import { runAsSelfOperated } from '../lib/tenant-jobs.js'

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000

export function startWin568GameSyncCron(app: FastifyInstance): void {
  // 平台级：聚合商 CompanyKey 全平台共用，按租户跑会重复拉同一份游戏列表
  const run = () => void runAsSelfOperated(app, 'win568-game-sync', () => syncWin568Games(app))
  const interval = setInterval(run, SYNC_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[568win-game-sync] started, checking every 4 hours')
}

async function syncWin568Games(app: FastifyInstance): Promise<void> {
  try {
    const companyKey = await getWin568OperationCompanyKey(app)
    if (!companyKey) return
    const result = await new Win568Client(companyKey).getGameList({ GpId: 1, IsGetAll: true })
    if (result.error.id !== 0) {
      app.log.error({ error: result.error }, '[568win-game-sync] get game list failed')
      return
    }
    const synced = await saveWin568Games(app, result)
    app.log.info({ synced }, '[568win-game-sync] done')
    await probePendingGameIcons(app)
  } catch (err) {
    app.log.error({ err }, '[568win-game-sync] failed')
  }
}
