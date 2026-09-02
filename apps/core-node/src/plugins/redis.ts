import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { currentTenantOrNull, type TenantContext } from '../lib/tenant-context.js'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

// 自营站前缀为空串，键名与今天完全一致 —— 不需要任何存量键迁移。
// 新租户从空 keyspace 起步用 t{id}:，两边永不冲突。
const clients = new Map<string, Redis>()

export function keyPrefixFor(tenant: TenantContext | null): string {
  if (!tenant || tenant.selfOperated) return ''
  return `t${tenant.id}:`
}

function clientFor(keyPrefix: string, onError: (err: Error) => void): Redis {
  const existing = clients.get(keyPrefix)
  if (existing) return existing
  const client = new Redis(env.REDIS_URL, keyPrefix ? { keyPrefix } : {})
  // ioredis 断线重连失败会 emit 'error'，没有 handler 就是 uncaughtException 杀进程
  client.on('error', onError)
  clients.set(keyPrefix, client)
  return client
}

/** 跨租户用的无前缀客户端：租户解析缓存这类全局数据走它 */
export function getDefaultRedis(onError: (err: Error) => void = () => {}): Redis {
  return clientFor('', onError)
}

export default fp(async (app) => {
  const onError = (err: Error) => app.log.error({ err: err.message }, 'Redis client error')
  const base = clientFor('', onError)

  // getter 装饰器：现有 13 处 app.redis 调用不用改，自动按租户带 keyPrefix。
  // 消费者与定时任务没有租户上下文，拿到的就是自营站（无前缀）客户端。
  app.decorate('redis', {
    getter: () => {
      const prefix = keyPrefixFor(currentTenantOrNull())
      return prefix ? clientFor(prefix, onError) : base
    },
  })

  app.addHook('onClose', async () => {
    const all = [...clients.values()]
    clients.clear()
    await Promise.all(all.map((client) => client.quit()))
  })
}, { name: 'redis' })
