import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getRedis } from '../clients/redis.client.js'
import { fetchSgGames } from './slotegrator.service.js'

const GAMES_CACHE_KEY = 'games:all'
const GAMES_CACHE_TTL = 30 * 60 // 30 分钟

// ── Sync ──────────────────────────────────────────────────────────────────────

export async function syncAllGames(env: Env): Promise<{ synced: number }> {
  const db = getMysqlPool(env)
  let page = 1
  let synced = 0
  let pageCount = 1

  do {
    const res = await fetchSgGames(env, page)
    pageCount = res._meta.pageCount

    for (const g of res.items) {
      const isMobile = g.is_mobile ?? g.mobile ?? 0
      const tags = g.tags?.length
        ? JSON.stringify(g.tags.map((t) => (typeof t === 'string' ? t : t.code)))
        : null
      const hqImage = g.images?.find((i) => i.type === 'high-quality')?.url ?? null

      await db.execute(
        `INSERT INTO sg_games
           (uuid, name, type, provider, provider_id, technology,
            category, sub_category, image_url, image_hq_url,
            has_demo, has_lobby, is_mobile, has_freespins, has_tables,
            label, rtp, volatility, reels_count, lines_count, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name=VALUES(name), type=VALUES(type),
           provider=VALUES(provider), provider_id=VALUES(provider_id), technology=VALUES(technology),
           category=VALUES(category), sub_category=VALUES(sub_category),
           image_url=VALUES(image_url), image_hq_url=VALUES(image_hq_url),
           has_demo=VALUES(has_demo), has_lobby=VALUES(has_lobby), is_mobile=VALUES(is_mobile),
           has_freespins=VALUES(has_freespins), has_tables=VALUES(has_tables),
           label=VALUES(label), rtp=VALUES(rtp), volatility=VALUES(volatility),
           reels_count=VALUES(reels_count), lines_count=VALUES(lines_count),
           tags=VALUES(tags), updated_at=NOW(3)`,
        [
          g.uuid,
          g.name,
          g.type || null,
          g.provider,
          g.provider_id != null && g.provider_id !== '' ? Number(g.provider_id) : null,
          g.technology || null,
          g.category || null,
          g.sub_category || null,
          g.image || null,
          hqImage,
          g.has_demo ? 1 : 0,
          g.has_lobby ? 1 : 0,
          isMobile ? 1 : 0,
          g.has_freespins ? 1 : 0,
          g.has_tables ? 1 : 0,
          g.label || null,
          g.parameters?.rtp != null && g.parameters.rtp !== '' ? Number(g.parameters.rtp) : null,
          g.parameters?.volatility || null,
          g.parameters?.reels_count || null,
          g.parameters?.lines_count != null && g.parameters.lines_count !== '' ? Number(g.parameters.lines_count) : null,
          tags,
        ],
      )
      synced++
    }

    page++
  } while (page <= pageCount)

  return { synced }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface DbGame {
  uuid: string
  name: string
  provider: string
  category: string | null
  subCategory: string | null
  sortCategory: string | null
  imageUrl: string | null
  imageHqUrl: string | null
  hasDemo: boolean
  hasLobby: boolean
  isMobile: boolean
  weight: number
  phBonus: number
  isFeatured: boolean
}

function rowToDbGame(r: RowDataPacket): DbGame {
  return {
    uuid: r.uuid as string,
    name: r.name as string,
    provider: r.provider as string,
    category: (r.category as string) ?? null,
    subCategory: (r.sub_category as string) ?? null,
    sortCategory: (r.sort_category as string) ?? null,
    imageUrl: (r.image_url as string) ?? null,
    imageHqUrl: (r.image_hq_url as string) ?? null,
    hasDemo: Boolean(r.has_demo),
    hasLobby: Boolean(r.has_lobby),
    isMobile: Boolean(r.is_mobile),
    weight: r.weight != null ? Number(r.weight) : 0,
    phBonus: r.ph_bonus != null ? Number(r.ph_bonus) : 0,
    isFeatured: Boolean(r.is_featured),
  }
}

// ── 全量缓存 ──────────────────────────────────────────────────────────────────

export async function loadGamesCache(env: Env): Promise<number> {
  const db = getMysqlPool(env)
  const redis = getRedis(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT uuid, name, provider, category, sub_category, sort_category,
            image_url, image_hq_url, has_demo, has_lobby, is_mobile,
            weight, ph_bonus, is_featured
     FROM sg_games WHERE is_active = 1`,
  )
  const games = (rows as RowDataPacket[]).map(rowToDbGame)
  await redis.set(GAMES_CACHE_KEY, JSON.stringify(games), 'EX', GAMES_CACHE_TTL)
  console.log(`[games-cache] cached ${games.length} games`)
  return games.length
}

async function getGamesFromCache(env: Env): Promise<DbGame[]> {
  const redis = getRedis(env)
  const raw = await redis.get(GAMES_CACHE_KEY)
  if (raw) return JSON.parse(raw) as DbGame[]
  // 缓存不存在时回填
  await loadGamesCache(env)
  const raw2 = await redis.get(GAMES_CACHE_KEY)
  return raw2 ? (JSON.parse(raw2) as DbGame[]) : []
}

export interface GameListResult {
  items: DbGame[]
  total: number
  page: number
  pages: number
}

export async function listGames(
  env: Env,
  opts: {
    page?: number
    limit?: number
    search?: string
    provider?: string
    category?: string
    sortCategory?: string
    sortBy?: 'weight' | 'ph_bonus' | 'name'
  } = {},
): Promise<GameListResult> {
  const { page = 1, limit = 30, search, provider, category, sortCategory, sortBy = 'weight' } = opts

  let games = await getGamesFromCache(env)

  if (search) {
    const s = search.toLowerCase()
    games = games.filter((g) => g.name.toLowerCase().includes(s) || g.provider.toLowerCase().includes(s))
  }
  if (provider && provider !== 'all') {
    games = games.filter((g) => g.provider === provider)
  }
  if (category && category !== 'all') {
    games = games.filter((g) => g.category === category)
  }
  if (sortCategory && sortCategory !== 'all') {
    games = games.filter((g) => g.sortCategory === sortCategory)
  }

  games = [...games].sort((a, b) => {
    if (sortBy === 'ph_bonus') return (b.phBonus - a.phBonus) || (b.weight - a.weight)
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    return (b.weight - a.weight) || (b.phBonus - a.phBonus)
  })

  const total = games.length
  const offset = (page - 1) * limit

  return {
    items: games.slice(offset, offset + limit),
    total,
    page,
    pages: Math.ceil(total / limit),
  }
}

export interface GameHistoryItem {
  uuid: string
  name: string
  provider: string
  imageUrl: string | null
  imageHqUrl: string | null
  lastPlayedAt: string
}

export async function getUserGameHistory(
  env: Env,
  userId: string,
  limit = 10,
): Promise<GameHistoryItem[]> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT b.provider_id AS game_uuid,
            g.name, g.provider, g.image_url, g.image_hq_url,
            MAX(b.created_at) AS last_played_at
     FROM bg_bet_order b
     JOIN sg_games g ON g.uuid = b.provider_id
     WHERE b.user_id = ? AND b.aggregator_id = 'slotegrator'
     GROUP BY b.provider_id, g.name, g.provider, g.image_url, g.image_hq_url
     ORDER BY last_played_at DESC
     LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    uuid: r.game_uuid as string,
    name: r.name as string,
    provider: r.provider as string,
    imageUrl: r.image_url ? String(r.image_url) : null,
    imageHqUrl: r.image_hq_url ? String(r.image_hq_url) : null,
    lastPlayedAt: new Date(r.last_played_at as Date).toISOString(),
  }))
}

/** Returns distinct provider codes from cached games */
export async function listProviders(env: Env): Promise<string[]> {
  const db = getMysqlPool(env)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT provider FROM sg_games ORDER BY provider ASC`,
  )
  return rows.map((r) => r.provider as string)
}
