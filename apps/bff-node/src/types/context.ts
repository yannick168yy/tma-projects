import type { Env } from '../config/env.js'
import type { Redis } from 'ioredis'
import type { TenantContext } from '../lib/tenant-context.js'

export interface AppState {
  traceId: string
  env: Env
  redis: Redis
  userId?: string
  tenant?: TenantContext
}
