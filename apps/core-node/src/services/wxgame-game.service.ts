import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader } from 'mysql2/promise'
import { WxgameClient, type WxgameGame } from '../clients/wxgame.client.js'

export const WXGAME_UUID_PREFIX = 'wxgame'

// 官方 supplier 表标注支持「高爆」(点控 RTP) 的厂商，约占全部游戏的三分之一。
// 其余厂商上游标注「更新中」，set_player_rtp 对它们无效 —— 后台要据此把不受控的
// 游戏标出来，否则运营会误以为全站都能点控。
const RTP_SUPPORTED_BRANDS = new Set([
  'pg', 'jili', 'spribe', 'inout', 'yono', 'tada', 'jdb', 'fachai',
  '3oaks', 'popok', 'bg', 'pragmatic', 'jili-fish',
])

export interface WxgameGameRef {
  gameBrand: string
  gameId: string
}

// uuid 形如 wxgame:<brand>:<gameId>。不能用 split(':') —— 上游 gameId 自身含冒号
// （如 TombstoneSlaughter:ElGordo'sRevenge），split 会把游戏名截断成不存在的 id。
export function parseWxgameUuid(uuid: string): WxgameGameRef | null {
  const first = uuid.indexOf(':')
  if (first < 0 || uuid.slice(0, first) !== WXGAME_UUID_PREFIX) return null
  const second = uuid.indexOf(':', first + 1)
  if (second < 0) return null
  const gameBrand = uuid.slice(first + 1, second)
  const gameId = uuid.slice(second + 1)
  return gameBrand && gameId ? { gameBrand, gameId } : null
}

export function wxgameUuid(ref: WxgameGameRef): string {
  return `${WXGAME_UUID_PREFIX}:${ref.gameBrand}:${ref.gameId}`
}

// 厂商代码在官方文档三处写法不一（sheet 名 PG / supplier 表 pg / icon 路径 /assets/PG/），
// 接口示例用小写，统一收敛到小写再入库。
function normalizeBrand(brand: string): string {
  return String(brand || '').trim().toLowerCase()
}

export async function saveWxgameGames(app: FastifyInstance, games: WxgameGame[]): Promise<number> {
  if (games.length === 0) return 0
  const rows = games.map((g) => {
    const gameBrand = normalizeBrand(g.gameBrand)
    return [
      gameBrand,
      String(g.gameId ?? ''),
      g.gameName ?? null,
      g.gameFullName ?? null,
      g.gameType ?? null,
      g.gameIcon ?? null,
      g.status === 'ENABLE' ? 1 : 0,
      RTP_SUPPORTED_BRANDS.has(gameBrand) ? 1 : 0,
      JSON.stringify(g),
    ]
  }).filter((r) => r[0] && r[1])

  if (rows.length === 0) return 0
  // icon_local 不在这里写：那是我方把图抓回 OSS 后的地址，用 VALUES 覆盖会把已抓好的刷成 NULL。
  const [res] = await app.mysql.query<ResultSetHeader>(
    `INSERT INTO bg_wxgame_game
       (game_brand, game_id, name_en, name_full, game_type, icon_url, is_enabled, supports_rtp, raw_game)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       name_en = VALUES(name_en), name_full = VALUES(name_full),
       game_type = VALUES(game_type), icon_url = VALUES(icon_url),
       is_enabled = VALUES(is_enabled), supports_rtp = VALUES(supports_rtp),
       raw_game = VALUES(raw_game), synced_at = NOW(3)`,
    [rows],
  )
  return res.affectedRows
}

export async function syncWxgameGames(app: FastifyInstance): Promise<number> {
  const result = await new WxgameClient().getGameList()
  if (result.code !== 0) {
    app.log.error({ code: result.code, msg: result.msg }, '[wxgame-game-sync] upstream error')
    return 0
  }
  const games = result.data?.gameList ?? []
  const saved = await saveWxgameGames(app, games)
  app.log.info({ received: games.length, saved }, '[wxgame-game-sync] done')
  return saved
}
