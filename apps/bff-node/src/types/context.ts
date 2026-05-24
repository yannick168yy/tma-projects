import type { Env } from '../config/env.js'
import type { Redis } from 'ioredis'

export interface AppState {
  traceId: string
  env: Env
  redis: Redis
  userId?: string
}
