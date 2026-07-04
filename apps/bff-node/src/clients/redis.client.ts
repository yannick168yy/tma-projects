import { Redis } from 'ioredis'
import type { Env } from '../config/env.js'

let client: Redis | null = null

export function getRedis(env: Env): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    })
    client.on('error', (err) => {
      console.warn('[redis] client error:', err.message)
    })
  }
  return client
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
}
