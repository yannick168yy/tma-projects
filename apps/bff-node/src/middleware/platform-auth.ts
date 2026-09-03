import type { Middleware } from 'koa'
import { getPlatformSession, type PlatformRole } from '../services/platform-auth.service.js'
import { getDefaultRedis } from '../clients/redis.client.js'
import { fail } from '../utils/response.js'

/**
 * 平台管理员鉴权。与租户后台的 adminAuthMiddleware 完全独立：
 * 平台身份不属于任何租户，会话必须走无前缀的 Redis 客户端，
 * 否则会被当前请求所属租户的 keyPrefix 污染，换个域名进来就读不到会话。
 */
export function platformAuthMiddleware(...roles: PlatformRole[]): Middleware {
  return async (ctx, next) => {
    const auth = ctx.get('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      fail(ctx, 401, 'Platform auth required', 401)
      return
    }
    const session = await getPlatformSession(getDefaultRedis(ctx.state.env), auth.slice(7))
    if (!session) {
      fail(ctx, 401, 'Platform session expired or invalid', 401)
      return
    }
    if (roles.length > 0 && !roles.includes(session.role)) {
      fail(ctx, 403, '无操作权限', 403)
      return
    }
    ctx.state.platformAdmin = session
    await next()
  }
}
