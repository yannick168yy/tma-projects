import Router from '@koa/router'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { writeAudit } from '../../services/platform-audit.service.js'
import { ok, fail } from '../../utils/response.js'
import {
  applyTemplate, deleteTemplate, exportFromTenant, listApplyHistory, listTemplates,
  previewApply, PROMO_SECTIONS, saveTemplate, SECTION_LABEL, setTemplateEnabled,
  type PromoSection,
} from '../../services/promo-template.service.js'

/**
 * 活动模板市场（P3-3）。平台侧维护模板并套用到租户。
 * 写权限给超管与运营 —— 活动参数是运营日常，不该只有超管能改；财务不参与。
 */
export function createPromoTemplateRouter(): Router {
  const router = new Router({ prefix: '/platform/promo-templates' })
  const read = platformAuthMiddleware()
  const write = platformAuthMiddleware('platform_super', 'platform_ops')

  router.get('/', read, async (ctx) => {
    ok(ctx, {
      sections: PROMO_SECTIONS.map((k) => ({ key: k, label: SECTION_LABEL[k] })),
      items: await listTemplates(),
      history: await listApplyHistory(),
    })
  })

  router.post('/', write, async (ctx) => {
    const b = ctx.request.body as Record<string, unknown>
    const code = String(b.code ?? '').trim()
    if (!/^[a-z0-9_]{2,32}$/.test(code)) return fail(ctx, 400, '模板代号只允许小写字母、数字与下划线')
    const name = String(b.name ?? '').trim()
    if (!name) return fail(ctx, 400, '模板名称必填')
    try {
      const id = await saveTemplate({
        code, name,
        description: b.description ? String(b.description) : null,
        market: b.market ? String(b.market) : null,
        config: (b.config ?? {}) as Record<string, never>,
      }, b.sourceTenantId ? Number(b.sourceTenantId) : null, ctx.state.platformAdmin?.adminId ?? null)
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'promo.template.save', null, { id, code })
      ok(ctx, { id, items: await listTemplates() })
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
    }
  })

  /** 从某个租户当前配置导出模板：调好一家，复制给后面的 */
  router.post('/export/:tenantId', write, async (ctx) => {
    const tenantId = Number(ctx.params.tenantId)
    const b = ctx.request.body as Record<string, unknown>
    const code = String(b.code ?? '').trim()
    if (!/^[a-z0-9_]{2,32}$/.test(code)) return fail(ctx, 400, '模板代号只允许小写字母、数字与下划线')
    const sections = (Array.isArray(b.sections) ? b.sections : [])
      .map(String).filter((s): s is PromoSection => (PROMO_SECTIONS as readonly string[]).includes(s))
    if (sections.length === 0) return fail(ctx, 400, '至少选一个活动区块')
    try {
      const id = await exportFromTenant(ctx.state.env, tenantId, {
        code, name: String(b.name ?? code),
        description: b.description ? String(b.description) : null,
        market: b.market ? String(b.market) : null,
        sections,
      }, ctx.state.platformAdmin?.adminId ?? null)
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'promo.template.export', tenantId,
        { id, code, sections })
      ok(ctx, { id, items: await listTemplates() })
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '导出失败')
    }
  })

  router.put('/:id/enabled', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const enabled = (ctx.request.body as { enabled?: unknown }).enabled !== false
    await setTemplateEnabled(id, enabled)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'promo.template.enabled', null, { id, enabled })
    ok(ctx, { items: await listTemplates() })
  })

  router.delete('/:id', write, async (ctx) => {
    const id = Number(ctx.params.id)
    if (!(await deleteTemplate(id))) return fail(ctx, 404, '模板不存在')
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'promo.template.delete', null, { id })
    ok(ctx, { items: await listTemplates() })
  })

  // 先看差异再套用：客户的活动参数是真金白银，不该点一下就整套盖掉
  router.get('/:id/preview/:tenantId', read, async (ctx) => {
    try {
      ok(ctx, await previewApply(ctx.state.env, Number(ctx.params.tenantId), Number(ctx.params.id)))
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '试算失败')
    }
  })

  router.post('/:id/apply/:tenantId', write, async (ctx) => {
    const id = Number(ctx.params.id)
    const tenantId = Number(ctx.params.tenantId)
    try {
      const res = await applyTemplate(ctx.state.env, tenantId, id,
        { name: ctx.state.platformAdmin?.username ?? null, side: 'platform' })
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'promo.template.apply', tenantId,
        { templateId: id, ...res })
      ok(ctx, { ...res, history: await listApplyHistory() })
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '套用失败')
    }
  })

  return router
}
