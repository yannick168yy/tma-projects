import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getRedis } from '../clients/redis.client.js'
import { fetchSgGames } from './slotegrator.service.js'

const GAMES_CACHE_KEY = 'games:all'
const GAMES_CACHE_TTL = 30 * 60 // 30 分钟
export const WIN568_SPORTSBOOK_UUID = '568win:sportsbook'

// ── Sync ──────────────────────────────────────────────────────────────────────

function cleanGameName(name: string): string {
  return name.replace(/ mobile/gi, '').trim()
}

export async function stripMobileNamesInDb(env: Env): Promise<void> {
  const db = getMysqlPool(env)
  const [result] = await db.execute(
    `UPDATE sg_games SET name = TRIM(REGEXP_REPLACE(name, '(?i) mobile', '')) WHERE name REGEXP '(?i) mobile'`,
  )
  const changed = (result as { affectedRows: number }).affectedRows
  if (changed > 0) console.log(`[games] stripped "mobile" from ${changed} game names`)
}

export type GamesJobProgressFn = (p: {
  progress: number
  total: number
  message: string
}) => void | Promise<void>

export async function syncAllGames(
  env: Env,
  onProgress?: GamesJobProgressFn,
): Promise<{ synced: number }> {
  const db = getMysqlPool(env)
  let page = 1
  let synced = 0
  let pageCount = 1
  let totalCount = 0

  do {
    const res = await fetchSgGames(env, page)
    pageCount = res._meta.pageCount
    totalCount = res._meta.totalCount

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
          cleanGameName(g.name),
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

    await onProgress?.({
      progress: synced,
      total: totalCount,
      message: `同步第 ${page}/${pageCount} 页`,
    })

    page++
  } while (page <= pageCount)

  return { synced }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface DbGame {
  uuid: string
  aggregator?: 'slotegrator' | '568win'
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  category: string | null
  subCategory: string | null
  sortCategory: string | null
  siteCategory?: string | null
  imageUrl: string | null
  imageHqUrl: string | null
  hasDemo: boolean
  hasLobby: boolean
  isMobile: boolean
  weight: number
  phBonus: number
  isFeatured: boolean
  theme: string | null
  gameStyle: string | null
  playerType: string | null
  releaseDate?: string | null
  maxWinMultiplier?: number | null
  createdAt?: string | null
  supportedCurrencies?: string[] | null
  supportsActiveCurrency?: boolean
}

function parseJsonArray(value: unknown): string[] | null {
  if (value == null) return null
  const parsed = typeof value === 'string' ? (() => {
    try { return JSON.parse(value) } catch { return null }
  })() : value
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : null
}

function normalizeGameCurrency(currency?: string): string | undefined {
  if (!currency) return undefined
  const code = currency.toUpperCase()
  return code === 'UCC' ? 'USDT' : code
}

function supportsCurrency(game: DbGame, currency?: string): boolean {
  const normalized = normalizeGameCurrency(currency)
  if (!normalized) return true
  const supported = game.supportedCurrencies
  if (!supported || supported.length === 0) return true
  const set = new Set(supported.map((c) => normalizeGameCurrency(c) ?? c.toUpperCase()))
  return set.has(normalized)
}

function withCurrencySupport(game: DbGame, currency?: string): DbGame {
  const normalized = normalizeGameCurrency(currency)
  return normalized ? { ...game, supportsActiveCurrency: supportsCurrency(game, normalized) } : game
}

function sortAvailableFirst(games: DbGame[], currency?: string): DbGame[] {
  const normalized = normalizeGameCurrency(currency)
  if (!normalized) return games
  return [...games].sort((a, b) => Number(supportsCurrency(b, normalized)) - Number(supportsCurrency(a, normalized)))
}

function rowToDbGame(r: RowDataPacket): DbGame {
  return {
    uuid: r.uuid as string,
    aggregator: 'slotegrator',
    name: r.name as string,
    nameId: (r.name_id as string) ?? null,
    nameVi: (r.name_vi as string) ?? null,
    nameZh: (r.name_zh as string) ?? null,
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
    theme: (r.theme as string) ?? null,
    gameStyle: (r.game_style as string) ?? null,
    playerType: (r.player_type as string) ?? null,
    supportedCurrencies: null,
  }
}

function sortCategoryFromWin568(newGameType: number | null): string {
  if (newGameType === 203) return 'fishing'
  if (newGameType === 204) return 'table'
  if (newGameType === 300) return 'sports'
  if (newGameType !== null && newGameType >= 100 && newGameType < 200) return 'live'
  if (newGameType !== null && newGameType >= 200 && newGameType < 300) return 'slots'
  return 'other'
}

function rowToWin568Game(r: RowDataPacket): DbGame {
  const newGameType = r.new_game_type == null ? null : Number(r.new_game_type)
  const rank = r.rank_no == null ? 9999 : Number(r.rank_no)
  const name = r.effective_name ?? r.name_en ?? r.name_zh ?? `568Win ${r.game_id}`
  const imageUrl = r.effective_image ?? r.icon_url
  const sortCategory = r.effective_sort_category ?? sortCategoryFromWin568(newGameType)
  return {
    uuid: `568win:${String(r.game_provider_id)}:${String(r.game_id)}`,
    aggregator: '568win',
    name: String(name),
    nameId: null,
    nameVi: null,
    nameZh: r.name_zh ? String(r.name_zh) : null,
    provider: String(r.provider || '568Win'),
    category: newGameType === null ? null : String(newGameType),
    subCategory: null,
    sortCategory: String(sortCategory),
    siteCategory: r.effective_site_category ? String(r.effective_site_category) : null,
    imageUrl: imageUrl ? String(imageUrl) : null,
    imageHqUrl: imageUrl ? String(imageUrl) : null,
    hasDemo: false,
    hasLobby: newGameType === 100 || newGameType === 200,
    isMobile: String(r.device || '').split(',').map((s) => s.trim()).includes('m'),
    weight: r.effective_weight == null ? Math.max(1, 10000 - rank) : Number(r.effective_weight),
    phBonus: r.effective_ph_bonus == null ? 0 : Number(r.effective_ph_bonus),
    isFeatured: Boolean(r.effective_featured),
    theme: r.theme ? String(r.theme) : null,
    gameStyle: r.game_style ? String(r.game_style) : null,
    playerType: r.player_type ? String(r.player_type) : null,
    releaseDate: r.release_date ? new Date(r.release_date as Date).toISOString().slice(0, 10) : null,
    maxWinMultiplier: r.max_win_multiplier == null ? null : Number(r.max_win_multiplier),
    createdAt: r.created_at ? new Date(r.created_at as Date).toISOString() : null,
    supportedCurrencies: parseJsonArray(r.supported_currencies),
  }
}

function win568SportsbookGame(): DbGame {
  return {
    uuid: WIN568_SPORTSBOOK_UUID,
    aggregator: '568win',
    name: '568Win Sports',
    nameId: null,
    nameVi: null,
    nameZh: '568Win 体育',
    provider: '568Win Sports',
    category: 'sportsbook',
    subCategory: null,
    sortCategory: 'sports',
    siteCategory: 'sports',
    imageUrl: null,
    imageHqUrl: null,
    hasDemo: false,
    hasLobby: true,
    isMobile: true,
    weight: 10000,
    phBonus: 0,
    isFeatured: true,
    theme: null,
    gameStyle: null,
    playerType: null,
    supportedCurrencies: ['PHP', 'USDT'],
  }
}

// ── 全量缓存 ──────────────────────────────────────────────────────────────────

export async function loadGamesCache(env: Env): Promise<number> {
  const db = getMysqlPool(env)
  const redis = getRedis(env)
  const [win568Rows] = await db.query<RowDataPacket[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.new_game_type, g.rank_no, g.device,
            g.name_en, g.name_zh, g.icon_url, g.supported_currencies, g.created_at,
            o.release_date, o.max_win_multiplier,
            COALESCE(o.name_override, g.name_en, g.name_zh, CONCAT('568Win ', g.game_id)) AS effective_name,
            COALESCE(o.image_override, g.icon_url) AS effective_image,
            COALESCE(o.weight, GREATEST(1, 10000 - COALESCE(g.rank_no, 9999))) AS effective_weight,
            COALESCE(o.ph_bonus, 0) AS effective_ph_bonus,
            COALESCE(o.is_featured, 0) AS effective_featured,
            o.theme, o.game_style, o.player_type,
            COALESCE(o.site_category, g.site_category_auto, 'other') AS effective_site_category,
            COALESCE(o.sort_category,
              CASE
                WHEN g.new_game_type = 203 THEN 'fishing'
                WHEN g.new_game_type = 204 THEN 'table'
                WHEN g.new_game_type = 300 THEN 'sports'
                WHEN g.new_game_type >= 100 AND g.new_game_type < 200 THEN 'live'
                WHEN g.new_game_type >= 200 AND g.new_game_type < 300 THEN 'slots'
                ELSE 'other'
              END) AS effective_sort_category
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.is_enabled = 1
       AND g.is_maintain = 0
       AND g.provider_status = 'Online'
       AND g.is_provider_online = 1
       AND COALESCE(o.is_active, 1) = 1
       AND COALESCE(o.site_category, g.site_category_auto, 'other') <> 'lobby'
       AND (g.supported_currencies IS NULL
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('PHP'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('USDT'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('UCC')))
       AND (g.device IS NULL OR FIND_IN_SET('m', REPLACE(g.device, ' ', '')) > 0)`,
  )
  const games = [
    win568SportsbookGame(),
    ...(win568Rows as RowDataPacket[]).map(rowToWin568Game),
  ]
  await redis.set(GAMES_CACHE_KEY, JSON.stringify(games), 'EX', GAMES_CACHE_TTL)
  console.log(`[games-cache] cached ${games.length} games`)
  return games.length
}

export async function getGamesFromCache(env: Env): Promise<DbGame[]> {
  const redis = getRedis(env)
  const raw = await redis.get(GAMES_CACHE_KEY)
  if (raw) return JSON.parse(raw) as DbGame[]
  // 缓存不存在时回填
  await loadGamesCache(env)
  const raw2 = await redis.get(GAMES_CACHE_KEY)
  return raw2 ? (JSON.parse(raw2) as DbGame[]) : []
}

// ── 首页推荐：加权随机 + 30 分钟定时刷新 ────────────────────────────────────

const HOMEPAGE_KEY = 'homepage:selection'
const HOMEPAGE_TTL = 3 * 60 * 60 + 5 * 60 // 3h5m（比刷新间隔略长，防止窗口期空缺）

export interface HomepageSelection {
  popular: DbGame[]
  newGames: DbGame[]
  slots: DbGame[]
  casino: DbGame[]
  perya: DbGame[]
  fishing: DbGame[]
  lottery: DbGame[]
  megaWin: DbGame[]
  generatedAt: string
}

export const EMPTY_HOMEPAGE_SELECTION: HomepageSelection = {
  popular: [], newGames: [], slots: [], casino: [], perya: [], fishing: [], lottery: [], megaWin: [],
  generatedAt: '',
}

function serverWeightedSample(
  pool: DbGame[],
  getScore: (g: DbGame) => number,
  n: number,
  maxPerProvider = 2,
): DbGame[] {
  const weighted = pool.map((g) => ({ g, w: Math.pow(Math.max(getScore(g), 0.1), 1.5) }))
  const sampleSize = Math.min(n * 3, weighted.length)
  const candidates: DbGame[] = []
  const rem = [...weighted]

  while (candidates.length < sampleSize && rem.length > 0) {
    const total = rem.reduce((s, x) => s + x.w, 0)
    let rand = Math.random() * total
    let idx = rem.length - 1
    for (let i = 0; i < rem.length; i++) {
      rand -= rem[i].w
      if (rand <= 0) { idx = i; break }
    }
    candidates.push(rem[idx].g)
    rem.splice(idx, 1)
  }

  const result: DbGame[] = []
  const counts = new Map<string, number>()
  for (const g of candidates) {
    if (result.length >= n) break
    const c = counts.get(g.provider) ?? 0
    if (c < maxPerProvider) {
      result.push(g)
      counts.set(g.provider, c + 1)
    }
  }
  return result
}

export async function refreshHomepageSelection(env: Env): Promise<void> {
  const redis = getRedis(env)
  const all = await getGamesFromCache(env)
  if (!all.length) return

  const seen = new Set<string>()
  const pick = (pool: DbGame[], score: (g: DbGame) => number, n: number) => {
    const r = serverWeightedSample(pool.filter((g) => !seen.has(g.uuid)), score, n)
    r.forEach((g) => seen.add(g.uuid))
    return r
  }
  const bySite = (cat: string) => all.filter((g) => g.siteCategory === cat)
  const score = (g: DbGame) => g.weight * (g.isFeatured ? 1.5 : 1)
  // ph_bonus 只覆盖头部富化池，其余游戏按上游 rank 派生的 weight 降级打分
  const popularScore = (g: DbGame) => (g.phBonus > 0 ? g.phBonus * 100 : g.weight / 100) * (g.isFeatured ? 1.5 : 1)

  // New Games：有 release_date 的按发布日期降序取最新的一批做抽样池
  const newPool = all
    .filter((g) => g.releaseDate)
    .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
    .slice(0, 40)

  const selection: HomepageSelection = {
    popular:  pick(all, popularScore, 9),
    newGames: pick(newPool, score, 12),
    slots:    pick(bySite('slot'), score, 6),
    casino:   pick(bySite('casino'), score, 6),
    perya:    pick(bySite('perya'), score, 12),
    fishing:  pick(bySite('fishing'), score, 6),
    lottery:  pick(bySite('lottery'), score, 12),
    megaWin:  pick(all.filter((g) => (g.maxWinMultiplier ?? 0) >= 1000), score, 6),
    generatedAt: new Date().toISOString(),
  }

  await redis.set(HOMEPAGE_KEY, JSON.stringify(selection), 'EX', HOMEPAGE_TTL)
  console.log('[homepage] selection refreshed')
}

export async function getHomepageSelection(env: Env): Promise<HomepageSelection | null> {
  const redis = getRedis(env)
  const raw = await redis.get(HOMEPAGE_KEY)
  if (raw) return JSON.parse(raw) as HomepageSelection
  // 缓存不存在则立即生成
  await refreshHomepageSelection(env)
  const raw2 = await redis.get(HOMEPAGE_KEY)
  return raw2 ? (JSON.parse(raw2) as HomepageSelection) : null
}

export function applyHomepageCurrency(selection: HomepageSelection, currency?: string): HomepageSelection {
  const apply = (games: DbGame[]) => sortAvailableFirst(games, currency).map((g) => withCurrencySupport(g, currency))
  return {
    popular: apply(selection.popular),
    newGames: apply(selection.newGames ?? []),
    slots: apply(selection.slots),
    casino: apply(selection.casino ?? []),
    perya: apply(selection.perya ?? []),
    fishing: apply(selection.fishing),
    lottery: apply(selection.lottery ?? []),
    megaWin: apply(selection.megaWin ?? []),
    generatedAt: selection.generatedAt,
  }
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
    siteCategory?: string
    sortBy?: 'weight' | 'ph_bonus' | 'name'
    themes?: string[]
    gameStyles?: string[]
    playerTypes?: string[]
    currency?: string
  } = {},
): Promise<GameListResult> {
  const { page = 1, limit = 30, search, provider, category, sortCategory, siteCategory, sortBy = 'weight',
    themes, gameStyles, playerTypes, currency } = opts

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
    const cats = new Set(sortCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.sortCategory !== null && cats.has(g.sortCategory))
  }
  if (siteCategory && siteCategory !== 'all') {
    const cats = new Set(siteCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.siteCategory != null && cats.has(g.siteCategory))
  }
  if (themes && themes.length > 0) {
    const set = new Set(themes)
    games = games.filter((g) => g.theme !== null && set.has(g.theme))
  }
  if (gameStyles && gameStyles.length > 0) {
    const set = new Set(gameStyles)
    games = games.filter((g) => g.gameStyle !== null && set.has(g.gameStyle))
  }
  if (playerTypes && playerTypes.length > 0) {
    const set = new Set(playerTypes)
    games = games.filter((g) => g.playerType !== null && set.has(g.playerType))
  }

  games = [...games].sort((a, b) => {
    if (sortBy === 'ph_bonus') return (b.phBonus - a.phBonus) || (b.weight - a.weight)
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    return (b.weight - a.weight) || (b.phBonus - a.phBonus)
  })

  const availableTotal = games.filter((g) => supportsCurrency(g, currency)).length
  games = sortAvailableFirst(games, currency).map((g) => withCurrencySupport(g, currency))
  const total = currency ? availableTotal : games.length
  const offset = (page - 1) * limit

  return {
    items: games.slice(offset, offset + limit),
    total,
    page,
    pages: Math.ceil(games.length / limit),
  }
}

export interface GameHistoryItem {
  uuid: string
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
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
    `SELECT * FROM (
       SELECT b.provider_id AS game_uuid,
              g.name, g.name_id, g.name_vi, g.name_zh,
              g.provider, g.image_url, g.image_hq_url,
              MAX(b.created_at) AS last_played_at
       FROM bg_bet_order b
       JOIN sg_games g ON g.uuid = b.provider_id
       WHERE b.user_id = ? AND b.aggregator_id = 'slotegrator'
       GROUP BY b.provider_id, g.name, g.name_id, g.name_vi, g.name_zh, g.provider, g.image_url, g.image_hq_url
       UNION ALL
       SELECT CONCAT('568win:', w.game_provider_id, ':', w.game_id) AS game_uuid,
              COALESCE(o.name_override, w.name_en, w.name_zh, CONCAT('568Win ', w.game_id)) AS name,
              NULL AS name_id, NULL AS name_vi, w.name_zh,
              COALESCE(w.provider, '568Win') AS provider,
              COALESCE(o.image_override, w.icon_url) AS image_url,
              COALESCE(o.image_override, w.icon_url) AS image_hq_url,
              MAX(b.created_at) AS last_played_at
       FROM bg_bet_order b
       JOIN bg_568win_game w ON w.game_id = CAST(b.provider_id AS UNSIGNED)
       LEFT JOIN bg_568win_game_override o ON o.game_provider_id = w.game_provider_id AND o.game_id = w.game_id
       WHERE b.user_id = ? AND b.aggregator_id = '568win'
         AND b.provider_id REGEXP '^[0-9]+$'
       GROUP BY w.game_provider_id, w.game_id, o.name_override, w.name_en, w.name_zh, w.provider, o.image_override, w.icon_url
     ) t
     ORDER BY last_played_at DESC
     LIMIT ?`,
    [userId, userId, limit],
  )
  return rows.map((r) => ({
    uuid: r.game_uuid as string,
    name: r.name as string,
    nameId: (r.name_id as string) ?? null,
    nameVi: (r.name_vi as string) ?? null,
    nameZh: (r.name_zh as string) ?? null,
    provider: r.provider as string,
    imageUrl: r.image_url ? String(r.image_url) : null,
    imageHqUrl: r.image_hq_url ? String(r.image_hq_url) : null,
    lastPlayedAt: new Date(r.last_played_at as Date).toISOString(),
  }))
}

/** Returns distinct provider codes from cached games, optionally filtered by sortCategory / siteCategory (comma-separated) */
export async function listProviders(env: Env, sortCategory?: string, siteCategory?: string): Promise<string[]> {
  let games = await getGamesFromCache(env)
  if (sortCategory && sortCategory !== 'all') {
    const cats = new Set(sortCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.sortCategory !== null && cats.has(g.sortCategory))
  }
  if (siteCategory && siteCategory !== 'all') {
    const cats = new Set(siteCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.siteCategory != null && cats.has(g.siteCategory))
  }
  const providers = [...new Set(games.map((g) => g.provider))].sort()
  return providers
}

/** Returns distinct theme values from cache, sorted by game count desc */
export async function listThemes(env: Env): Promise<string[]> {
  const games = await getGamesFromCache(env)
  const counts = new Map<string, number>()
  for (const g of games) {
    if (!g.theme) continue
    counts.set(g.theme, (counts.get(g.theme) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([theme]) => theme)
}
