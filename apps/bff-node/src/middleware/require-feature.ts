import type { Middleware } from 'koa'
import { getTenantFeatures, type FeatureKey } from '../services/tenant-feature.service.js'
import { fail } from '../utils/response.js'

/**
 * 功能开关守卫。前端隐藏入口不是安全边界 —— 关掉的模块必须在接口层也拒绝，
 * 否则知道路径的人直接调接口照样能用。
 *
 * 挂在 router.use() 上按前缀生效，不逐个 handler 加。
 */
export function requireFeature(key: FeatureKey, message = '该功能未开通'): Middleware {
  return async (ctx, next) => {
    const tenant = ctx.state.tenant
    // 无租户上下文说明走到了不该走的路径（租户中间件已全局挂载），拒绝而不是放行
    if (!tenant) {
      fail(ctx, 403, message)
      return
    }
    const features = await getTenantFeatures(ctx.state.env, tenant.id)
    if (features[key] === false) {
      fail(ctx, 403, message)
      return
    }
    await next()
  }
}
