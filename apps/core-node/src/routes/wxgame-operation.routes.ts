import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { env } from '../config/env.js'
import { WxgameClient } from '../clients/wxgame.client.js'
import { issueLaunchToken } from '../services/wxgame-launch.service.js'
import { ensureWxgamePlayer } from '../services/wxgame-player.service.js'
import { saveWxgameGames } from '../services/wxgame-game.service.js'
import { getPlayerRtp, isValidRtpTier, setPlayerRtp, unsetPlayerRtp, WXGAME_RTP_TIERS } from '../services/wxgame-rtp.service.js'

// 上游只支持这几种语言（官方游戏表），没有中文。我方 bg_user.locale 是 en/id/vi/zh-CN，
// zh-CN 只能落到 en。映射不到一律 en，而不是把原值透传上去让对方报错。
const LANGUAGE: Record<string, string> = {
  en: 'en-US', id: 'id-ID', vi: 'vi-VN', th: 'th-TH',
  es: 'es-ES', pt: 'pt-PT', ru: 'ru-RU',
}

function toUpstreamLanguage(locale?: string): string {
  if (!locale) return 'en-US'
  return LANGUAGE[locale.toLowerCase().split('-')[0]] ?? 'en-US'
}

export async function wxgameOperationRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const token = req.headers['x-internal-token']
    if (!env.INTERNAL_TOKEN || token !== env.INTERNAL_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  app.post<{
    Body: { userId: string; gameBrand: string; gameId: string; language?: string; currency?: string; homeUrl?: string }
  }>('/game/launch', async (req, reply) => {
    const { userId, gameBrand, gameId } = req.body ?? {}
    if (!userId || !gameBrand || !gameId) {
      return reply.status(400).send({ error: 'userId, gameBrand and gameId are required' })
    }

    // 上游维护中/下架的游戏在这里就拦掉，别让玩家点进去白屏
    const [[game]] = await app.mysql.query<RowDataPacket[]>(
      `SELECT game_id FROM bg_wxgame_game
       WHERE game_brand = ? AND game_id = ? AND is_enabled = 1 AND is_maintain = 0 LIMIT 1`,
      [gameBrand, gameId],
    )
    if (!game) return reply.status(404).send({ error: 'game not found or unavailable' })

    const currency = req.body.currency || env.WXGAME_DEFAULT_CURRENCY
    const player = await ensureWxgamePlayer(app, userId, currency)

    // 先发 token 再调上游：上游收到 get_game_url 后会立刻回调我方 /verify，
    // token 没写进 Redis 就调，会撞上 verify 查不到而返 1006 的竞态。
    const token = await issueLaunchToken(app, {
      userId, playerId: player.playerId, currency: player.currency, gameBrand, gameId,
    })

    const result = await new WxgameClient().getGameUrl({
      token, gameId, gameBrand,
      language: toUpstreamLanguage(req.body.language),
      homeUrl: req.body.homeUrl,
    })
    if (result.code !== 0 || !result.data) {
      app.log.error({ code: result.code, msg: result.msg, requestId: result.requestId, gameBrand, gameId },
        '[wxgame] get_game_url failed')
      return reply.status(502).send({ error: result.msg || 'failed to get game url', code: result.code })
    }
    return reply.send({ url: result.data, playerId: player.playerId })
  })

  app.get('/rtp/tiers', async () => ({ tiers: WXGAME_RTP_TIERS, merchantType: 'regular' }))

  app.post('/games/sync', async (_req, reply) => {
    const result = await new WxgameClient().getGameList()
    if (result.code !== 0) return reply.status(502).send({ error: result.msg || '游戏目录同步失败' })
    const games = result.data?.gameList ?? []
    await saveWxgameGames(app, games)
    return { received: games.length }
  })

  app.post<{ Body: { userIds: string[]; rtp: string; operatorId: string; reason?: string } }>(
    '/rtp/set', async (req, reply) => {
      const { userIds, rtp, operatorId } = req.body ?? {}
      if (!Array.isArray(userIds) || userIds.length === 0 || !operatorId) {
        return reply.status(400).send({ error: 'userIds and operatorId are required' })
      }
      if (!isValidRtpTier(rtp)) {
        // 常规户传 100 以上上游会返 1021，这里先挡住并把原因说清楚
        return reply.status(400).send({ error: `invalid rtp tier; allowed: ${WXGAME_RTP_TIERS.join(', ')} (regular merchant)` })
      }
      const result = await setPlayerRtp(app, userIds, rtp, operatorId, req.body.reason ?? null)
      return reply.send(result)
    })

  app.post<{ Body: { userIds: string[] } }>('/rtp/unset', async (req, reply) => {
    const { userIds } = req.body ?? {}
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({ error: 'userIds is required' })
    }
    return reply.send(await unsetPlayerRtp(app, userIds))
  })

  app.post<{ Body: { userIds: string[] } }>('/rtp/query', async (req, reply) => {
    const { userIds } = req.body ?? {}
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({ error: 'userIds is required' })
    }
    try {
      return reply.send({ items: await getPlayerRtp(app, userIds) })
    } catch (e) {
      return reply.status(502).send({ error: e instanceof Error ? e.message : 'query failed' })
    }
  })
}
