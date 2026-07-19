import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { runDailySettlement } from '../routes/internal.routes.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

// 每分钟检查，到达 settlement_hour 时结算前一天（PHT）
export function startSettlementCron(app: FastifyInstance): void {
  const interval = setInterval(() => void check(app), 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  app.log.info('[settlement-cron] started, checking every minute')
}

async function check(app: FastifyInstance) {
  try {
    const db = app.mysql
    const [[cfg]] = await db.query<RowDataPacket[]>(
      `SELECT settlement_hour, last_auto_settlement FROM bg_team_config WHERE id = 1 LIMIT 1`,
    )
    if (!cfg) return

    const now    = new Date(Date.now() + PHT_OFFSET_MS)
    const hour   = now.getUTCHours()
    const minute = now.getUTCMinutes()

    if (hour !== Number(cfg.settlement_hour ?? 3) || minute !== 0) return

    // 结算 PHT 前一天
    const prev = new Date(Date.now() + PHT_OFFSET_MS - 24 * 60 * 60 * 1000)
    const date = prev.toISOString().slice(0, 10)

    if (cfg.last_auto_settlement === date) return

    // 先标记防并发重入
    await db.execute(
      `UPDATE bg_team_config SET last_auto_settlement = ? WHERE id = 1`,
      [date],
    )

    app.log.info({ date }, '[settlement-cron] triggering daily settlement (force=true)')
    await runDailySettlement(app, date, true)
    app.log.info({ date }, '[settlement-cron] done')
  } catch (err) {
    app.log.error({ err }, '[settlement-cron] check failed')
  }
}
