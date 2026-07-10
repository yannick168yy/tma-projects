import type { Middleware } from 'koa'
import { fail } from '../utils/response.js'

/**
 * 管理员角色守卫。替代散落在各 handler 首行的 `if (ctx.state.adminRole !== 'super_admin')`。
 * 沿用既有的 fail(ctx, 403, msg)：body.code=403 而 HTTP status 走默认 400，与替换前行为一致。
 */
export function requireRole(roles: string | string[], message = '无操作权限'): Middleware {
  const allowed = Array.isArray(roles) ? roles : [roles]
  return async (ctx, next) => {
    if (!allowed.includes(ctx.state.adminRole ?? '')) {
      fail(ctx, 403, message)
      return
    }
    await next()
  }
}
