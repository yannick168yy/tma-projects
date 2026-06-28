import {
  applyConfigToProcessEnv,
  getNacosConnectionFromEnv,
  loadNacosConfig,
  subscribeNacosConfig,
} from './nacos.config.js'
import { closeMysql } from '../clients/mysql.client.js'
import { loadEnv, type Env } from './env.js'
import { initLogger } from '../lib/logger.js'

/** Container / compose 注入的地址不能被 Nacos 里的 127.0.0.1 覆盖 */
const INFRA_ENV_KEYS = ['MYSQL_HOST', 'MYSQL_PORT', 'REDIS_URL', 'NACOS_SERVER_ADDR'] as const

let pinnedInfraEnv: Record<string, string> = {}

function captureInfraEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of INFRA_ENV_KEYS) {
    if (process.env[key]) out[key] = process.env[key]!
  }
  return out
}

function normalizeMysqlEnv(): void {
  if (process.env.MYSQL_BETOGO_USER && !process.env.MYSQL_USER) {
    process.env.MYSQL_USER = process.env.MYSQL_BETOGO_USER
  }
  if (process.env.MYSQL_BETOGO_PASSWORD && !process.env.MYSQL_PASSWORD) {
    process.env.MYSQL_PASSWORD = process.env.MYSQL_BETOGO_PASSWORD
  }
}

function applyNacosConfig(config: Record<string, string>): void {
  const mysqlWired = Boolean(pinnedInfraEnv.MYSQL_HOST)
  const filtered = mysqlWired
    ? config
    : Object.fromEntries(
        Object.entries(config).filter(([key]) => !key.startsWith('MYSQL_')),
      )
  applyConfigToProcessEnv(filtered)
  for (const [key, value] of Object.entries(pinnedInfraEnv)) {
    process.env[key] = value
  }
  if (!mysqlWired) {
    for (const key of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
      delete process.env[key]
    }
  }
  normalizeMysqlEnv()
  void closeMysql()
}

function assertProductionSecurity(env: Env): void {
  if (env.NODE_ENV !== 'production') return
  const missing: string[] = []
  const warnings: string[] = []

  if (env.BFF_DEV_SKIP_TELEGRAM_AUTH) missing.push('BFF_DEV_SKIP_TELEGRAM_AUTH must be false')
  if (!env.INTERNAL_TOKEN.trim()) missing.push('INTERNAL_TOKEN')
  if (env.AMMER_PAY_PROVIDER_TOKEN.trim() && !env.TELEGRAM_WEBHOOK_SECRET.trim()) {
    warnings.push('TELEGRAM_WEBHOOK_SECRET')
  }
  if ((env.SG_BASE_URL.trim() || env.SG_MERCHANT_ID.trim()) && !env.SG_MERCHANT_KEY.trim()) {
    missing.push('SG_MERCHANT_KEY')
  }
  if (env.MATRIX_GATEWAY_URL.trim()) {
    for (const key of [
      'MATRIX_API_KEY',
      'MATRIX_MERCHANT_API_PRIVATE_KEY',
      'MATRIX_PLATFORM_API_PUBLIC_KEY',
      'MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY',
      'MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY',
    ] as const) {
      if (!env[key].trim()) missing.push(key)
    }
  }

  if (missing.length) {
    throw new Error(`Unsafe production configuration: ${missing.join(', ')}`)
  }
  if (warnings.length) {
    console.warn(`[bff-node] Production security warning: ${warnings.join(', ')}`)
  }
}

export async function bootstrapEnv(): Promise<Env> {
  pinnedInfraEnv = captureInfraEnv()
  normalizeMysqlEnv()

  const conn =
    process.env.BFF_STORAGE?.trim().toLowerCase() === 'redis'
      ? null
      : getNacosConnectionFromEnv()
  if (conn) {
    try {
      let config: Record<string, string> = {}
      let lastErr: unknown
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          config = await loadNacosConfig(conn)
          lastErr = undefined
          break
        } catch (err) {
          lastErr = err
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
      if (lastErr) throw lastErr
      applyNacosConfig(config)
      void subscribeNacosConfig(conn, (config) => {
        applyNacosConfig(config)
      }).catch((err) => {
        console.warn('[bff-node] Nacos subscribe failed:', err)
      })
    } catch (err) {
      console.error('[bff-node] Nacos load failed, falling back to process.env only:', err)
    }
  } else {
    console.info('[bff-node] NACOS_SERVER_ADDR not set, using process.env / .env only')
  }
  normalizeMysqlEnv()
  const env = loadEnv()
  assertProductionSecurity(env)
  process.env.LOG_LEVEL = env.LOG_LEVEL
  initLogger()
  return env
}
