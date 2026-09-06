import Router from '@koa/router'
import { requireRole } from '../../middleware/require-role.js'
import { ok, fail } from '../../utils/response.js'
import {
  listBuildRequests, listSelfApps, listSelfChannels, requestBuild,
  saveSelfApp, saveSelfChannelCredential,
} from '../../services/self-service.service.js'
import type { TenantAppBuild } from '../../services/tenant-app.service.js'
import { currentTenant } from '../../lib/tenant-context.js'
import { writeAuditLog } from '../../services/admin-store.js'
import {
  API_SCOPES, createApiKey, isApiScope, listApiKeys, revokeApiKey, SCOPE_LABEL,
} from '../../services/open-api.service.js'

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

// ── 开放 API 密钥（P3-7）─────────────────────────────────────────────────────
// 客户自己开、自己吊销。完整 key 只在创建那一次返回 —— 能随时查看意味着
// 任何一个能进后台的人都能拿走全部 key。
router.get('/api-keys', guard, async (ctx) => {
  ok(ctx, {
    scopes: API_SCOPES.map((s) => ({ scope: s, label: SCOPE_LABEL[s] })),
    items: await listApiKeys(currentTenant().id),
  })
})

router.post('/api-keys', guard, async (ctx) => {
  const b = ctx.request.body as Record<string, unknown>
  const name = String(b.name ?? '').trim()
  if (!name) return fail(ctx, 400, '请填用途备注：三个月后没人记得这把 key 是给谁的')
  const scopes = (Array.isArray(b.scopes) ? b.scopes : []).filter(isApiScope)
  if (scopes.length === 0) return fail(ctx, 400, '至少选一个权限范围')
  const ratePerMin = Math.min(600, Math.max(10, Number(b.ratePerMin ?? 120)))
  const ipAllowlist = String(b.ipAllowlist ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  const tenant = currentTenant()
  const res = await createApiKey(tenant.id, {
    name, scopes, ratePerMin, ipAllowlist,
    expiresAt: b.expiresAt ? String(b.expiresAt) : null,
    createdBy: ctx.state.adminUsername ?? null,
  })
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'openapi.key.create',
    targetType: 'api_key',
    targetId: String(res.row.id),
    // 审计里只记前缀与权限，不记完整 key
    detail: { keyPrefix: res.row.keyPrefix, scopes, ratePerMin },
    ip: ctx.ip,
  })
  ok(ctx, { key: res.key, items: await listApiKeys(tenant.id) })
})

router.delete('/api-keys/:id', guard, async (ctx) => {
  const tenant = currentTenant()
  const id = Number(ctx.params.id)
  if (!(await revokeApiKey(tenant.id, id))) return fail(ctx, 404, '该密钥不存在')
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'openapi.key.revoke',
    targetType: 'api_key',
    targetId: String(id),
    detail: {},
    ip: ctx.ip,
  })
  ok(ctx, { items: await listApiKeys(tenant.id) })
})
