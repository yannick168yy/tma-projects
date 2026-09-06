import Router from '@koa/router'
import { requireRole } from '../../middleware/require-role.js'
import { ok, fail } from '../../utils/response.js'
import {
  listBuildRequests, listSelfApps, listSelfChannels, requestBuild,
  saveSelfApp, saveSelfChannelCredential,
} from '../../services/self-service.service.js'
import type { TenantAppBuild } from '../../services/tenant-app.service.js'

/**
 * 租户自助（P3-5）。
 *
 * 🔴 一律以 currentTenant() 为准，接口上没有 tenantId 参数 ——
 * 带 tenantId 的接口只要漏一次校验就是跨租户越权（P1-7 踩过）。
 *
 * 自助边界：能改自己的钱和自己的包（自带通道凭据、出包参数），不能改平台代收通道
 * （那是平台的商户号）、不能改费率（商务合同定的）、不能自己点出包（签名密钥不在服务器上）。
 */
const router = new Router({ prefix: '/self-service' })

// 通道凭据与出包参数都属于「动自己钱与自己 App」的动作，给超管与财务，不给客服
const guard = requireRole(['super_admin', 'finance'], '只有超管与财务可以做自助配置')

router.get('/channels', guard, async (ctx) => {
  ok(ctx, await listSelfChannels())
})

router.put('/channels/:code', guard, async (ctx) => {
  const b = ctx.request.body as { merchantNo?: unknown; credential?: unknown }
  try {
    await saveSelfChannelCredential(ctx.state.env, String(ctx.params.code), {
      merchantNo: String(b.merchantNo ?? '').trim(),
      credential: String(b.credential ?? '').trim(),
    }, ctx.state.adminUsername ?? null, ctx.ip)
    ok(ctx, await listSelfChannels())
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
  }
})

router.get('/app', guard, async (ctx) => {
  ok(ctx, { items: await listSelfApps(), requests: await listBuildRequests() })
})

router.put('/app/:market', guard, async (ctx) => {
  const b = ctx.request.body as Partial<TenantAppBuild>
  try {
    await saveSelfApp({
      ...(b as TenantAppBuild),
      appMarket: String(ctx.params.market),
    }, ctx.state.adminUsername ?? null, ctx.ip)
    ok(ctx, { items: await listSelfApps(), requests: await listBuildRequests() })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
  }
})

router.post('/app/:market/build', guard, async (ctx) => {
  const note = String((ctx.request.body as { note?: unknown }).note ?? '').trim()
  try {
    await requestBuild(String(ctx.params.market), note, ctx.state.adminUsername ?? null, ctx.ip)
    ok(ctx, { requests: await listBuildRequests() })
  } catch (e) {
    fail(ctx, 400, e instanceof Error ? e.message : '提交失败')
  }
})

export default router
