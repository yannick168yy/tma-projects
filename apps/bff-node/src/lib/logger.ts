import pino, { type Logger } from 'pino'

let instance: Logger | null = null

function level(): string {
  return process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
}

function create(): Logger {
  return pino({
    level: level(),
    base: { service: 'bff-node' },
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
