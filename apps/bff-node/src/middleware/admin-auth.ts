import type { Middleware } from 'koa'
import { getAdminSession } from '../services/admin-auth.service.js'
import { fail } from '../utils/response.js'

export function adminAuthMiddleware(): Middleware {
  return async (ctx, next) => {
    const auth = ctx.get('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      fail(ctx, 401, 'Admin auth required', 401)
      return
    }
    const token = auth.slice(7)
    const session = await getAdminSession(ctx.state.redis, token)
    if (!session) {
      fail(ctx, 401, 'Admin session expired or invalid', 401)
      return
    }
    // 高权限角色未绑 TOTP 的受限 session：只放行绑定流程（不含 disable）与状态查询
    if (session.totpSetupRequired) {
      const p = ctx.path
      const allowed =
        p === '/api/v1/admin/security/totp/status'
        || p === '/api/v1/admin/security/totp/setup'
        || p === '/api/v1/admin/security/totp/enable'
        || p === '/api/v1/admin/security/totp/cancel-setup'
      if (!allowed) {
        fail(ctx, 403, 'TOTP setup required', 403)
        return
      }
    }
    ctx.state.adminId = session.adminId
    ctx.state.adminUsername = session.username
    ctx.state.adminRole = session.role
    ctx.state.adminToken = token
    await next()
  }
}

declare module 'koa' {
  interface DefaultState {
    adminId?: number
    adminUsername?: string
    adminRole?: string
    adminToken?: string
  }
}
