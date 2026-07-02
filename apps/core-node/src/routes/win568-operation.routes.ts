import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { Win568Client } from '../clients/win568.client.js'

function validUsername(username: string) {
  return /^[A-Za-z0-9_]{6,40}$/.test(username)
}

function validPassword(password: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d_!@#$%^&*.-]{6,20}$/.test(password)
}

export async function win568OperationRoutes(app: FastifyInstance) {
  const client = new Win568Client()

  app.addHook('onRequest', async (req, reply) => {
    const token = req.headers['x-internal-token']
    if (!env.INTERNAL_TOKEN || token !== env.INTERNAL_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  app.post<{
    Body: { apiType: 'Operation' | 'SeamlessWallet' }
  }>('/key/regenerate', async (req, reply) => {
    if (req.body.apiType !== 'Operation' && req.body.apiType !== 'SeamlessWallet') {
      return reply.status(400).send({ error: 'apiType must be Operation or SeamlessWallet' })
    }
    const result = await client.regenerateCompanyKey(req.body.apiType)
    return reply.send({
      ...result,
      configSection: req.body.apiType === 'Operation' ? 'WIN568_COMPANY_KEY' : 'WIN568_SW_COMPANY_KEY',
    })
  })

  app.post<{
    Body: {
      username: string
      password: string
      currency: 'PHP' | 'USDT'
      min: number
      max: number
      maxPerMatch: number
      casinoTableLimit: number
      isTwoFAEnabled?: boolean
    }
  }>('/agent/register', async (req, reply) => {
    const body = req.body
    if (!validUsername(body.username)) return reply.status(400).send({ error: 'invalid username' })
    if (!validPassword(body.password)) return reply.status(400).send({ error: 'invalid password' })
    if (body.min >= body.max || body.max > body.maxPerMatch || body.maxPerMatch > 2_000_000_000) {
      return reply.status(400).send({ error: 'invalid bet limits' })
    }
    const result = await client.registerAgent({
      Username: body.username,
      Password: body.password,
      Currency: body.currency,
      Min: body.min,
      Max: body.max,
      MaxPerMatch: body.maxPerMatch,
      CasinoTableLimit: body.casinoTableLimit,
      IsTwoFAEnabled: body.isTwoFAEnabled,
    })
    if (result.error.id === 0) {
      await app.mysql.execute(
        `INSERT INTO bg_568win_agent
         (agent_username, currency, min_bet, max_bet, max_bet_per_match, casino_table_limit, raw_response)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE min_bet = VALUES(min_bet), max_bet = VALUES(max_bet),
           max_bet_per_match = VALUES(max_bet_per_match), casino_table_limit = VALUES(casino_table_limit),
           raw_response = VALUES(raw_response), updated_at = NOW(3)`,
        [body.username, body.currency, body.min, body.max, body.maxPerMatch, body.casinoTableLimit, JSON.stringify(result)],
      )
    }
    return reply.send(result)
  })

  app.post<{
    Body: { userId: string; username?: string; agent: string; userGroup?: string; currency?: 'PHP' | 'USDT' }
  }>('/player/register', async (req, reply) => {
    const username = req.body.username ?? req.body.userId
    if (!validUsername(username)) return reply.status(400).send({ error: 'invalid username' })
    if (!/^[a-z]$/.test(req.body.userGroup ?? 'a')) return reply.status(400).send({ error: 'invalid userGroup' })
    const [[agent]] = await app.mysql.query<RowDataPacket[]>(
      `SELECT agent_username, currency FROM bg_568win_agent WHERE agent_username = ? LIMIT 1`,
      [req.body.agent],
    )
    if (!agent) return reply.status(400).send({ error: 'agent not found' })
    const result = await client.registerPlayer({ Username: username, Agent: req.body.agent, UserGroup: req.body.userGroup ?? 'a' })
    if (result.error.id === 0 || result.error.id === 302) {
      await app.mysql.execute(
        `INSERT INTO bg_aggregator_player
         (aggregator_id, user_id, external_username, agent_username, currency, raw_response)
         VALUES ('568win', ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE external_username = VALUES(external_username),
           agent_username = VALUES(agent_username), currency = VALUES(currency),
           raw_response = VALUES(raw_response), updated_at = NOW(3)`,
        [req.body.userId, username, req.body.agent, req.body.currency ?? String(agent.currency), JSON.stringify(result)],
      )
    }
    return reply.send(result)
  })

  app.post<{ Body: Record<string, unknown> }>('/login', async (req, reply) => {
    const result = await client.login(req.body)
    return reply.send(result)
  })
}
