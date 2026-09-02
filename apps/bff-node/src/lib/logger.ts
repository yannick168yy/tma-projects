import pino, { type Logger } from 'pino'
import { currentTenantOrNull } from './tenant-context.js'

let instance: Logger | null = null

function level(): string {
  return process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
}

function create(): Logger {
  return pino({
    level: level(),
    base: { service: 'bff-node' },
    // 每条日志自动带租户代号：全链路排障要能按租户下钻，
    // 用 mixin 就不必改任何一处 log 调用
    mixin: () => {
      const tenant = currentTenantOrNull()
      return tenant ? { tenant: tenant.code } : {}
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(process.env.NODE_ENV !== 'production'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  })
}

/** 在 bootstrapEnv 之后调用，确保 LOG_LEVEL 已注入 */
export function initLogger(): Logger {
  instance = create()
  return instance
}

function get(): Logger {
  if (!instance) instance = create()
  return instance
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const log = get()
    const val = log[prop as keyof Logger]
    return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(log) : val
  },
})

export function childLogger(module: string) {
  return get().child({ module })
}
