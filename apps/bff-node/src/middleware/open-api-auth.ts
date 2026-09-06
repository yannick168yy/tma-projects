import type { Middleware } from 'koa'
import { runWithTenant } from '../lib/tenant-context.js'
import { verifyApiKey, type ApiScope, type VerifiedKey } from '../services/open-api.service.js'
import { getDefaultRedis } from '../clients/redis.client.js'
import { fail } from '../utils/response.js'

const REASON_MESSAGE: Record<string, string> = {
  missing: '缺少 X-Api-Key 请求头',
  malformed: 'X-Api-Key 格式应为 <prefix>.<secret>',
  unknown: '密钥无效',
  disabled: '密钥已吊销，或站点已关闭',
  expired: '密钥已过期',
  ip: '来源 IP 不在该密钥的白名单内',
}

/**
 * 开放 API 鉴权 + 限流（P3-7）。
 *
 * 校验通过后用 runWithTenant 包住后续处理 —— 开放 API 的每个接口都直接用
 * getMysqlPool()，租户上下文是唯一的隔离手段，忘了包就等于所有 key 都能读自营库。
 *
 * 限流按 key 而不是按 IP：客户的服务器换 IP 很正常，而一把 key 打爆共享的
 * MySQL 连接池会影响同库的前台玩家。
 */
export function openApiAuth(): Middleware {
  return async (ctx, next) => {
    const raw = ctx.get('x-api-key') || undefined
    const ip = ctx.ip.replace(/^::ffff:/i, '')
    const verified = await verifyApiKey(raw, ip)
    if ('ok' in verified) {
      // 401 给「你是谁」的问题，403 给「你是谁没问题但不让你进」
      const status = verified.reason === 'ip' ? 403 : 401
      return fail(ctx, status, REASON_MESSAGE[verified.reason] ?? '密钥无效', status)
    }

    const key = `openapi:rl:${verified.keyPrefix}:${Math.floor(Date.now() / 60_000)}`
    const redis = getDefaultRedis(ctx.state.env)
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 90)
    if (count > verified.ratePerMin) {
      ctx.set('Retry-After', '60')
      return fail(ctx, 429, `超过该密钥的每分钟上限（${verified.ratePerMin}）`, 429)
    }
    ctx.set('X-RateLimit-Limit', String(verified.ratePerMin))
    ctx.set('X-RateLimit-Remaining', String(Math.max(0, verified.ratePerMin - count)))

    ctx.state.apiKey = verified
    await runWithTenant(verified.tenant, () => next())
  }
}

/** 缺 scope 回 403 并说明缺哪个：只说「无权限」会让客户来问平台要哪个 scope */
export function requireScope(scope: ApiScope): Middleware {
  return async (ctx, next) => {
    const key = ctx.state.apiKey
    if (!key?.scopes.includes(scope)) {
      return fail(ctx, 403, `该密钥缺少 ${scope} 权限`, 403)
    }
    await next()
  }
}

declare module 'koa' {
  interface DefaultState {
    apiKey?: VerifiedKey
  }
}
