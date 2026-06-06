import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { runTeamSettlement } from '../routes/internal.routes.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

// 每分钟检查一次，判断是否到达 PHT 结算时间
export function startSettlementCron(app: FastifyInstance): void {
  const interval = setInterval(() => void check(app), 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  app.log.info('[settlement-cron] started, checking every minute')
}

async function check(app: FastifyInstance) {
  try {
    const db = app.mysql
    const [[cfg]] = await db.query<RowDataPacket[]>(
      `SELECT settlement_day, settlement_hour, last_auto_settlement
       FROM bg_team_config WHERE id = 1 LIMIT 1`,
    )
    if (!cfg) return

    const now = new Date(Date.now() + PHT_OFFSET_MS) // PHT 本地时间（UTC+8）
    const day    = now.getUTCDate()
    const hour   = now.getUTCHours()
    const minute = now.getUTCMinutes()

    const targetDay  = Number(cfg.settlement_day ?? 1)
    const targetHour = Number(cfg.settlement_hour ?? 3)

    // 只在目标日 + 目标小时的第 0 分钟触发
    if (day !== targetDay || hour !== targetHour || minute !== 0) return

    // 结算上一个月（结算日已进入本月，要结的是刚过去的月份）
    const periodDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const period = `${periodDate.getUTCFullYear()}-${String(periodDate.getUTCMonth() + 1).padStart(2, '0')}`

    if (cfg.last_auto_settlement === period) return

    app.log.info({ period }, '[settlement-cron] triggering auto settlement')

    // 先标记，防止并发重入
    await db.execute(
      `UPDATE bg_team_config SET last_auto_settlement = ? WHERE id = 1`,
      [period],
    )

    await runTeamSettlement(app, period)
    app.log.info({ period }, '[settlement-cron] auto settlement done')
  } catch (err) {
    app.log.error({ err }, '[settlement-cron] check failed')
  }
}
