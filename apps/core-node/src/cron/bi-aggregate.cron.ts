import type { FastifyInstance } from 'fastify'
import { aggregateBiDay, manilaToday } from '../services/bi-aggregate.service.js'

// BI 聚合：每 10 分钟重算当日（马尼拉），每日 01:00-01:09 首个 tick 补算前两天
// （前两天重算是为了捕获跨日晚结算的注单派彩）
export function startBiAggregateCron(app: FastifyInstance): void {
  let lastDailyRun = ''
  const tick = async () => {
    try {
      const today = manilaToday()
      await aggregateBiDay(app, today)

      const manilaHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours()
      if (manilaHour === 1 && lastDailyRun !== today) {
        lastDailyRun = today
        await aggregateBiDay(app, manilaToday(-1))
        await aggregateBiDay(app, manilaToday(-2))
        app.log.info({ date: manilaToday(-1) }, '[bi-cron] daily aggregation done')
      }
    } catch (err) {
      app.log.error({ err }, '[bi-cron] aggregation failed')
    }
  }
  const interval = setInterval(() => void tick(), 10 * 60 * 1000)
  app.addHook('onClose', async () => clearInterval(interval))
  setTimeout(() => void tick(), 15 * 1000) // 启动后先跑一次，等 DNS/连接就绪
  app.log.info('[bi-cron] started, ticking every 10 minutes')
}
