import Router from '@koa/router'
import {
  getBiOverview, getBiTrends, getBiProviders, getBiGames, listBiAlerts, setBiAlertStatus,
  getBiFunnel, getBiRetention, getBiRfm, getBiLtv, getBiTopWinners, getBiAcquisition,
  getBiForecast, listBiTargets, upsertBiTarget, getBiTargetProgress, getBiChurnRisk, grantRedepOffer,
  BI_TARGET_METRICS, type BiTargetMetric, type BiMarket,
} from '../../services/bi.service.js'
import { getBiChannels } from '../../services/bi.service.js'
import { getAdSourceReport, getAdSourceTrend, isValidChannel, getChannelQuality, listChannelCodes, generateChannelVerdict } from '../../services/marketing-bi.service.js'
import { sendBiReportNow, isBiReportEnabled, setBiReportEnabled } from '../../services/bi-report.service.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { ok, fail } from '../../utils/response.js'

function parseCommon(q: Record<string, unknown>): { days: number; currency: string } | null {
  const days = Math.min(Math.max(Number(q.days) || 30, 7), 365)
  const currency = q.currency ? String(q.currency) : 'ALL'
  if (!/^[A-Z]{2,10}$/.test(currency) && currency !== 'ALL') return null
  return { days, currency }
}

const router = new Router({ prefix: '/bi' })

function parseMarket(value: unknown): BiMarket | null {
  const market = String(value ?? 'ALL').toUpperCase()
  return market === 'ALL' || market === 'PH' || market === 'ID' ? market : null
}

router.get('/overview', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  const data = await getBiOverview(ctx.state.env, ctx.state.redis, market)
  ok(ctx, data)
})

router.get('/trends', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const granularity = ['day', 'week', 'month'].includes(String(ctx.query.granularity))
    ? (String(ctx.query.granularity) as 'day' | 'week' | 'month')
    : 'day'
  const currency = ctx.query.currency ? String(ctx.query.currency) : 'ALL'
  if (!/^[A-Z]{2,10}$/.test(currency) && currency !== 'ALL') {
    fail(ctx, 400, 'invalid currency')
    return
  }
  const data = await getBiTrends(ctx.state.env, ctx.state.redis, { days, granularity, currency })
  ok(ctx, data)
})

router.get('/providers', async (ctx) => {
  const p = parseCommon(ctx.query)
  if (!p) { fail(ctx, 400, 'invalid currency'); return }
  const data = await getBiProviders(ctx.state.env, ctx.state.redis, p)
  ok(ctx, data)
})

router.get('/games', async (ctx) => {
  const p = parseCommon(ctx.query)
  if (!p) { fail(ctx, 400, 'invalid currency'); return }
  const limit = Math.min(Math.max(Number(ctx.query.limit) || 100, 10), 500)
  const data = await getBiGames(ctx.state.env, ctx.state.redis, { ...p, limit })
  ok(ctx, data)
})

router.get('/alerts', async (ctx) => {
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  if (status && !['open', 'ack', 'closed'].includes(status)) { fail(ctx, 400, 'invalid status'); return }
  ok(ctx, await listBiAlerts(ctx.state.env, status))
})

router.get('/funnel', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const source = ctx.query.source ? String(ctx.query.source) : 'ALL'
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiFunnel(ctx.state.env, { days, source, market }))
})

router.get('/retention', async (ctx) => {
  const weeks = Math.min(Math.max(Number(ctx.query.weeks) || 8, 2), 26)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiRetention(ctx.state.env, weeks, market))
})

router.get('/rfm', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 90, 30), 365)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiRfm(ctx.state.env, ctx.state.redis, days, market))
})

router.get('/ltv', async (ctx) => {
  const weeks = Math.min(Math.max(Number(ctx.query.weeks) || 12, 2), 26)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiLtv(ctx.state.env, ctx.state.redis, weeks, market))
})

router.get('/top-winners', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 1), 365)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiTopWinners(ctx.state.env, ctx.state.redis, days, market))
})

router.get('/acquisition', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiAcquisition(ctx.state.env, ctx.state.redis, days, market))
})

router.get('/forecast', async (ctx) => {
  const metric = String(ctx.query.metric ?? 'ggr')
  if (!['ggr', 'deposit'].includes(metric)) { fail(ctx, 400, 'invalid metric'); return }
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiForecast(ctx.state.env, ctx.state.redis, metric as 'ggr' | 'deposit', market))
})

router.get('/targets', async (ctx) => {
  const period = String(ctx.query.period ?? '')
  if (!/^\d{4}-\d{2}$/.test(period)) { fail(ctx, 400, 'invalid period'); return }
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await listBiTargets(ctx.state.env, ctx.state.redis, period, market))
})

router.put('/targets', async (ctx) => {
  if (!['super_admin', 'finance'].includes(ctx.state.adminRole ?? '')) {
    fail(ctx, 403, '仅 super_admin / finance 可设置目标', 403); return
  }
  const body = ctx.request.body as { period?: string; metric?: string; targetValue?: number; market?: string }
  const { period, metric, targetValue } = body ?? {}
  const market = parseMarket(body.market)
  if (!period || !/^\d{4}-\d{2}$/.test(period) || !metric
      || !market
      || !BI_TARGET_METRICS.includes(metric as BiTargetMetric)
      || typeof targetValue !== 'number' || targetValue < 0) {
    fail(ctx, 400, 'invalid params'); return
  }
  await upsertBiTarget(ctx.state.env, ctx.state.redis, period, metric as BiTargetMetric, targetValue, ctx.state.adminUsername!, market)
  ok(ctx, { ok: true })
})

router.get('/target-progress', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiTargetProgress(ctx.state.env, ctx.state.redis, market))
})

router.get('/churn-risk', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiChurnRisk(ctx.state.env, ctx.state.redis, market))
})

router.post('/churn/redep-offer', async (ctx) => {
  const body = ctx.request.body as { userId?: string; currency?: string }
  const userId = String(body?.userId ?? '')
  const currency = String(body?.currency ?? 'PHP')
  if (!userId || !/^[A-Z]{2,10}$/.test(currency)) { fail(ctx, 400, 'invalid params'); return }
  const result = await grantRedepOffer(ctx.state.env, userId, currency)
  if (result.ok) {
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'bi.churn_redep_offer',
      targetType: 'user',
      targetId: userId,
      detail: { currency, bonusAmount: result.bonusAmount, minDeposit: result.minDeposit, endsAt: result.endsAt },
    })
  }
  ok(ctx, result)
})

router.get('/channels', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  ok(ctx, await getBiChannels(ctx.state.env, days, market))
})

// 买量投放渠道报表：马尼拉日范围，默认最近 7 天；金额口径固定=全币种折 USDT 合并
function parseAdSourceRange(q: Record<string, unknown>, market: BiMarket): { from: string; to: string } | null {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const offset = market === 'ID' ? 7 : 8
  const marketToday = new Date(Date.now() + offset * 3600 * 1000).toISOString().slice(0, 10)
  const to = q.to && dateRe.test(String(q.to)) ? String(q.to) : marketToday
  let from: string
  if (q.from && dateRe.test(String(q.from))) {
    from = String(q.from)
  } else {
    from = new Date(Date.parse(`${to}T00:00:00+08:00`) - 6 * 86400000 + 8 * 3600 * 1000).toISOString().slice(0, 10)
  }
  if (from > to) return null
  // 跨度上限 92 天，防全表大范围扫描
  if ((Date.parse(`${to}T00:00:00+08:00`) - Date.parse(`${from}T00:00:00+08:00`)) / 86400000 > 92) return null
  return { from, to }
}

router.get('/ad-sources', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  const r = parseAdSourceRange(ctx.query, market)
  if (!r) { fail(ctx, 400, 'invalid range/currency'); return }
  const channel = ctx.query.channel ? String(ctx.query.channel) : undefined
  if (channel && !isValidChannel(channel)) { fail(ctx, 400, 'invalid channel'); return }
  ok(ctx, await getAdSourceReport(ctx.state.env, ctx.state.redis, { ...r, channel, market }))
})

router.get('/ad-sources/trend', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  const r = parseAdSourceRange(ctx.query, market)
  if (!r) { fail(ctx, 400, 'invalid range/currency'); return }
  const channel = ctx.query.channel ? String(ctx.query.channel) : ''
  if (!isValidChannel(channel)) { fail(ctx, 400, 'channel required'); return }
  ok(ctx, await getAdSourceTrend(ctx.state.env, ctx.state.redis, { ...r, channel, market }))
})

// 渠道质量对比：留存/复充/人均充值/刷量预警(注册同期群口径)
router.get('/ad-sources/quality', async (ctx) => {
  const market = parseMarket(ctx.query.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  const r = parseAdSourceRange(ctx.query, market)
  if (!r) { fail(ctx, 400, 'invalid range/currency'); return }
  ok(ctx, await getChannelQuality(ctx.state.env, ctx.state.redis, { ...r, market }))
})

// 渠道短码下拉（配置过的 ∪ 实际出现过的）
router.get('/ad-sources/channels', async (ctx) => {
  ok(ctx, await listChannelCodes(ctx.state.env))
})

// 渠道对比点评：规则文本兜底 + Gemini 润色（操作人在页面主动点击才触发）
router.post('/ad-sources/verdict', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { from?: unknown; to?: unknown; channels?: unknown; spends?: unknown; market?: unknown }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const from = dateRe.test(String(body.from)) ? String(body.from) : ''
  const to = dateRe.test(String(body.to)) ? String(body.to) : ''
  if (!from || !to || from > to) { fail(ctx, 400, 'invalid range'); return }
  const channels = Array.isArray(body.channels) ? body.channels.map(String).filter(isValidChannel) : []
  const market = parseMarket(body.market)
  if (!market) { fail(ctx, 400, 'invalid market'); return }
  if (channels.length === 0 || channels.length > 8) { fail(ctx, 400, '请选择 1-8 个渠道'); return }
  const spends: Record<string, number> = {}
  if (body.spends && typeof body.spends === 'object') {
    for (const [k, v] of Object.entries(body.spends as Record<string, unknown>)) {
      const n = Number(v)
      if (isValidChannel(k) && Number.isFinite(n) && n >= 0) spends[k] = n
    }
  }
  ok(ctx, await generateChannelVerdict(ctx.state.env, ctx.state.redis, { from, to, channels, spends, market }))
})

router.post('/report/send', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可手动触发日报', 403); return }
  ok(ctx, await sendBiReportNow(ctx.state.env, ctx.state.redis))
})

router.get('/report/config', async (ctx) => {
  ok(ctx, { enabled: await isBiReportEnabled(ctx.state.env) })
})

router.put('/report/config', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可修改日报开关', 403); return }
  const enabled = Boolean((ctx.request.body as { enabled?: boolean })?.enabled)
  await setBiReportEnabled(ctx.state.env, enabled)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'bi.report_toggle',
    detail: { enabled },
  })
  ok(ctx, { enabled })
})

router.patch('/alerts/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  const status = String((ctx.request.body as { status?: string })?.status ?? '')
  if (!id || !['ack', 'closed'].includes(status)) { fail(ctx, 400, 'invalid params'); return }
  const updated = await setBiAlertStatus(ctx.state.env, id, status as 'ack' | 'closed')
  ok(ctx, { updated })
})

export default router
