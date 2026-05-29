import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { fetchSgGames } from './slotegrator.service.js'

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
          g.type ?? null,
          g.provider,
          g.provider_id ?? null,
          g.technology ?? null,
          g.category ?? null,
          g.sub_category ?? null,
          g.image ?? null,
          hqImage,
          g.has_demo ? 1 : 0,
          g.has_lobby ? 1 : 0,
          isMobile ? 1 : 0,
          g.has_freespins ? 1 : 0,
          g.has_tables ? 1 : 0,
          g.label ?? null,
          g.parameters?.rtp ?? null,
          g.parameters?.volatility ?? null,
          g.parameters?.reels_count ?? null,
          g.parameters?.lines_count ?? null,
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
  imageUrl: string | null
  hasDemo: boolean
  hasLobby: boolean
  isMobile: boolean
}

export interface GameListResult {
  items: DbGame[]
  total: number
  page: number
  pages: number
}

export async function listGames(
  env: Env,
  opts: { page?: number; limit?: number; search?: string; provider?: string; category?: string } = {},
): Promise<GameListResult> {
  const db = getMysqlPool(env)
  const { page = 1, limit = 30, search, provider, category } = opts
  const offset = (page - 1) * limit

  const conds: string[] = ['is_active = 1']
  const vals: unknown[] = []

  if (search) {
    conds.push('(name LIKE ? OR provider LIKE ?)')
    vals.push(`%${search}%`, `%${search}%`)
  }
  if (provider && provider !== 'all') {
    conds.push('provider = ?')
    vals.push(provider)
  }
  if (category && category !== 'all') {
    conds.push('category = ?')
    vals.push(category)
  }

  const where = `WHERE ${conds.join(' AND ')}`

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM sg_games ${where}`,
    vals,
  )

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT uuid, name, provider, category, sub_category, image_url, has_demo, has_lobby, is_mobile
     FROM sg_games ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [...vals, limit, offset],
  )

  return {
    items: rows.map((r) => ({
      uuid: r.uuid as string,
      name: r.name as string,
      provider: r.provider as string,
      category: (r.category as string) ?? null,
      subCategory: (r.sub_category as string) ?? null,
      imageUrl: (r.image_url as string) ?? null,
      hasDemo: Boolean(r.has_demo),
      hasLobby: Boolean(r.has_lobby),
      isMobile: Boolean(r.is_mobile),
    })),
    total: Number(total),
    page,
    pages: Math.ceil(Number(total) / limit),
  }
}

/** Returns distinct provider codes from cached games */
export async function listProviders(env: Env): Promise<string[]> {
  const db = getMysqlPool(env)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT provider FROM sg_games ORDER BY provider ASC`,
  )
  return rows.map((r) => r.provider as string)
}
