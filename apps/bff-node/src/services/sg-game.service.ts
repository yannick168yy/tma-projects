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
  imageAnim?: string | null
  imageSource?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
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
  // 宽高是对上游 icon_url 探测的结果，运营覆盖图（image_override）与之不同时不下发
  const probedDims = imageUrl != null && imageUrl === r.icon_url && r.icon_width != null && r.icon_height != null
  const sortCategory = r.effective_sort_category ?? sortCategoryFromWin568(newGameType)
  const devices = String(r.device || '').split(/[,/]/).map((s) => s.trim())
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
    imageAnim: r.image_anim ? String(r.image_anim) : null,
    imageSource: r.effective_image_source ? String(r.effective_image_source) : null,
    imageWidth: probedDims ? Number(r.icon_width) : null,
    imageHeight: probedDims ? Number(r.icon_height) : null,
    hasDemo: false,
    hasLobby: newGameType === 100 || newGameType === 200,
    isMobile: devices.includes('m'),
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
            g.name_en, g.name_zh, g.icon_url, g.icon_width, g.icon_height, g.supported_currencies, g.created_at,
            o.release_date, o.max_win_multiplier,
            COALESCE(o.name_override, g.name_en, g.name_zh, CONCAT('568Win ', g.game_id)) AS effective_name,
            -- 封面优先级：后台手动覆盖 > playtime > fbmplay > bingoplus > 568win 上游原图
            COALESCE(o.image_override, cp.url, cf.url, cb.url, g.icon_url) AS effective_image,
            CASE
              WHEN o.image_override IS NOT NULL THEN o.image_override_source
              WHEN cp.url IS NOT NULL THEN 'playtime'
              WHEN cf.url IS NOT NULL THEN 'fbmplay'
              WHEN cb.url IS NOT NULL THEN 'bingoplus'
              ELSE NULL
            END AS effective_image_source,
            CASE
              WHEN o.image_override IS NOT NULL THEN o.image_anim
              WHEN cp.url IS NOT NULL THEN cp.anim_url
              ELSE NULL
            END AS image_anim,
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
     LEFT JOIN bg_568win_game_cover_candidate cf ON cf.game_provider_id = g.game_provider_id AND cf.game_id = g.game_id AND cf.source = 'fbmplay'
     LEFT JOIN bg_568win_game_cover_candidate cb ON cb.game_provider_id = g.game_provider_id AND cb.game_id = g.game_id AND cb.source = 'bingoplus'
     LEFT JOIN bg_568win_game_cover_candidate cp ON cp.game_provider_id = g.game_provider_id AND cp.game_id = g.game_id AND cp.source = 'playtime'
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
       AND (g.device IS NULL OR FIND_IN_SET('m', REPLACE(REPLACE(g.device, ' ', ''), '/', ',')) > 0)`,
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
  highRebate: DbGame[]
  newGames: DbGame[]
  slots: DbGame[]
  casino: DbGame[]
  perya: DbGame[]
  fishing: DbGame[]
  lottery: DbGame[]
  mythology: DbGame[]
  megaWin: DbGame[]
  generatedAt: string
}

export const EMPTY_HOMEPAGE_SELECTION: HomepageSelection = {
  popular: [], highRebate: [], newGames: [], slots: [], casino: [], perya: [], fishing: [], lottery: [], mythology: [], megaWin: [],
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

// 首页选品按币种预生成：切币种后整页几乎全灰的根因是选品与币种无关，
// 抽样池天然被 PHP 主导。这里对每个币种各建一份池（先按币种过滤再抽），
// 保证 USDT 首页也填满可用游戏，而不是靠前端给固定选品打 unavailable 标记。
const HOMEPAGE_CURRENCIES = ['PHP', 'USDT'] as const

function homepageBucket(currency?: string): string {
  return normalizeGameCurrency(currency) === 'USDT' ? 'USDT' : 'PHP'
}

// 板块手动干预（Phase A）：策略打底，pin/exclude 微调
export interface SectionGameEntry {
  gameUuid: string
  action: 'pin' | 'exclude'
  pinPosition: number | null
  currency: string // '' | 'PHP' | 'USDT'
  sortOrder: number
}
export type SectionOverrides = Map<string, SectionGameEntry[]>

export async function loadSectionOverrides(env: Env): Promise<SectionOverrides> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT section_key, game_uuid, action, pin_position, currency, sort_order
     FROM bg_homepage_section_game
     ORDER BY sort_order ASC, id ASC`,
  )
  const map: SectionOverrides = new Map()
  for (const r of rows) {
    const key = r.section_key as string
    const list = map.get(key) ?? []
    list.push({
      gameUuid: r.game_uuid as string,
      action: r.action as 'pin' | 'exclude',
      pinPosition: r.pin_position == null ? null : Number(r.pin_position),
      currency: (r.currency as string) ?? '',
      sortOrder: Number(r.sort_order ?? 0),
    })
    map.set(key, list)
  }
  return map
}

function buildHomepageSelection(all: DbGame[], cur: string, overrides: SectionOverrides): HomepageSelection {
  const gameByUuid = new Map(all.map((g) => [g.uuid, g]))
  const entriesFor = (key: string) =>
    (overrides.get(key) ?? []).filter((e) => e.currency === '' || e.currency === cur)

  // pin/exclude 合并：先按当前币种筛出该板块的干预项；exclude 已在池层剔除，
  // 这里负责把 pin 的游戏插到指定位置（pin 不占厂商配额、可越过策略打底）。
  const applyManual = (key: string, list: DbGame[], target: number): DbGame[] => {
    const entries = entriesFor(key)
    if (!entries.length) return list
    const ex = new Set(entries.filter((e) => e.action === 'exclude').map((e) => e.gameUuid))
    const pins = entries
      .filter((e) => e.action === 'pin')
      .map((e) => ({ e, g: gameByUuid.get(e.gameUuid) }))
      .filter((x): x is { e: SectionGameEntry; g: DbGame } => !!x.g && !ex.has(x.e.gameUuid))
    const pinnedUuids = new Set(pins.map((x) => x.e.gameUuid))
    // 无 pin_position 的 pin 前插（按 sort_order），有位置的按位置插入
    const floating = pins.filter((x) => x.e.pinPosition == null).sort((a, b) => a.e.sortOrder - b.e.sortOrder)
    let result = [...floating.map((x) => x.g), ...list.filter((g) => !ex.has(g.uuid) && !pinnedUuids.has(g.uuid))]
    const positioned = pins.filter((x) => x.e.pinPosition != null).sort((a, b) => a.e.pinPosition! - b.e.pinPosition!)
    for (const x of positioned) {
      const idx = Math.min(Math.max(x.e.pinPosition! - 1, 0), result.length)
      result.splice(idx, 0, x.g)
    }
    return result.slice(0, target)
  }

  const seen = new Set<string>()
  const pick = (pool: DbGame[], score: (g: DbGame) => number, n: number) => {
    const r = serverWeightedSample(pool.filter((g) => !seen.has(g.uuid)), score, n)
    r.forEach((g) => seen.add(g.uuid))
    return r
  }
  // 确定性 top-N：按 score 降序钉死前 N，仅按厂商去重（龙头厂商放宽到 maxPerProvider）
  const pickTop = (pool: DbGame[], score: (g: DbGame) => number, n: number, maxPerProvider = 3) => {
    const sorted = pool.filter((g) => !seen.has(g.uuid)).sort((a, b) => score(b) - score(a))
    const result: DbGame[] = []
    const counts = new Map<string, number>()
    for (const g of sorted) {
      if (result.length >= n) break
      const c = counts.get(g.provider) ?? 0
      if (c < maxPerProvider) { result.push(g); counts.set(g.provider, c + 1); seen.add(g.uuid) }
    }
    return result
  }
  const bySite = (cat: string) => all.filter((g) => g.siteCategory === cat)
  const score = (g: DbGame) => g.weight * (g.isFeatured ? 1.5 : 1)

  // New Games：有 release_date 的按发布日期降序取最新的一批做抽样池
  const newPool = all
    .filter((g) => g.releaseDate)
    .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
    .slice(0, 40)

  // popular 从核心池(is_featured=竞品验证的爆款)加权抽，模仿竞品精选运营位；
  // 不从全库抽——数量占优的中腰部竞品游戏会在加权随机里淹没头部爆款
  const featuredPool = all.filter((g) => g.isFeatured)

  // exclude 在策略抽样前从池里剔除（保证板块仍取满 N）；pin 在抽样后合并进结果
  const exFilter = (key: string, pool: DbGame[]) => {
    const ex = new Set(entriesFor(key).filter((e) => e.action === 'exclude').map((e) => e.gameUuid))
    return ex.size ? pool.filter((g) => !ex.has(g.uuid)) : pool
  }
  const sampleSection = (key: string, pool: DbGame[], sc: (g: DbGame) => number, n: number) =>
    applyManual(key, pick(exFilter(key, pool), sc, n), n)
  const topSection = (key: string, pool: DbGame[], sc: (g: DbGame) => number, n: number, mpp = 3) =>
    applyManual(key, pickTop(exFilter(key, pool), sc, n, mpp), n)

  // popular 混排：纯按热度排会被 slots 屠版、单厂商还能占 3 席。改为保底 1 个真人娱乐
  // 席位(插到第3位保证露出) + 其余按热度补足、每厂商≤2，让首屏像竞品那样有品类层次。
  // 体育合成条目(isFeatured=true, weight=10000)会漏进 popular，它有专属体育通栏，从热门剔除
  const notSports = (g: DbGame) => g.uuid !== WIN568_SPORTSBOOK_UUID
  const popularPool = exFilter('popular', featuredPool.length >= 9 ? featuredPool : all).filter(notSports)
  // 真人席位从全部真人游戏按热度取（不限 featured）——真人竞品交叉曝光弱、几乎进不了
  // 核心池，只从 featured 取会永远空缺，导致首屏无真人。
  const casinoSeat = pickTop(exFilter('popular', bySite('casino')).filter(notSports), score, 1, 1)
  const popularRest = pickTop(popularPool, score, 9 - casinoSeat.length, 2)
  const popularMerged = [...popularRest]
  if (casinoSeat.length) popularMerged.splice(Math.min(2, popularMerged.length), 0, ...casinoSeat)

  const selection: HomepageSelection = {
    popular:    applyManual('popular', popularMerged.slice(0, 9), 9),
    // 高返利专区：ph_bonus(洗码吸引力) 最高的头部，运营钩子位，紧随 popular
    highRebate: topSection('highRebate', all.filter((g) => g.phBonus >= 15), (g) => g.phBonus, 6, 3),
    newGames:   sampleSection('newGames', newPool, score, 12),
    slots:      sampleSection('slots', bySite('slot'), score, 6),
    casino:     sampleSection('casino', bySite('casino'), score, 6),
    perya:      sampleSection('perya', bySite('perya'), score, 12),
    fishing:    sampleSection('fishing', bySite('fishing'), score, 6),
    lottery:    sampleSection('lottery', bySite('lottery'), score, 12),
    // 东方神话主题聚合：富化 theme 数据独有栏（asian-mythology 为最大主题）
    mythology:  sampleSection('mythology', all.filter((g) => g.theme === 'asian-mythology'), score, 12),
    megaWin:    sampleSection('megaWin', all.filter((g) => (g.maxWinMultiplier ?? 0) >= 1000), score, 6),
    generatedAt: new Date().toISOString(),
  }

  return selection
}

export async function refreshHomepageSelection(env: Env): Promise<void> {
  const redis = getRedis(env)
  const allGames = await getGamesFromCache(env)
  if (!allGames.length) return
  const overrides = await loadSectionOverrides(env)

  for (const cur of HOMEPAGE_CURRENCIES) {
    const pool = allGames.filter((g) => supportsCurrency(g, cur))
    const selection = buildHomepageSelection(pool, cur, overrides)
    await redis.set(`${HOMEPAGE_KEY}:${cur}`, JSON.stringify(selection), 'EX', HOMEPAGE_TTL)
  }
  console.log('[homepage] selection refreshed (per-currency)')
}

// 后台单游戏改动后的缓存重建去抖：全量重建(大 JOIN + 双币种选品)代价高，
// 批量操作时合并触发、不阻塞管理端响应；配置类操作(板块保存/手动刷新)仍走同步路径
let cacheRefreshTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleCacheRefresh(env: Env, delayMs = 2000): void {
  if (cacheRefreshTimer) return
  cacheRefreshTimer = setTimeout(() => {
    cacheRefreshTimer = null
    loadGamesCache(env)
      .then(() => refreshHomepageSelection(env))
      .catch((err) => console.error('[games-cache] scheduled refresh failed:', err))
  }, delayMs)
}

export async function getHomepageSelection(env: Env, currency?: string): Promise<HomepageSelection | null> {
  const redis = getRedis(env)
  const key = `${HOMEPAGE_KEY}:${homepageBucket(currency)}`
  const raw = await redis.get(key)
  if (raw) return JSON.parse(raw) as HomepageSelection
  // 缓存不存在则立即生成
  await refreshHomepageSelection(env)
  const raw2 = await redis.get(key)
  return raw2 ? (JSON.parse(raw2) as HomepageSelection) : null
}

export function applyHomepageCurrency(selection: HomepageSelection, currency?: string): HomepageSelection {
  const apply = (games: DbGame[]) => sortAvailableFirst(games, currency).map((g) => withCurrencySupport(g, currency))
  return {
    popular: apply(selection.popular),
    highRebate: apply(selection.highRebate ?? []),
    newGames: apply(selection.newGames ?? []),
    slots: apply(selection.slots),
    casino: apply(selection.casino ?? []),
    perya: apply(selection.perya ?? []),
    fishing: apply(selection.fishing),
    lottery: apply(selection.lottery ?? []),
    mythology: apply(selection.mythology ?? []),
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
       -- 注单 provider_id 只存 game_id 无厂商维度，而 game_id 跨厂商有重复(800+款)，
       -- 每个 game_id 只取一行(优先 enabled)避免玩过的游戏在历史里出现多条
       JOIN (
         SELECT game_id, game_provider_id, name_en, name_zh, provider, icon_url,
                ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY is_enabled DESC, game_provider_id ASC) AS rn
         FROM bg_568win_game
       ) w ON w.game_id = CAST(b.provider_id AS UNSIGNED) AND w.rn = 1
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
