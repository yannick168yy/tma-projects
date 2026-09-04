import { randomBytes } from 'node:crypto'
import { getDefaultRedis } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'

/**
 * impersonate 一次性票据（P1-6）。
 *
 * 票据放**无前缀 Redis**：签发在平台控制台（无租户上下文），
 * 兑换在租户后台域名（有租户上下文且前缀是 t{id}:）。
 * 走带前缀的客户端会导致签发和兑换读写到两个不同的键，永远兑不出来。
 */
const TICKET_PREFIX = 'platform:impersonate:'

/**
 * 60 秒。票据只是「从平台控制台跳到租户后台」这一次跳转的凭据，
 * 给长了等于多一个可被复制转发的长期凭据。
 */
const TICKET_TTL_SECONDS = 60

export interface ImpersonateTicket {
  tenantId: number
  platformAdminId: number | null
  platformUsername: string
  issuedAt: number
}

export async function issueImpersonateTicket(
  env: Env,
  payload: Omit<ImpersonateTicket, 'issuedAt'>,
): Promise<{ ticket: string; expiresIn: number }> {
  const ticket = randomBytes(32).toString('hex')
  const value: ImpersonateTicket = { ...payload, issuedAt: Date.now() }
  await getDefaultRedis(env).setex(`${TICKET_PREFIX}${ticket}`, TICKET_TTL_SECONDS, JSON.stringify(value))
  return { ticket, expiresIn: TICKET_TTL_SECONDS }
}

/**
 * 取出并立即销毁票据。
 *
 * 用 GETDEL 而不是 GET + DEL：两条命令之间的窗口足够让同一张票被用两次，
 * 那就等于签发了一个可复用的后台登录凭据。
 */
export async function consumeImpersonateTicket(env: Env, ticket: string): Promise<ImpersonateTicket | null> {
  if (!ticket || !/^[a-f0-9]{64}$/.test(ticket)) return null
  const raw = await getDefaultRedis(env).getdel(`${TICKET_PREFIX}${ticket}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ImpersonateTicket
  } catch {
    return null
  }
}
