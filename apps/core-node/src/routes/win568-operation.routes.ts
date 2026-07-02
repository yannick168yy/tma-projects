import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { Win568Client } from '../clients/win568.client.js'

function validUsername(username: string) {
  return /^[A-Za-z0-9_]{6,40}$/.test(username)
}

export function toWin568Username(userId: string) {
  return userId.trim().replace(/[^A-Za-z0-9_]/g, '_')
}

function validPassword(password: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d_!@#$%^&*.-]{6,20}$/.test(password)
}

function text(value: unknown) {
  return value == null ? '' : String(value)
}

function numberOrNull(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dateOrNull(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export function collectWin568ReportBets(value: unknown): Record<string, unknown>[] {
  const bets: Record<string, unknown>[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (typeof obj.refNo === 'string' || typeof obj.refno === 'string' || typeof obj.refNo === 'number' || typeof obj.refno === 'number') {
      bets.push(obj)
      return
    }
    for (const child of Object.values(obj)) visit(child)
  }
  visit(value)
  return bets
}

async function saveReportBets(app: FastifyInstance, portfolio: string, result: unknown, rawResponse: unknown) {
  const bets = collectWin568ReportBets(result)
  for (const bet of bets) {
    const refNo = text(bet.refNo ?? bet.refno)
    if (!refNo) continue
    await app.mysql.execute(
      `INSERT INTO bg_568win_report_bet
       (portfolio, ref_no, external_username, currency, status, stake, win_lost,
        order_time, settle_time, win_lost_date, modify_date, raw_bet, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE external_username = VALUES(external_username),
         currency = VALUES(currency), status = VALUES(status), stake = VALUES(stake),
         win_lost = VALUES(win_lost), order_time = VALUES(order_time),
         settle_time = VALUES(settle_time), win_lost_date = VALUES(win_lost_date),
         modify_date = VALUES(modify_date), raw_bet = VALUES(raw_bet),
         raw_response = VALUES(raw_response), fetched_at = NOW(3)`,
      [
        portfolio,
        refNo,
        text(bet.username) || null,
        text(bet.currency) || null,
        text(bet.status) || null,
        numberOrNull(bet.stake),
        numberOrNull(bet.winLost ?? bet.winlost),
        dateOrNull(bet.orderTime),
        dateOrNull(bet.settleTime),
        dateOrNull(bet.winLostDate ?? bet.winlostDate),
        dateOrNull(bet.modifyDate ?? bet.modifiedDate),
        JSON.stringify(bet),
        JSON.stringify(rawResponse),
      ],
    )
  }
  return bets.length
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
      currency: 'PHP' | 'USDT' | 'TMP'
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
    Body: { userId: string; username?: string; agent: string; userGroup?: string; currency?: 'PHP' | 'USDT' | 'TMP' }
  }>('/player/register', async (req, reply) => {
    const username = req.body.username ?? toWin568Username(req.body.userId)
    if (!validUsername(username)) return reply.status(400).send({ error: 'invalid username' })
    if (!/^[a-z]$/.test(req.body.userGroup ?? 'a')) return reply.status(400).send({ error: 'invalid userGroup' })
    const [[mapped]] = await app.mysql.query<RowDataPacket[]>(
      `SELECT user_id FROM bg_aggregator_player
       WHERE aggregator_id = '568win' AND external_username = ? LIMIT 1`,
      [username],
    )
    if (mapped && String(mapped.user_id) !== req.body.userId) {
      return reply.status(409).send({ error: 'external username already mapped' })
    }
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

  app.post<{
    Body: { portfolio: string; startDate: string; endDate: string; language?: string; isGetDownline?: boolean }
  }>('/report/modify-date', async (req, reply) => {
    const result = await client.getBetListByModifyDate({
      portfolio: req.body.portfolio,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      language: req.body.language ?? 'en',
      isGetDownline: req.body.isGetDownline ?? false,
    })
    const savedCount = result.error.id === 0 ? await saveReportBets(app, req.body.portfolio, result.result, result) : 0
    return reply.send({ ...result, savedCount })
  })

  app.post<{
    Body: { portfolio: string; refNos: string | string[]; language?: string }
  }>('/report/refnos', async (req, reply) => {
    const refNos = Array.isArray(req.body.refNos) ? req.body.refNos.join(',') : req.body.refNos
    const result = await client.getBetListByRefNos({
      portfolio: req.body.portfolio,
      refNos,
      language: req.body.language ?? 'en',
    })
    const savedCount = result.error.id === 0 ? await saveReportBets(app, req.body.portfolio, result.result, result) : 0
    return reply.send({ ...result, savedCount })
  })

  app.post<{
    Body: { portfolio: string; refno: string; language?: string }
  }>('/report/payload', async (req, reply) => {
    const result = await client.getBetPayload({
      Portfolio: req.body.portfolio,
      Refno: req.body.refno,
      Language: req.body.language ?? 'EN',
    })
    return reply.send(result)
  })
}
