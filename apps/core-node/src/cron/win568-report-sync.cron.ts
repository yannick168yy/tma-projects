import type { FastifyInstance } from 'fastify'
import { Win568Client } from '../clients/win568.client.js'
import { saveReportBets } from '../routes/win568-operation.routes.js'
import { getAdminSetting, setAdminSetting, getWin568OperationCompanyKey, getWin568ServerId } from '../services/win568-key-settings.service.js'
import { runForProviderTenants } from '../lib/tenant-jobs.js'

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
const coverageKey = (portfolio: string) => `win568_report_sync_coverage:${portfolio}`
/** 聚合水位 = 全 portfolio 游标最小值，bff 审核对账规则读它判断上游数据新鲜度 */
export const WATERMARK_KEY = 'win568_report_sync_watermark'
/** 聚合覆盖起点 = 全 portfolio 覆盖起点最大值。早于它结算的注单不在报表里，对账不核对 */
export const COVERAGE_KEY = 'win568_report_sync_coverage_start'

/** 568Win 报表日期格式：GMT-4、无毫秒、无 Z 后缀 */
export function toWin568ReportDate(date: Date): string {
  return new Date(date.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 19)
}

/** 全 portfolio 中最旧的同步水位（UTC ms），审核对账用它判断上游数据新鲜度 */
export async function getReportSyncWatermark(app: FastifyInstance): Promise<number | null> {
  return aggregateSetting(app, cursorKey, (a, b) => Math.min(a, b))
}

/** 全 portfolio 中最晚的覆盖起点（UTC ms），取最大值保证对账范围内各 portfolio 报表都齐 */
async function getReportSyncCoverageStart(app: FastifyInstance): Promise<number | null> {
  return aggregateSetting(app, coverageKey, (a, b) => Math.max(a, b))
}

async function aggregateSetting(
  app: FastifyInstance,
  key: (portfolio: string) => string,
  pick: (a: number, b: number) => number,
): Promise<number | null> {
  let acc: number | null = null
  for (const p of PORTFOLIOS) {
    const raw = await getAdminSetting(app, key(p))
    const ts = raw ? Date.parse(raw) : NaN
    if (!Number.isFinite(ts)) return null
    acc = acc === null ? ts : pick(acc, ts)
  }
  return acc
}

export function startWin568ReportSyncCron(app: FastifyInstance): void {
  // 平台级：按租户跑会把同一份聚合商报表重复拉 N 遍
  const run = () => void runForProviderTenants(app, 'win568-report-sync', 'win568', () => syncWin568ReportBets(app))
  const interval = setInterval(run, SYNC_INTERVAL_MS)
  app.addHook('onClose', async () => clearInterval(interval))
  run()
  app.log.info('[568win-report-sync] started, polling every 10 minutes')
}

async function syncWin568ReportBets(app: FastifyInstance): Promise<void> {
  try {
    const companyKey = await getWin568OperationCompanyKey(app)
    if (!companyKey) return
    const client = new Win568Client(companyKey, await getWin568ServerId(app))
    const now = Date.now()

    for (const portfolio of PORTFOLIOS) {
      try {
        const raw = await getAdminSetting(app, cursorKey(portfolio))
        const cursor = raw ? Date.parse(raw) : NaN
        const from = Number.isFinite(cursor) ? cursor - OVERLAP_MS : now - INITIAL_LOOKBACK_MS
        const to = Math.min(now, from + MAX_WINDOW_MS)

        let saved = 0
        let page = 1
        let failed = false
        // 分页拉全窗口：v2 无分页版有条数硬截断会静默丢单
        for (;;) {
          const result = await client.getBetListByModifyDateWithPagination({
            portfolio,
            startDate: toWin568ReportDate(new Date(from)),
            endDate: toWin568ReportDate(new Date(to)),
            isGetDownline: true,
            page,
            rowCountPerPage: 1000,
          })
          if (result.error.id === 1007) break // 页码超界=已拉完
          if (result.error.id !== 0) {
            app.log.error({ portfolio, page, error: result.error }, '[568win-report-sync] fetch failed')
            failed = true
            break
          }
          saved += await saveReportBets(app, portfolio, result.result)
          const lastPage = Number(result.lastPage ?? 1)
          if (page >= lastPage) break
          page += 1
        }
        if (failed) continue
        await setAdminSetting(app, cursorKey(portfolio), new Date(to).toISOString())
        // 覆盖起点只写一次：该 portfolio 报表数据从 from 起才齐全（含已有游标但缺覆盖键的自愈场景）
        if (!(await getAdminSetting(app, coverageKey(portfolio)))) {
          await setAdminSetting(app, coverageKey(portfolio), new Date(from).toISOString())
        }
        if (saved > 0) app.log.info({ portfolio, saved }, '[568win-report-sync] saved bets')
      } catch (err) {
        app.log.error({ err, portfolio }, '[568win-report-sync] portfolio sync failed')
      }
    }

    const watermark = await getReportSyncWatermark(app)
    if (watermark !== null) {
      await setAdminSetting(app, WATERMARK_KEY, new Date(watermark).toISOString())
    }
    const coverage = await getReportSyncCoverageStart(app)
    if (coverage !== null) {
      await setAdminSetting(app, COVERAGE_KEY, new Date(coverage).toISOString())
    }
  } catch (err) {
    app.log.error({ err }, '[568win-report-sync] failed')
  }
}
