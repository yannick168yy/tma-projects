import Router from '@koa/router'
import {
  getBiOverview, getBiTrends, getBiProviders, getBiGames, listBiAlerts, setBiAlertStatus,
  getBiFunnel, getBiRetention, getBiRfm, getBiLtv, getBiTopWinners, getBiAcquisition,
  getBiForecast, listBiTargets, upsertBiTarget, getBiTargetProgress, getBiChurnRisk, grantRedepOffer,
  BI_TARGET_METRICS, type BiTargetMetric,
} from '../../services/bi.service.js'
import { getBiChannels } from '../../services/bi.service.js'
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

router.get('/overview', async (ctx) => {
  const data = await getBiOverview(ctx.state.env, ctx.state.redis)
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
  ok(ctx, await getBiFunnel(ctx.state.env, { days, source }))
})

router.get('/retention', async (ctx) => {
  const weeks = Math.min(Math.max(Number(ctx.query.weeks) || 8, 2), 26)
  ok(ctx, await getBiRetention(ctx.state.env, weeks))
})

router.get('/rfm', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 90, 30), 365)
  ok(ctx, await getBiRfm(ctx.state.env, ctx.state.redis, days))
})

router.get('/ltv', async (ctx) => {
  const weeks = Math.min(Math.max(Number(ctx.query.weeks) || 12, 2), 26)
  ok(ctx, await getBiLtv(ctx.state.env, ctx.state.redis, weeks))
})

router.get('/top-winners', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 1), 365)
  ok(ctx, await getBiTopWinners(ctx.state.env, ctx.state.redis, days))
})

router.get('/acquisition', async (ctx) => {
  const days = Math.min(Math.max(Number(ctx.query.days) || 30, 7), 365)
  ok(ctx, await getBiAcquisition(ctx.state.env, ctx.state.redis, days))
})

router.get('/forecast', async (ctx) => {
  const metric = String(ctx.query.metric ?? 'ggr')
  if (!['ggr', 'deposit'].includes(metric)) { fail(ctx, 400, 'invalid metric'); return }
  ok(ctx, await getBiForecast(ctx.state.env, ctx.state.redis, metric as 'ggr' | 'deposit'))
})

router.get('/targets', async (ctx) => {
  const period = String(ctx.query.period ?? '')
  if (!/^\d{4}-\d{2}$/.test(period)) { fail(ctx, 400, 'invalid period'); return }
  ok(ctx, await listBiTargets(ctx.state.env, period))
})

router.put('/targets', async (ctx) => {
  if (!['super_admin', 'finance'].includes(ctx.state.adminRole ?? '')) {
    fail(ctx, 403, '仅 super_admin / finance 可设置目标', 403); return
  }
  const body = ctx.request.body as { period?: string; metric?: string; targetValue?: number }
  const { period, metric, targetValue } = body ?? {}
  if (!period || !/^\d{4}-\d{2}$/.test(period) || !metric
      || !BI_TARGET_METRICS.includes(metric as BiTargetMetric)
      || typeof targetValue !== 'number' || targetValue < 0) {
    fail(ctx, 400, 'invalid params'); return
  }
  await upsertBiTarget(ctx.state.env, period, metric as BiTargetMetric, targetValue, ctx.state.adminUsername!)
  ok(ctx, { ok: true })
})

router.get('/target-progress', async (ctx) => {
  ok(ctx, await getBiTargetProgress(ctx.state.env, ctx.state.redis))
})

router.get('/churn-risk', async (ctx) => {
  ok(ctx, await getBiChurnRisk(ctx.state.env, ctx.state.redis))
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
  ok(ctx, await getBiChannels(ctx.state.env, days))
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
