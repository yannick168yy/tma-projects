import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { runDailySettlement, type TeamMarket } from '../routes/internal.routes.js'
import { forEachTenant } from '../lib/tenant-jobs.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000
const ID_OFFSET_MS = 7 * 60 * 60 * 1000

// 每分钟检查，到达 settlement_hour 时结算前一天（PHT）
export function startSettlementCron(app: FastifyInstance): void {
  const interval = setInterval(() => void forEachTenant(app, 'settlement', () => check(app)), 60 * 1000)
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

    const settlementHour = Number(cfg.settlement_hour ?? 3)
    for (const item of [
      { market: 'PH' as TeamMarket, offsetMs: PHT_OFFSET_MS },
      { market: 'ID' as TeamMarket, offsetMs: ID_OFFSET_MS },
    ]) {
      const now = new Date(Date.now() + item.offsetMs)
      if (now.getUTCHours() !== settlementHour || now.getUTCMinutes() !== 0) continue
      const date = new Date(Date.now() + item.offsetMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const [[state]] = await db.query<RowDataPacket[]>(
        `SELECT last_auto_settlement FROM bg_team_settlement_state WHERE market = ? LIMIT 1`,
        [item.market],
      )
      if (state?.last_auto_settlement === date) continue
      await db.execute(
        `INSERT INTO bg_team_settlement_state (market, last_auto_settlement) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE last_auto_settlement = VALUES(last_auto_settlement)`,
        [item.market, date],
      )
      app.log.info({ date, market: item.market }, '[settlement-cron] triggering daily settlement (force=true)')
      await runDailySettlement(app, date, true, item.market)
      app.log.info({ date, market: item.market }, '[settlement-cron] done')
    }
  } catch (err) {
    app.log.error({ err }, '[settlement-cron] check failed')
  }
}
