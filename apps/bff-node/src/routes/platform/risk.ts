import Router from '@koa/router'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { writeAudit } from '../../services/platform-audit.service.js'
import { ok, fail } from '../../utils/response.js'
import {
  addHashToBlacklist, addToBlacklist, crossTenantIdentities, federationEnabled,
  IDENTITY_TYPES, listBlacklist, removeFromBlacklist, runIdentityCollection,
  type FederationSeverity, type IdentityType,
} from '../../services/risk-federation.service.js'

const SEVERITIES: FederationSeverity[] = ['watch', 'escalate', 'deny']

/**
 * 跨租户风控联防（P3-6）。
 *
 * 名单里只有摘要，没有明文 —— 加名单时明文只在这一次请求体里出现，落库即哈希。
 * 因此「查一下某个手机号在不在名单里」这种需求要走「加一次同值」来判断（会返回是否已存在），
 * 不提供反查接口：能反查就等于平台留了一份可导出的客户玩家名册。
 */
export function createPlatformRiskRouter(): Router {
  const router = new Router({ prefix: '/platform/risk' })
  const read = platformAuthMiddleware()
  // 名单是会直接拦住玩家的东西，写权限只给超管与运营，不给财务
  const write = platformAuthMiddleware('platform_super', 'platform_ops')

  router.get('/status', read, async (ctx) => {
    ok(ctx, { enabled: federationEnabled(), idTypes: IDENTITY_TYPES, severities: SEVERITIES })
  })

  router.get('/blacklist', read, async (ctx) => {
    ok(ctx, { enabled: federationEnabled(), items: await listBlacklist() })
  })

  router.post('/blacklist', write, async (ctx) => {
    if (!federationEnabled()) return fail(ctx, 400, '未配置 RISK_FEDERATION_PEPPER，联防未启用')
    const b = ctx.request.body as Record<string, unknown>
    const idType = String(b.idType ?? '') as IdentityType
    if (!IDENTITY_TYPES.includes(idType)) return fail(ctx, 400, '未知的身份类型')
    const severity = SEVERITIES.includes(b.severity as FederationSeverity)
      ? b.severity as FederationSeverity : 'escalate'
    const reason = String(b.reason ?? '').trim()
    if (!reason) return fail(ctx, 400, '必须填原因：名单会直接拦玩家，事后要能解释为什么')

    // 摘要直接入名单（从跨租户身份榜点过来的场景，那边没有明文）
    if (b.valueHash) {
      await addHashToBlacklist(ctx.state.env, idType, String(b.valueHash),
        b.valueHint ? String(b.valueHint) : null, severity, reason,
        ctx.state.platformAdmin?.adminId ?? null)
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'risk.blacklist.add', null,
        { idType, severity, reason, fromHash: true })
      return ok(ctx, { items: await listBlacklist() })
    }

    const rawValue = String(b.rawValue ?? '').trim()
    if (!rawValue) return fail(ctx, 400, '请填要拉黑的值')
    try {
      await addToBlacklist(ctx.state.env, {
        idType, rawValue, severity, reason,
        sourceTenantId: b.sourceTenantId ? Number(b.sourceTenantId) : null,
        expiresAt: b.expiresAt ? String(b.expiresAt) : null,
      }, ctx.state.platformAdmin?.adminId ?? null)
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '加入失败')
    }
    // 审计里不记明文，只记类型与原因：审计表本身也是会被导出的
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'risk.blacklist.add', null,
      { idType, severity, reason })
    ok(ctx, { items: await listBlacklist() })
  })

  router.delete('/blacklist/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const done = await removeFromBlacklist(ctx.state.env, id)
    if (!done) return fail(ctx, 404, '该条不存在')
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'risk.blacklist.remove', null, { id })
    ok(ctx, { items: await listBlacklist() })
  })

  // 撞库识别：同一身份出现在 N 家以上
  router.get('/cross-tenant', read, async (ctx) => {
    const min = Math.max(2, Number(ctx.query.minTenants ?? 2))
    const idType = IDENTITY_TYPES.includes(ctx.query.idType as IdentityType)
      ? ctx.query.idType as IdentityType : undefined
    ok(ctx, { enabled: federationEnabled(), rows: await crossTenantIdentities(min, idType) })
  })

  router.post('/collect', write, async (ctx) => {
    await runIdentityCollection(ctx.state.env)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'risk.identity.collect', null, {})
    ok(ctx, { ok: true })
  })

  return router
}
