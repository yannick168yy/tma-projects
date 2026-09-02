import { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { currentTenantOrNull, type TenantContext } from '../lib/tenant-context.js'

// 按 keyPrefix 缓存客户端。自营站前缀为空串，用的就是原来那个客户端，
// 键名与今天完全一致 —— 所以本次改造不需要任何存量键迁移。
const clients = new Map<string, Redis>()

/**
 * 租户的 Redis 键前缀。
 * 自营站返回空串：它的键名保持现状，新租户从空 keyspace 起步用 `t{id}:`，
 * 两边永不冲突，省掉了双读过渡与存量迁移这两步高风险操作。
 */
export function keyPrefixFor(tenant: TenantContext | null): string {
  if (!tenant || tenant.selfOperated) return ''
  return `t${tenant.id}:`
}

function clientFor(env: Env, keyPrefix: string): Redis {
  const existing = clients.get(keyPrefix)
  if (existing) return existing
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    ...(keyPrefix ? { keyPrefix } : {}),
  })
  client.on('error', (err) => {
    console.warn(`[redis${keyPrefix ? ':' + keyPrefix : ''}] client error:`, err.message)
  })
  clients.set(keyPrefix, client)
  return client
}

/**
 * 跨租户用的无前缀客户端：平台库租户缓存、租户解析这类全局数据走它。
 * 业务代码不要用，业务一律用 getRedis()。
 */
export function getDefaultRedis(env: Env): Redis {
  return clientFor(env, '')
}

/** 按当前租户取客户端。业务侧 217 处 Redis 调用因此不用改。 */
export function getRedis(env: Env): Redis {
  return clientFor(env, keyPrefixFor(currentTenantOrNull()))
}

/**
 * 按 keyPrefix 安全地扫键。
 * ioredis 的 keyPrefix 不作用于 KEYS/SCAN 的模式参数，且返回的是含前缀的完整键，
 * 直接把它喂回 redis.get() 会被二次前缀。这里统一补前缀、剥前缀。
 */
export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const prefix = redis.options.keyPrefix ?? ''
  const keys = await redis.keys(`${prefix}${pattern}`)
  return prefix ? keys.map((key) => key.slice(prefix.length)) : keys
}

export async function closeRedis(): Promise<void> {
  const all = [...clients.values()]
  clients.clear()
  await Promise.all(all.map((client) => client.quit()))
}
