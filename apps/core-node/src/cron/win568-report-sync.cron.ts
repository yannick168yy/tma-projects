import type { FastifyInstance } from 'fastify'
import { Win568Client } from '../clients/win568.client.js'
import { saveReportBets } from '../routes/win568-operation.routes.js'
import { getAdminSetting, setAdminSetting, getWin568OperationCompanyKey } from '../services/win568-key-settings.service.js'

// 568Win 官方建议 10 分钟轮询一次 modify-date 增量
const SYNC_INTERVAL_MS = 10 * 60 * 1000
// 窗口向前重叠 5 分钟防边界丢单，落库 UPSERT 幂等
const OVERLAP_MS = 5 * 60 * 1000
// 游标落后过多时（宕机恢复），单次最多追 24 小时，下轮继续
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
// 首次运行无游标：从 24 小时前开始（上游留存 60 天）
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000

const PORTFOLIOS = ['SeamlessGame', 'ThirdPartySportsBook', '568WinSportsbook']

const cursorKey = (portfolio: string) => `win568_report_sync_cursor:${portfolio}`
/** 聚合水位 = 全 portfolio 游标最小值，bff 审核对账规则读它判断上游数据新鲜度 */
export const WATERMARK_KEY = 'win568_report_sync_watermark'

/** 568Win 报表日期格式：GMT-4、无毫秒、无 Z 后缀 */
export function toWin568ReportDate(date: Date): string {
  return new Date(date.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 19)
}

/** 全 portfolio 中最旧的同步水位（UTC ms），审核对账用它判断上游数据新鲜度 */
export async function getReportSyncWatermark(app: FastifyInstance): Promise<number | null> {
  let min: number | null = null
  for (const p of PORTFOLIOS) {
    const raw = await getAdminSetting(app, cursorKey(p))
    const ts = raw ? Date.parse(raw) : NaN
    if (!Number.isFinite(ts)) return null
    if (min === null || ts < min) min = ts
  }
  return min
}

export function startWin568ReportSyncCron(app: FastifyInstance): void {
  const run = () => void syncWin568ReportBets(app)
  const interval = setInterval(run, SYNC_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[568win-report-sync] started, polling every 10 minutes')
}

async function syncWin568ReportBets(app: FastifyInstance): Promise<void> {
  try {
    const companyKey = await getWin568OperationCompanyKey(app)
    if (!companyKey) return
    const client = new Win568Client(companyKey)
    const now = Date.now()

    for (const portfolio of PORTFOLIOS) {
      try {
        const raw = await getAdminSetting(app, cursorKey(portfolio))
        const cursor = raw ? Date.parse(raw) : NaN
        const from = Number.isFinite(cursor) ? cursor - OVERLAP_MS : now - INITIAL_LOOKBACK_MS
        const to = Math.min(now, from + MAX_WINDOW_MS)

        const result = await client.getBetListByModifyDate({
          portfolio,
          startDate: toWin568ReportDate(new Date(from)),
          endDate: toWin568ReportDate(new Date(to)),
          isGetDownline: true,
        })
        if (result.error.id !== 0) {
          app.log.error({ portfolio, error: result.error }, '[568win-report-sync] fetch failed')
          continue
        }
        const saved = await saveReportBets(app, portfolio, result.result, result)
        await setAdminSetting(app, cursorKey(portfolio), new Date(to).toISOString())
        if (saved > 0) app.log.info({ portfolio, saved }, '[568win-report-sync] saved bets')
      } catch (err) {
        app.log.error({ err, portfolio }, '[568win-report-sync] portfolio sync failed')
      }
    }

    const watermark = await getReportSyncWatermark(app)
    if (watermark !== null) {
      await setAdminSetting(app, WATERMARK_KEY, new Date(watermark).toISOString())
    }
  } catch (err) {
    app.log.error({ err }, '[568win-report-sync] failed')
  }
}
