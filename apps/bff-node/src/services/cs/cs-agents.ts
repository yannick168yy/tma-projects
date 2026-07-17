import type { Env } from '../../config/env.js'
import { getRedis } from '../../clients/redis.client.js'

// 菲律宾市场常见英文名,每个会话随机分配一个;前端按小写名取 /cs-avatars/<name>.jpg
export const CS_AGENTS = ['Mika', 'Jenny', 'Kaye', 'Rina', 'Lyca', 'Anne', 'Chloe', 'Jasmine', 'Ella', 'Nica'] as const

export type CsAgentName = (typeof CS_AGENTS)[number]

export function normalizeAgentName(value: unknown): CsAgentName | null {
  return typeof value === 'string' && (CS_AGENTS as readonly string[]).includes(value) ? (value as CsAgentName) : null
}

// 老会话 agent_name 为空时按 id 兜底,同一会话每次渲染都是同一个人
export function fallbackAgentName(conversationId: number): CsAgentName {
  return CS_AGENTS[conversationId % CS_AGENTS.length]
}

function pickAgentName(): CsAgentName {
  return CS_AGENTS[Math.floor(Math.random() * CS_AGENTS.length)]
}

const PENDING_TTL_SECONDS = 3600

function pendingKey(userId: string) {
  return `cs:agent:${userId}`
}

// 开场白(/cs/welcome)比会话行先出现,先把人选占在 redis,建会话时再落库,保证开场白和会话里是同一个客服
export async function reserveAgentName(env: Env, userId: string): Promise<CsAgentName> {
  const redis = getRedis(env)
  const cached = normalizeAgentName(await redis.get(pendingKey(userId)))
  if (cached) return cached
  const name = pickAgentName()
  await redis.set(pendingKey(userId), name, 'EX', PENDING_TTL_SECONDS)
  return name
}

// 会话建好后释放占位,下次新会话重新随机换人
export async function consumeAgentName(env: Env, userId: string): Promise<void> {
  await getRedis(env).del(pendingKey(userId))
}
