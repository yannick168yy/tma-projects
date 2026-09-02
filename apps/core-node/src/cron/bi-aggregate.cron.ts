import type { FastifyInstance } from 'fastify'
import { aggregateBiDay, detectBiAlerts, manilaToday } from '../services/bi-aggregate.service.js'
import { forEachTenant } from '../lib/tenant-jobs.js'

const PHT_OFFSET_MS = 8 * 3600 * 1000
const DAILY_AGGREGATE_HOUR_PHT = 4

// BI 聚合：每 10 分钟重算当日（马尼拉），每日 04:00-04:09 首个 tick 补算前两天
// （前两天重算是为了捕获跨日晚结算的注单派彩）
export function startBiAggregateCron(app: FastifyInstance): void {
  // 按租户各记一份：用单个变量的话，一个租户跑完日聚合会把其他租户当天全挡掉
  const lastDailyRun = new Map<string, string>()
  const tick = (tenantCode: string) => async () => {
    try {
      const today = manilaToday()
      await aggregateBiDay(app, today)

      const manilaHour = new Date(Date.now() + PHT_OFFSET_MS).getUTCHours()
      if (manilaHour === DAILY_AGGREGATE_HOUR_PHT && lastDailyRun.get(tenantCode) !== today) {
        lastDailyRun.set(tenantCode, today)
        await aggregateBiDay(app, manilaToday(-1))
        await aggregateBiDay(app, manilaToday(-2))
        await detectBiAlerts(app, manilaToday(-1))
        app.log.info({ date: manilaToday(-1) }, '[bi-cron] daily aggregation done')
      }
    } catch (err) {
      app.log.error({ err }, '[bi-cron] aggregation failed')
    }
  }
  const runAll = () => void forEachTenant(app, 'bi-aggregate', (tenant) => tick(tenant.code)())
  const interval = setInterval(runAll, 10 * 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  setTimeout(runAll, 15 * 1000) // 启动后先跑一次，等 DNS/连接就绪
  app.log.info('[bi-cron] started, ticking every 10 minutes (daily aggregation at PHT 04:00)')
}
