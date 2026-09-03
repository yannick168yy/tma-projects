import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getDefaultRedis } from '../../clients/redis.client.js'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { loginPlatformAdmin, logoutPlatformAdmin } from '../../services/platform-auth.service.js'
import { ok, fail } from '../../utils/response.js'

/**
 * 平台控制台 API。与 /admin（租户后台）完全分离：
 * 页面零重叠、会话零重叠、权限模型零重叠。
 */
export function createPlatformRouter(): Router {
  const router = new Router({ prefix: '/platform' })

  router.post('/auth/login', async (ctx) => {
    const body = ctx.request.body as { username?: string; password?: string }
    if (!body.username || !body.password) return fail(ctx, 400, '账号与密码必填')
    const res = await loginPlatformAdmin(getDefaultRedis(ctx.state.env), body.username, body.password)
    // 不区分「账号不存在」与「密码错误」，避免账号枚举
    if (!res) return fail(ctx, 401, '账号或密码错误', 401)
    ok(ctx, res)
  })

  const auth = platformAuthMiddleware()

  router.post('/auth/logout', auth, async (ctx) => {
    await logoutPlatformAdmin(getDefaultRedis(ctx.state.env), ctx.get('Authorization').slice(7))
    ok(ctx, { ok: true })
  })

  router.get('/auth/me', auth, async (ctx) => {
    const s = ctx.state.platformAdmin!
    ok(ctx, { id: s.adminId, username: s.username, role: s.role })
  })

  router.get('/tenants', auth, async (ctx) => {
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT t.id, t.code, t.name, t.db_name, t.status, t.self_operated, t.created_at,
              p.name AS plan_name,
              (SELECT COUNT(*) FROM pf_tenant_market m WHERE m.tenant_id = t.id) AS market_count,
              (SELECT COUNT(*) FROM pf_tenant_domain d WHERE d.tenant_id = t.id) AS domain_count
         FROM pf_tenant t
         LEFT JOIN pf_tenant_plan tp ON tp.tenant_id = t.id AND tp.ended_at IS NULL
         LEFT JOIN pf_plan p ON p.id = tp.plan_id
        ORDER BY t.id`,
    )
    ok(ctx, rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      database: r.db_name,
      status: r.status,
      selfOperated: r.self_operated === 1,
      planName: r.plan_name ?? null,
      marketCount: Number(r.market_count),
      domainCount: Number(r.domain_count),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })))
  })

  return router
}
