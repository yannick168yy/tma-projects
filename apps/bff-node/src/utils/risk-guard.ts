import type { Context } from 'koa'
import { evaluateCheckpoint, type RiskCheckpoint } from '../services/risk.service.js'
import { getClientIp, getDeviceId } from './client-context.js'
import { fail } from './response.js'

/**
 * 路由层风控闸门。命中 deny 时自己写 403 响应并返回 false，调用方直接 return，
 * 无需改动各 handler 已有的 try/catch。tag_only 命中只落日志，返回 true 放行。
 */
export async function riskAllowed(ctx: Context, checkpoint: RiskCheckpoint): Promise<boolean> {
  const decision = await evaluateCheckpoint(ctx.state.env, {
    checkpoint,
    userId: ctx.state.userId,
    ip: getClientIp(ctx),
    deviceId: getDeviceId(ctx),
    fpVisitor: ctx.get('x-fp-visitor')?.slice(0, 128) || undefined,
  })
  if (decision.action === 'deny') {
    fail(ctx, 403, 'risk_denied', 403)
    return false
  }
  return true
}
