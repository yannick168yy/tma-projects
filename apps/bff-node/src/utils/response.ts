import type { Context } from 'koa'

export interface ApiBody<T = unknown> {
  code: number
  message: string
  data: T
  traceId: string
}

export function ok<T>(ctx: Context, data: T, message = 'ok'): void {
  ctx.body = {
    code: 0,
    message,
    data,
    traceId: ctx.state.traceId,
  } satisfies ApiBody<T>
}

// status 缺省跟随 code：历史上 3 参调用一律落 HTTP 400、语义码只在 body.code（withdraw 的 429、
// checkin 的 500 等 193 处如此），客户端/监控按 HTTP 状态判断会误判（压测优化#10）
export function fail(ctx: Context, code: number, message: string, status?: number): void {
  ctx.status = status ?? (code >= 400 && code <= 599 ? code : 400)
  ctx.body = {
    code,
    message,
    data: null,
    traceId: ctx.state.traceId,
  } satisfies ApiBody<null>
}
