import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { Win568Client } from '../clients/win568.client.js'
import { getWin568OperationCompanyKey } from '../services/win568-key-settings.service.js'
import { probePendingGameIcons } from '../services/game-icon-probe.service.js'
import { normalizeWin568Provider } from '../services/win568-provider-canon.js'

function validUsername(username: string) {
  return /^[A-Za-z0-9_]{6,40}$/.test(username)
}

export function toWin568Username(userId: string) {
  return userId.trim().replace(/[^A-Za-z0-9_]/g, '_')
}

// 我方钱包币种：读余额/记账用的实际币种（bg_wallet.currency）。
type WalletCcy = 'PHP' | 'USDT' | 'USDC'
function normalizeWalletCcy(currency?: string): WalletCcy {
  const c = (currency || env.WIN568_DEFAULT_CURRENCY).toUpperCase()
  if (c === 'USDT' || c === 'UCC') return 'USDT'
  if (c === 'USDC') return 'USDC'
  return 'PHP'
}

// 568Win agent 币种：稳定币(USDT/USDC)统一玩 USD 币种游戏（568Win 对 USDT/USDC 的游戏少，USD 游戏最多；1:1 折算）。
function win568AgentCurrency(walletCcy: WalletCcy): 'PHP' | 'USD' {
  return walletCcy === 'PHP' ? 'PHP' : 'USD'
}

// 同一用户不同钱包币种需要不同的 568Win 账号（账号全局唯一、且绑定单一 agent）。
// PHP 保持原账号（历史映射兼容），USDT 加 U 后缀、USDC 加 C 后缀。
const USERNAME_SUFFIX: Record<WalletCcy, string> = { PHP: '', USDT: 'U', USDC: 'C' }
function win568Username(userId: string, walletCcy: WalletCcy) {
  return toWin568Username(userId) + USERNAME_SUFFIX[walletCcy]
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

function intOrNull(value: unknown) {
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

function dateOrNull(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function jsonOrNull(value: unknown) {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function win568Lang(language: string | undefined) {
  const lang = text(language || 'en').split('-')[0].toLowerCase()
  if (lang === 'zh') return 'zh_cn'
  return lang || 'en'
}

function win568Device(device: string | undefined) {
  return device === 'desktop' || device === 'd' ? 'd' : 'm'
}

export function buildWin568SportsbookPayload(input: {
  username: string
  device?: string
  language?: string
}) {
  return {
    Username: input.username,
    Portfolio: '568WinSportsbook',
    Lang: win568Lang(input.language).toUpperCase(),
    Device: win568Device(input.device),
    OddStyle: 'MY',
    OddsMode: 'double',
  }
}

export function buildWin568LaunchPayload(input: {
  username: string
  gameId: number
  gpId: number
  newGameType: number | null
  device?: string
  language?: string
}) {
  return {
    Username: input.username,
    Portfolio: input.newGameType === 300 ? 'ThirdPartySportsBook' : 'SeamlessGame',
    Lang: win568Lang(input.language),
    Device: win568Device(input.device),
    GpId: input.gpId,
    GameId: input.gameId,
  }
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

export async function saveReportBets(app: FastifyInstance, portfolio: string, result: unknown) {
  const bets = collectWin568ReportBets(result)
  let saved = 0
  for (const bet of bets) {
    const refNo = text(bet.refNo ?? bet.refno)
    if (!refNo) continue
    // 单行写失败必须就地吞掉：抛出去会冒泡到 cron 的 portfolio catch，游标不推进，
    // 下一轮 10 分钟后把同一个 24h 窗口整页重拉、整页重新 UPDATE。
    // 178 那次 ref_no 超长就是这么卡了 3 天，约 430 轮重刷把本表撑出 19.5GB 碎片
    // （.ibd 22.9GB / 真实数据 300MB）。178 只加宽了列，没解决这个结构。
    try {
      // raw_response 保存整页响应会随每条注单重复放大；单条原文保留在 raw_bet。
      await app.mysql.execute(
        `INSERT INTO bg_568win_report_bet
       (portfolio, ref_no, external_username, currency, status, stake, win_lost,
        order_time, settle_time, win_lost_date, modify_date, raw_bet, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE external_username = VALUES(external_username),
         currency = VALUES(currency), status = VALUES(status), stake = VALUES(stake),
         win_lost = VALUES(win_lost), order_time = VALUES(order_time),
         settle_time = VALUES(settle_time), win_lost_date = VALUES(win_lost_date),
         modify_date = VALUES(modify_date), raw_bet = VALUES(raw_bet),
         raw_response = NULL, fetched_at = NOW(3)`,
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
        ],
      )
      saved += 1
    } catch (err) {
      app.log.error({ err, portfolio, refNo }, '[568win-report-sync] save bet failed, skipped')
    }
  }
  return saved
}

function collectWin568Games(result: unknown): Record<string, unknown>[] {
  const games = result && typeof result === 'object'
    ? (result as Record<string, unknown>).seamlessGameProviderGames
    : null
  return Array.isArray(games) ? games.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : []
}

function gameInfo(g: Record<string, unknown>, language: string) {
  const infos = Array.isArray(g.gameInfos) ? g.gameInfos : []
  const target = language.toLowerCase()
  const fallback = target === 'zh_cn' ? 'zh' : 'en'
  const found = infos.find((item) => {
    if (!item || typeof item !== 'object') return false
    return text((item as Record<string, unknown>).language).toLowerCase() === target
  }) ?? infos.find((item) => {
    if (!item || typeof item !== 'object') return false
    return text((item as Record<string, unknown>).language).toLowerCase().startsWith(fallback)
  })
  return found && typeof found === 'object' ? found as Record<string, unknown> : null
}

const PERYA_KEYWORDS = ['perya', 'peryahan', 'bingo', 'color game', 'drop ball', 'pinoy', 'sabong', 'pula puti', 'mines', 'crash', 'plinko', 'hilo', 'hi-lo', 'aviator']
const POKER_KEYWORDS = ['poker', 'teen patti']

export function classifyWin568SiteCategory(newGameType: number | null, ...names: (string | null | undefined)[]): string {
  const name = names.filter(Boolean).join(' ').toLowerCase()
  if (PERYA_KEYWORDS.some((k) => name.includes(k))) return 'perya'
  if (newGameType === 107 || POKER_KEYWORDS.some((k) => name.includes(k))) return 'poker'
  if (newGameType === 100 || newGameType === 200) return 'lobby'
  if (newGameType === 201) return 'slot'
  if (newGameType === 203 || name.includes('fish')) return 'fishing'
  if (newGameType === 207) return 'lottery'
  if (newGameType !== null && newGameType >= 300 && newGameType < 400) return 'sports'
  // 101-199 真人 + 204 RNG 桌游都归 casino
  if (newGameType !== null && (newGameType >= 101 && newGameType < 200 || newGameType === 204)) return 'casino'
  return 'other'
}

export async function saveWin568Games(app: FastifyInstance, result: unknown) {
  const games = collectWin568Games(result)
  for (const g of games) {
    const gameId = intOrNull(g.gameID)
    const gpId = intOrNull(g.gameProviderId)
    if (gameId === null || gpId === null) continue
    const infoEn = gameInfo(g, 'en')
    const infoZh = gameInfo(g, 'zh_cn')
    const enabled = boolValue(g.isEnabled) && !boolValue(g.isMaintain) && text(g.providerStatus) === 'Online' && boolValue(g.isProviderOnline)
    const canonProvider = normalizeWin568Provider(text(g.provider) || null)
    await app.mysql.execute(
      `INSERT INTO bg_568win_game
       (game_id, game_provider_id, provider, provider_short, new_game_type, game_type, site_category_auto, rank_no, device, platform,
        rtp, rows_count, reels_count, lines_count, name_en, name_zh, icon_url,
        supported_currencies, block_countries, is_enabled, is_maintain, provider_status,
        is_provider_online, is_provide_commission, has_hedge_bet, raw_game, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE game_provider_id = VALUES(game_provider_id),
         provider = VALUES(provider), provider_short = VALUES(provider_short), new_game_type = VALUES(new_game_type),
         game_type = VALUES(game_type), site_category_auto = VALUES(site_category_auto),
         rank_no = VALUES(rank_no), device = VALUES(device),
         platform = VALUES(platform), rtp = VALUES(rtp), rows_count = VALUES(rows_count),
         reels_count = VALUES(reels_count), lines_count = VALUES(lines_count),
         name_en = VALUES(name_en), name_zh = VALUES(name_zh),
         icon_width = IF(icon_url <=> VALUES(icon_url), icon_width, NULL),
         icon_height = IF(icon_url <=> VALUES(icon_url), icon_height, NULL),
         icon_probed_at = IF(icon_url <=> VALUES(icon_url), icon_probed_at, NULL),
         icon_url = VALUES(icon_url),
         supported_currencies = VALUES(supported_currencies), block_countries = VALUES(block_countries),
         is_enabled = VALUES(is_enabled), is_maintain = VALUES(is_maintain),
         provider_status = VALUES(provider_status), is_provider_online = VALUES(is_provider_online),
         is_provide_commission = VALUES(is_provide_commission), has_hedge_bet = VALUES(has_hedge_bet),
         raw_game = VALUES(raw_game), raw_response = VALUES(raw_response), synced_at = NOW(3)`,
      [
        gameId,
        gpId,
        canonProvider.provider,
        canonProvider.short,
        intOrNull(g.newGameType),
        intOrNull(g.gameType),
        classifyWin568SiteCategory(intOrNull(g.newGameType), text(infoEn?.gameName), text(infoZh?.gameName)),
        intOrNull(g.rank),
        text(g.device) || null,
        text(g.platform) || null,
        numberOrNull(g.rtp),
        intOrNull(g.rows),
        intOrNull(g.reels),
        intOrNull(g.lines),
        text(infoEn?.gameName) || text(infoZh?.gameName) || null,
        text(infoZh?.gameName) || null,
        text(infoEn?.gameIconUrl) || text(infoZh?.gameIconUrl) || null,
        jsonOrNull(g.supportedCurrencies),
        jsonOrNull(g.blockCountries),
        enabled ? 1 : 0,
        boolValue(g.isMaintain) ? 1 : 0,
        text(g.providerStatus) || null,
        boolValue(g.isProviderOnline) ? 1 : 0,
        boolValue(g.isProvideCommission) ? 1 : 0,
        boolValue(g.hasHedgeBet) ? 1 : 0,
        JSON.stringify(g),
        null,
      ],
    )
  }
  return games.length
}

async function resolveWin568Player(app: FastifyInstance, userId: string, currency?: string) {
  const walletCcy = normalizeWalletCcy(currency)
  const agentCcy = win568AgentCurrency(walletCcy)
  // 映射按「钱包币种」维度存取：一个用户每种钱包币种一条，回调据此读对应 bg_wallet
  const [[mapped]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT external_username FROM bg_aggregator_player
     WHERE aggregator_id = '568win' AND user_id = ? AND currency = ? LIMIT 1`,
    [userId, walletCcy],
  )
  if (mapped) return String(mapped.external_username)

  const username = win568Username(userId, walletCcy)
  if (!validUsername(username)) throw new Error('invalid 568Win username')

  const [[used]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT user_id FROM bg_aggregator_player
     WHERE aggregator_id = '568win' AND external_username = ? LIMIT 1`,
    [username],
  )
  if (used && String(used.user_id) !== userId) throw new Error('568Win username already mapped')

  const [[agent]] = await app.mysql.query<RowDataPacket[]>(
    `SELECT agent_username, currency FROM bg_568win_agent
     WHERE status = 'active' AND currency = ?
     ORDER BY created_at DESC LIMIT 1`,
    [agentCcy],
  )
  if (!agent) throw new Error(`568Win ${agentCcy} agent not found`)

  const result = await (new Win568Client(await getWin568OperationCompanyKey(app))).registerPlayer({
    Username: username,
    Agent: String(agent.agent_username),
    UserGroup: 'a',
  })
  // 4103=User Exists：用户名由 userId 确定性生成，已存在即视为注册过，补写映射即可（302 为历史遗留兼容）
  if (result.error.id !== 0 && result.error.id !== 302 && result.error.id !== 4103) {
    throw new Error(result.error.msg || '568Win register player failed')
  }

  // 存钱包币种(walletCcy)而非 agent 币种：GetBalance/扣款/派彩按此读 bg_wallet（稳定币 1:1 当 USD 玩）
  await app.mysql.execute(
    `INSERT INTO bg_aggregator_player
     (aggregator_id, user_id, external_username, agent_username, currency, raw_response)
     VALUES ('568win', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE external_username = VALUES(external_username),
       agent_username = VALUES(agent_username), currency = VALUES(currency),
       raw_response = VALUES(raw_response), updated_at = NOW(3)`,
    [userId, username, String(agent.agent_username), walletCcy, JSON.stringify(result)],
  )
  return username
}

export async function win568OperationRoutes(app: FastifyInstance) {
  const client = async () => new Win568Client(await getWin568OperationCompanyKey(app))

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
    const result = await (await client()).regenerateCompanyKey(req.body.apiType)
    return reply.send({
      ...result,
      configSection: req.body.apiType === 'Operation' ? 'WIN568_COMPANY_KEY' : 'WIN568_SW_COMPANY_KEY',
    })
  })

  app.post('/key/current', async (_req, reply) => {
    const result = await (await client()).getCurrentCompanyKeyInfo()
    return reply.send(result)
  })

  app.post('/games/sync', async (_req, reply) => {
    const result = await (await client()).getGameList({ GpId: 1, IsGetAll: true })
    const syncedCount = result.error.id === 0 ? await saveWin568Games(app, result) : 0
    if (syncedCount > 0) void probePendingGameIcons(app)
    return reply.send({ error: result.error, serverId: result.serverId, syncedCount })
  })

  app.post('/games/probe-icons', async (_req, reply) => {
    const result = await probePendingGameIcons(app)
    return reply.send(result)
  })

  app.post<{
    Body: { userId: string; device?: string; language?: string; currency?: string }
  }>('/sports/launch', async (req, reply) => {
    if (!req.body.userId) {
      return reply.status(400).send({ error: 'userId is required' })
    }
    const username = await resolveWin568Player(app, req.body.userId, req.body.currency)
    const result = await (await client()).login(buildWin568SportsbookPayload({
      username,
      language: req.body.language,
      device: req.body.device,
    }))
    return reply.send({ ...result, externalUsername: username })
  })

  app.post<{
    Body: { userId: string; gpId?: number; gameId: number; device?: string; language?: string; currency?: string }
  }>('/game/launch', async (req, reply) => {
    const gpId = req.body.gpId === undefined ? null : Number(req.body.gpId)
    const gameId = Number(req.body.gameId)
    if (!req.body.userId || !Number.isInteger(gameId) || (gpId !== null && !Number.isInteger(gpId))) {
      return reply.status(400).send({ error: 'userId and gameId are required' })
    }
    const [[game]] = await app.mysql.query<RowDataPacket[]>(
      `SELECT game_id, game_provider_id, new_game_type FROM bg_568win_game
       WHERE game_id = ? AND (? IS NULL OR game_provider_id = ?) AND is_enabled = 1
       ORDER BY rank_no IS NULL, rank_no ASC
       LIMIT 1`,
      [gameId, gpId, gpId],
    )
    if (!game) return reply.status(404).send({ error: 'game not found' })

    const username = await resolveWin568Player(app, req.body.userId, req.body.currency)
    const result = await (await client()).login(buildWin568LaunchPayload({
      username,
      gameId,
      gpId: Number(game.game_provider_id),
      newGameType: game.new_game_type == null ? null : Number(game.new_game_type),
      language: req.body.language,
      device: req.body.device,
    }))
    return reply.send({ ...result, externalUsername: username, gameId })
  })

  app.post<{
    Body: {
      username: string
      password: string
      currency: 'PHP' | 'USD' | 'USDT' | 'TMP'
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
    const result = await (await client()).registerAgent({
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
    const result = await (await client()).registerPlayer({ Username: username, Agent: req.body.agent, UserGroup: req.body.userGroup ?? 'a' })
    if (result.error.id === 0 || result.error.id === 302 || result.error.id === 4103) {
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
    const result = await (await client()).login(req.body)
    return reply.send(result)
  })

  app.post<{
    Body: { portfolio: string; startDate: string; endDate: string; language?: string; isGetDownline?: boolean }
  }>('/report/modify-date', async (req, reply) => {
    const result = await (await client()).getBetListByModifyDate({
      portfolio: req.body.portfolio,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      language: req.body.language ?? 'en',
      isGetDownline: req.body.isGetDownline ?? false,
    })
    const savedCount = result.error.id === 0 ? await saveReportBets(app, req.body.portfolio, result.result) : 0
    return reply.send({ ...result, savedCount })
  })

  app.post<{
    Body: { portfolio: string; refNos: string | string[]; language?: string }
  }>('/report/refnos', async (req, reply) => {
    const refNos = Array.isArray(req.body.refNos) ? req.body.refNos.join(',') : req.body.refNos
    const result = await (await client()).getBetListByRefNos({
      portfolio: req.body.portfolio,
      refNos,
      language: req.body.language ?? 'en',
    })
    const savedCount = result.error.id === 0 ? await saveReportBets(app, req.body.portfolio, result.result) : 0
    return reply.send({ ...result, savedCount })
  })

  app.post<{
    Body: { portfolio: string; refno: string; language?: string }
  }>('/report/payload', async (req, reply) => {
    const result = await (await client()).getBetPayload({
      Portfolio: req.body.portfolio,
      Refno: req.body.refno,
      Language: req.body.language ?? 'EN',
    })
    return reply.send(result)
  })

  app.post<{
    Body: { txnId: string | string[]; portfolio: string }
  }>('/order/resend', async (req, reply) => {
    const txnId = Array.isArray(req.body.txnId) ? req.body.txnId.join(',') : req.body.txnId
    if (!txnId.trim()) return reply.status(400).send({ error: 'txnId is required' })
    const result = await (await client()).resendOrder({ txnId, portfolio: req.body.portfolio })
    return reply.send(result)
  })
}
