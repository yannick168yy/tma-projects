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

export function fail(ctx: Context, code: number, message: string, status = 400): void {
  ctx.status = status
  ctx.body = {
    code,
    message,
    data: null,
    traceId: ctx.state.traceId,
  } satisfies ApiBody<null>
}
