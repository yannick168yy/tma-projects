import type { Context } from 'koa'

// app.proxy = true 时 ctx.ip 已解析 X-Forwarded-For，但这里显式取首段并做字符白名单，
// 避免伪造头把脏值写进风控日志/名单比对。
export function getClientIp(ctx: Context): string {
  const forwarded = ctx.get('X-Forwarded-For')
  const ip = forwarded ? forwarded.split(',')[0].trim() : ctx.ip
  return ip.replace(/[^a-zA-Z0-9.:]/g, '').slice(0, 64) || 'unknown'
}

/** 前端 client.ts 统一注入 X-Device-Id；缺失即降级，不阻断 */
export function getDeviceId(ctx: Context): string | undefined {
  return ctx.get('x-device-id')?.slice(0, 128) || undefined
}
