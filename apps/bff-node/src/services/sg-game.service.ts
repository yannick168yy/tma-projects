import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getRedis } from '../clients/redis.client.js'

const GAMES_CACHE_KEY = 'games:all'
const GAMES_CACHE_TTL = 30 * 60 // 30 分钟
export const WIN568_SPORTSBOOK_UUID = '568win:sportsbook'
const WIN568_SPORTSBOOK_DEFAULT = {
  provider: '568Win Sports',
  name: '568Win Sports',
  nameZh: '568Win 体育',
  category: 'sportsbook',
  sortCategory: 'sports',
  siteCategory: 'sports',
  supportedCurrencies: ['PHP', 'USDT'],
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface DbGame {
  uuid: string
  aggregator?: '568win'
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  category: string | null
  subCategory: string | null
  sortCategory: string | null
  siteCategory?: string | null
  rtp?: number | null
  imageUrl: string | null
  imageHqUrl: string | null
  imageAnim?: string | null
  imageSource?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  hasLobby: boolean
  isMobile: boolean
  weight: number
  isFeatured: boolean
  isAvailable?: boolean
  /** Cashback Games 精选档位角标：elite=2% / pro=1.5% / basic=1%（bg_rebate_featured_game，真实结算费率） */
  cashbackTier?: 'elite' | 'pro' | 'basic' | null
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

// USD/USDC 视同 USDT 放行：USDT 与美元 1:1，上游多数游戏只标 USD 不标 USDT，
// 折叠后 USDT 账户可玩数从 ~1.3k 涨到 ~8.1k。上游若拒绝 USDT 起动 USD 游戏，可用此开关即时关闭。
const USD_AS_USDT = process.env.WIN568_USD_AS_USDT !== 'false'

function normalizeGameCurrency(currency?: string): string | undefined {
  if (!currency) return undefined
  const code = currency.toUpperCase()
  if (code === 'UCC') return 'USDT'
  if (USD_AS_USDT && (code === 'USD' || code === 'USDC')) return 'USDT'
  return code
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

function sortCategoryFromWin568(newGameType: number | null): string {
  if (newGameType === 203) return 'fishing'
  if (newGameType === 204) return 'table'
  if (newGameType === 300) return 'sports'
  if (newGameType !== null && newGameType >= 100 && newGameType < 200) return 'live'
  if (newGameType !== null && newGameType >= 200 && newGameType < 300) return 'slots'
  return 'other'
}

// 游戏封面图(/api/v1/home/images/*)走 CloudFront CDN；icon_url 等第三方外链原样。
// IMAGE_CDN_BASE 未设时回退相对路径(即走源站),便于回滚。
const IMAGE_CDN_BASE = process.env.IMAGE_CDN_BASE || ''
// khpic.cdn568.net 曾在菲律宾玩家网络按域名(SNI)被封→破图,临时改写到 cdn-test.cdn568.net(同一批文件)。
// 2026-07-23 568win 已解封,菲律宾真机可正常打开 khpic → 默认关闭改写,直接走更稳的 khpic 正式域名。
// 保险丝:若 PH 再次封锁,设 env KHPIC_REWRITE_TO=cdn-test.cdn568.net 即可一键重启改写,无需改代码。
const KHPIC_REWRITE_TO = process.env.KHPIC_REWRITE_TO ?? ''
function cdnImg(url: string | null): string | null {
  let u = url
  if (u && KHPIC_REWRITE_TO) u = u.replace('//khpic.cdn568.net/', `//${KHPIC_REWRITE_TO}/`)
  return u && IMAGE_CDN_BASE && u.startsWith('/api/v1/home/images/') ? IMAGE_CDN_BASE + u : u
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
    rtp: r.rtp == null || Number(r.rtp) < 0 ? null : Number(r.rtp),
    imageUrl: cdnImg(imageUrl ? String(imageUrl) : null),
    imageHqUrl: cdnImg(imageUrl ? String(imageUrl) : null),
    imageAnim: cdnImg(r.image_anim ? String(r.image_anim) : null),
    imageSource: r.effective_image_source ? String(r.effective_image_source) : null,
    imageWidth: probedDims ? Number(r.icon_width) : null,
    imageHeight: probedDims ? Number(r.icon_height) : null,
    hasLobby: newGameType === 100 || newGameType === 200,
    isMobile: devices.includes('m'),
    weight: r.effective_weight == null ? Math.max(1, 3999 - rank) : Number(r.effective_weight),
    isFeatured: Boolean(r.effective_featured),
    isAvailable: Boolean(r.is_enabled) && !Boolean(r.is_maintain) && String(r.provider_status) === 'Online' && Boolean(r.is_provider_online),
    createdAt: r.created_at ? new Date(r.created_at as Date).toISOString() : null,
    supportedCurrencies: parseJsonArray(r.supported_currencies),
  }
}

function win568SportsbookGame(row?: RowDataPacket | null): DbGame {
  const supportedCurrencies = parseJsonArray(row?.supported_currencies) ?? WIN568_SPORTSBOOK_DEFAULT.supportedCurrencies
  return {
    uuid: WIN568_SPORTSBOOK_UUID,
    aggregator: '568win',
    name: row?.name ? String(row.name) : WIN568_SPORTSBOOK_DEFAULT.name,
    nameId: null,
    nameVi: null,
    nameZh: row?.name_zh ? String(row.name_zh) : WIN568_SPORTSBOOK_DEFAULT.nameZh,
    provider: row?.provider ? String(row.provider) : WIN568_SPORTSBOOK_DEFAULT.provider,
    category: row?.category ? String(row.category) : WIN568_SPORTSBOOK_DEFAULT.category,
    subCategory: null,
    sortCategory: row?.sort_category ? String(row.sort_category) : WIN568_SPORTSBOOK_DEFAULT.sortCategory,
    siteCategory: row?.site_category ? String(row.site_category) : WIN568_SPORTSBOOK_DEFAULT.siteCategory,
    imageUrl: cdnImg(row?.image_override ? String(row.image_override) : null),
    imageHqUrl: cdnImg(row?.image_override ? String(row.image_override) : null),
    imageSource: row?.image_source ? String(row.image_source) : null,
    hasLobby: true,
    isMobile: true,
    weight: row?.weight == null ? 10000 : Number(row.weight),
    isFeatured: row?.is_featured == null ? true : Boolean(row.is_featured),
    isAvailable: true,
    supportedCurrencies,
  }
}

async function loadWin568SportsbookGame(db: ReturnType<typeof getMysqlPool>): Promise<DbGame | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT uuid, provider, name, name_zh, category, sort_category, site_category,
            is_active, weight, is_featured, image_override, image_source, supported_currencies
     FROM bg_virtual_game_config WHERE uuid = ? LIMIT 1`,
    [WIN568_SPORTSBOOK_UUID],
  )
  const row = rows[0]
  if (row && !Boolean(row.is_active)) return null
  return win568SportsbookGame(row)
}

// ── 全量缓存 ──────────────────────────────────────────────────────────────────

export async function loadGamesCache(env: Env): Promise<number> {
  const db = getMysqlPool(env)
  const redis = getRedis(env)
  const [win568Rows] = await db.query<RowDataPacket[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.new_game_type, g.rank_no, g.device,
            g.name_en, g.name_zh, g.icon_url, g.icon_width, g.icon_height, g.supported_currencies, g.created_at, g.rtp,
            g.is_enabled, g.is_maintain, g.provider_status, g.is_provider_online,
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
            -- rank_no 是上游厂商内排名(每家都有第1名)，兜底权重封顶 3998，必须低于竞品评分手工层(>=4000)
            COALESCE(o.weight, GREATEST(1, 3999 - COALESCE(g.rank_no, 9999))) AS effective_weight,
            COALESCE(o.is_featured, 0) AS effective_featured,
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
     WHERE COALESCE(o.is_active, 1) = 1
       AND COALESCE(o.site_category, g.site_category_auto, 'other') <> 'lobby'
       AND (g.supported_currencies IS NULL
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('PHP'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('USDT'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('UCC'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('USD'))
         OR JSON_CONTAINS(supported_currencies, JSON_QUOTE('USDC')))
       AND (g.device IS NULL OR FIND_IN_SET('m', REPLACE(REPLACE(g.device, ' ', ''), '/', ',')) > 0)`,
  )
  const sportsbookGame = await loadWin568SportsbookGame(db)
  const games = [
    ...(sportsbookGame ? [sportsbookGame] : []),
    ...(win568Rows as RowDataPacket[]).map(rowToWin568Game),
  ]
  // Cashback 精选档位角标（elite=2%/pro=1.5%，纯展示不参与结算）
  const [featRows] = await db.query<RowDataPacket[]>(
    "SELECT game_uuid, tier FROM bg_rebate_featured_game WHERE enabled = 1 AND tier IN ('elite','pro','basic')",
  )
  const tierByUuid = new Map(featRows.map((r) => [String(r.game_uuid), String(r.tier) as 'elite' | 'pro' | 'basic']))
  if (tierByUuid.size > 0) {
    for (const g of games) {
      const tier = tierByUuid.get(g.uuid)
      if (tier) g.cashbackTier = tier
    }
  }
  await redis.set(GAMES_CACHE_KEY, JSON.stringify(games), 'EX', GAMES_CACHE_TTL)
  setMemGames(games) // 同步进程内副本，后台改动即时生效
  console.log(`[games-cache] cached ${games.length} games`)
  return games.length
}

// 进程内缓存：games:all 是 6MB+ JSON，每请求 redis.get+JSON.parse 会阻塞事件循环，
// 并发下退化到多秒。缓存解析后的数组在内存，请求直接过滤，避免重复 parse。
let memGames: DbGame[] | null = null
let memGamesAt = 0
const MEM_GAMES_TTL = 60 * 1000

function setMemGames(games: DbGame[]) {
  memGames = games
  memGamesAt = Date.now()
}

export async function getGamesFromCache(env: Env): Promise<DbGame[]> {
  if (memGames && Date.now() - memGamesAt < MEM_GAMES_TTL) return memGames
  const redis = getRedis(env)
  const raw = await redis.get(GAMES_CACHE_KEY)
  if (raw) {
    setMemGames(JSON.parse(raw) as DbGame[])
    return memGames!
  }
  // 缓存不存在时回填（loadGamesCache 内部会 setMemGames）
  await loadGamesCache(env)
  return memGames ?? []
}

// 启动守卫：维护/下线游戏在客户端已置灰禁点，这里兜底拦陈旧客户端的直连启动。
// 缓存里查不到的 uuid 不在此拦，交由下游启动接口报错。
export async function isGameAvailable(env: Env, uuid: string): Promise<boolean> {
  const g = (await getGamesFromCache(env)).find((x) => x.uuid === uuid)
  return !g || g.isAvailable !== false
}

// ── Games 页分类 All 列表手动置顶排序：分类 → 有序 game_uuid 列表 ──────────────
// 表很小(每分类几款)，进程内缓存 60s，后台保存时主动清空即时生效
let memCategorySort: Map<string, string[]> | null = null
let memCategorySortAt = 0
const MEM_CATEGORY_SORT_TTL = 60 * 1000

export function bustCategorySortCache(): void {
  memCategorySort = null
  memCategorySortAt = 0
}

async function getCategorySortMap(env: Env): Promise<Map<string, string[]>> {
  if (memCategorySort && Date.now() - memCategorySortAt < MEM_CATEGORY_SORT_TTL) return memCategorySort
  const map = new Map<string, string[]>()
  try {
    const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
      `SELECT category_key, game_uuid FROM bg_category_sort_game ORDER BY category_key ASC, position ASC, id ASC`,
    )
    for (const r of rows) {
      const key = String(r.category_key)
      const list = map.get(key) ?? []
      list.push(String(r.game_uuid))
      map.set(key, list)
    }
  } catch { /* 表不存在或查询失败时视为无置顶配置 */ }
  memCategorySort = map
  memCategorySortAt = Date.now()
  return map
}

// ── 首页推荐：加权随机 + 30 分钟定时刷新 ────────────────────────────────────

const HOMEPAGE_KEY = 'homepage:selection'
const HOMEPAGE_TTL = 3 * 60 * 60 + 5 * 60 // 3h5m（比刷新间隔略长，防止窗口期空缺）

export interface HomepageSelection {
  popular: DbGame[]
  recommended: DbGame[]
  newGames: DbGame[]
  slots: DbGame[]
  casino: DbGame[]
  perya: DbGame[]
  fishing: DbGame[]
  lottery: DbGame[]
  baccarat: DbGame[]
  highRtp: DbGame[]
  highRebate: DbGame[]
  sports: DbGame[]
  generatedAt: string
}

export const EMPTY_HOMEPAGE_SELECTION: HomepageSelection = {
  popular: [], recommended: [], newGames: [], slots: [], casino: [], perya: [], fishing: [], lottery: [], baccarat: [], highRtp: [], highRebate: [], sports: [],
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

// 首页选品按币种预生成：板块内容不因上游维护而变动——维护/下线的游戏(is_maintain / provider 离线)
// 仍进选品池、按原选品结果占位返回，由客户端置灰(能看见、点不动)。避免 568Win 同步状态临时改变
// 首页板块(整块塌缩/消失)。仅按币种拆池：切币种后不支持该币种的游戏排到末尾并标 unavailable。
const HOMEPAGE_CURRENCIES = ['PHP', 'USDT'] as const

function homepageBucket(currency?: string): string {
  return normalizeGameCurrency(currency) === 'USDT' ? 'USDT' : 'PHP'
}

// 同款游戏系列键：去掉商标符与结尾的代数记号（数字/罗马数字/Deluxe），
// 「Fortune Gems 2」「Gates of Olympus 1000™」与初代同键，板块内只保留一款。
// 全数字名（如 777）不会被剥空——只在剩余多个 token 时才剥尾。
function gameSeriesKey(name: string | null | undefined): string {
  const base = (name ?? '').toLowerCase().replace(/[™®]/g, '').trim()
  const tokens = base.split(/\s+/)
  while (tokens.length > 1 && /^(\d+|ii|iii|iv|deluxe)$/.test(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ') || base
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
    // pin 优先：策略结果里与 pin 同系列的游戏剔除（板块内同款不同代只留 pin 的那款）
    const pinSeries = new Set(pins.map((x) => gameSeriesKey(x.g.name)).filter(Boolean))
    // 无 pin_position 的 pin 前插（按 sort_order），有位置的按位置插入
    const floating = pins.filter((x) => x.e.pinPosition == null).sort((a, b) => a.e.sortOrder - b.e.sortOrder)
    let result = [...floating.map((x) => x.g),
      ...list.filter((g) => !ex.has(g.uuid) && !pinnedUuids.has(g.uuid) && !pinSeries.has(gameSeriesKey(g.name)))]
    const positioned = pins.filter((x) => x.e.pinPosition != null).sort((a, b) => a.e.pinPosition! - b.e.pinPosition!)
    for (const x of positioned) {
      const idx = Math.min(Math.max(x.e.pinPosition! - 1, 0), result.length)
      result.splice(idx, 0, x.g)
    }
    return result.slice(0, target)
  }

  const seen = new Set<string>()
  // 手动 pin 的游戏预登记进 seen：pin 不走策略抽样，不登记的话策略会在其他板块再次选中同一款
  // （生产实测：Fortune Gems 2 钉在 recommended，highRtp 策略又按权重选中它）
  for (const entries of overrides.values()) {
    for (const e of entries) {
      if (e.action === 'pin' && (e.currency === '' || e.currency === cur)) seen.add(e.gameUuid)
    }
  }
  const pick = (pool: DbGame[], score: (g: DbGame) => number, n: number, maxPerProvider = 2) => {
    const r = serverWeightedSample(pool.filter((g) => !seen.has(g.uuid)), score, n, maxPerProvider)
    r.forEach((g) => seen.add(g.uuid))
    return r
  }
  // 确定性 top-N：按 score 降序钉死前 N，厂商去重（龙头厂商放宽到 maxPerProvider）
  // + 模块内同款去重（同名不同厂商版本、同系列不同代都只保留 score 最高的一款）
  const pickTop = (pool: DbGame[], score: (g: DbGame) => number, n: number, maxPerProvider = 3) => {
    const sorted = pool.filter((g) => !seen.has(g.uuid)).sort((a, b) => score(b) - score(a))
    const result: DbGame[] = []
    const counts = new Map<string, number>()
    const names = new Set<string>()
    for (const g of sorted) {
      if (result.length >= n) break
      const nameKey = gameSeriesKey(g.name)
      if (nameKey && names.has(nameKey)) continue
      const c = counts.get(g.provider) ?? 0
      if (c < maxPerProvider) {
        result.push(g)
        counts.set(g.provider, c + 1)
        if (nameKey) names.add(nameKey)
        seen.add(g.uuid)
      }
    }
    return result
  }
  // 确定性按权重降序取 N：跨板块 seen 去重（已出现在首页的跳过）+ 模块内同款去重
  // （同名不同厂商版本如 Roma/Mines、同系列不同代如 Fortune Gems 2，只保留权重最高的一款）
  const pickWeightTop = (pool: DbGame[], n: number, priority: (g: DbGame) => number = () => 0) => {
    const sorted = pool.filter((g) => !seen.has(g.uuid))
      .sort((a, b) => (priority(b) - priority(a)) || (b.weight - a.weight))
    const result: DbGame[] = []
    const names = new Set<string>()
    for (const g of sorted) {
      if (result.length >= n) break
      const nameKey = gameSeriesKey(g.name)
      if (nameKey && names.has(nameKey)) continue
      result.push(g)
      if (nameKey) names.add(nameKey)
      seen.add(g.uuid)
    }
    return result
  }
  const bySite = (cat: string) => all.filter((g) => g.siteCategory === cat)
  const score = (g: DbGame) => g.weight * (g.isFeatured ? 1.5 : 1)

  // New Games：按上游首次同步时间（created_at）降序取最新入库的一批做抽样池；
  // 上游常整批同厂商上新，池子放大到 120 并放宽厂商配额，避免板块只剩 2-3 款
  const newPool = [...all]
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, 120)

  // popular 从核心池(is_featured=竞品验证的爆款)加权抽，模仿竞品精选运营位；
  // 不从全库抽——数量占优的中腰部竞品游戏会在加权随机里淹没头部爆款
  const featuredPool = all.filter((g) => g.isFeatured)

  // exclude 在策略抽样前从池里剔除（保证板块仍取满 N）；pin 在抽样后合并进结果
  const exFilter = (key: string, pool: DbGame[]) => {
    const ex = new Set(entriesFor(key).filter((e) => e.action === 'exclude').map((e) => e.gameUuid))
    return ex.size ? pool.filter((g) => !ex.has(g.uuid)) : pool
  }
  const sampleSection = (key: string, pool: DbGame[], sc: (g: DbGame) => number, n: number, mpp = 2) =>
    applyManual(key, pick(exFilter(key, pool), sc, n, mpp), n)
  const weightSection = (key: string, pool: DbGame[], n: number, priority?: (g: DbGame) => number) =>
    applyManual(key, pickWeightTop(exFilter(key, pool), n, priority), n)
  // 返水档位优先级：elite(2%)>pro(1.5%)>basic(1%)>无。用于 slots 首推 cashback 游戏
  const cashbackRank = (g: DbGame) => g.cashbackTier === 'elite' ? 3 : g.cashbackTier === 'pro' ? 2 : g.cashbackTier === 'basic' ? 1 : 0
  const topSection = (key: string, pool: DbGame[], sc: (g: DbGame) => number, n: number, mpp = 3) =>
    applyManual(key, pickTop(exFilter(key, pool), sc, n, mpp), n)

  // 高洗码专栏：elite 档(2% 返水)游戏按热度取 top 9，必须固定展示高返水游戏本身。
  // 先于其他板块计算并登记 seen——否则策略会在 popular/recommended 等板块再次选中同款(生产实测 Medusa)
  const highRebateList = applyManual('highRebate',
    [...exFilter('highRebate', all.filter((g) => g.cashbackTier === 'elite'))].sort((a, b) => score(b) - score(a)).slice(0, 9), 9)
  highRebateList.forEach((g) => seen.add(g.uuid))

  // popular 混排：纯按热度排会被 slots 屠版。改为①保底 1 个真人娱乐席位(插到第3位保证
  // 露出)②主体从 featured 核心池按热度取、每厂商≤3(JILI 等龙头在 PH 本就多爆款)③featured
  // 池填不满时从全库高热度补足到 POPULAR_N。体育合成条目(isFeatured=true)有专属通栏，从热门剔除。
  const POPULAR_N = 12 // 首页 4 行 × 3 列
  const notSports = (g: DbGame) => g.uuid !== WIN568_SPORTSBOOK_UUID
  // 全局厂商配额(≤3)贯穿"真人席位+featured 主体+全库补足"三段，避免跨来源各自限厂商、
  // 累加后单厂商屠版(USDT featured 池小、JDB 密集时尤甚)。共享 seen 保留跨板块去重。
  const popCounts = new Map<string, number>()
  const takePopular = (pool: DbGame[], n: number) => {
    const out: DbGame[] = []
    for (const g of pool.filter((x) => !seen.has(x.uuid) && notSports(x)).sort((a, b) => score(b) - score(a))) {
      if (out.length >= n) break
      if ((popCounts.get(g.provider) ?? 0) >= 3) continue
      out.push(g); seen.add(g.uuid); popCounts.set(g.provider, (popCounts.get(g.provider) ?? 0) + 1)
    }
    return out
  }
  // 真人席位从全部真人游戏取（不限 featured，真人竞品覆盖弱进不了核心池），其余 featured 优先、不足从全库补
  const casinoSeat = takePopular(exFilter('popular', bySite('casino')), 1)
  const featuredPart = takePopular(exFilter('popular', featuredPool), POPULAR_N - casinoSeat.length)
  const backfillPart = takePopular(exFilter('popular', all), POPULAR_N - casinoSeat.length - featuredPart.length)
  const popularMerged = [...featuredPart, ...backfillPart]
  if (casinoSeat.length) popularMerged.splice(Math.min(2, popularMerged.length), 0, ...casinoSeat)

  const selection: HomepageSelection = {
    popular:    applyManual('popular', popularMerged.slice(0, POPULAR_N), POPULAR_N),
    // 推荐精选：竞品验证权重的次高梯队（popular 已取走的会被 seen 去重）。
    // 取 24 款做候选池：前端展示前 12，后 12 专供「最近在玩」补位，保证补位游戏不与推荐板块重复。
    // sportsbook 合成条目(权重10000)排除——体育板块固定给它第一席位，进推荐必重复
    recommended: topSection('recommended', all.filter(notSports), score, 24, 3),
    newGames:   sampleSection('newGames', newPool, score, 12, 4),
    // slots/perya/fishing/highRtp 改为确定性按权重降序推荐（含模块内同名去重）。
    // highRtp 在页面上位于 slots 之前，先计算以按展示顺序优先分配高权重游戏
    // 高 RTP 专栏：上游标称 rtp≥0.97，对标竞品「98%」栏；默认放 12 款
    highRtp:    weightSection('highRtp', all.filter((g) => (g.rtp ?? 0) >= 0.97), 12),
    // slots 首推 cashback（返水）游戏：按返水档位优先、档内按权重降序；不足再用普通老虎机补。
    // 跨板块 seen 去重保证这里选中的游戏不会在其他板块重复出现
    slots:      weightSection('slots', bySite('slot'), 6, cashbackRank),
    // 真人：排除百家乐(ntype101)，避免与百家乐专栏重复且被同款变体屠版
    casino:     sampleSection('casino', bySite('casino').filter((g) => g.category !== '101'), score, 6),
    // perya 含 bingo(bingo 游戏 site_category 本就归 perya)，2 行 6 款
    perya:      weightSection('perya', bySite('perya'), 6),
    fishing:    weightSection('fishing', bySite('fishing'), 6),
    // 彩票 & 其他：彩票(ntype207)低权重会被 other 淹没，先保底 4 彩票再用 other 补 8
    lottery:    applyManual('lottery', [...pick(bySite('lottery'), score, 4), ...pick(bySite('other'), score, 8)], 12),
    // 百家乐专栏：casinoplus 有独立返水专栏验证的品类需求（new_game_type=101）
    // 可用百家乐仅 2 家厂商(Pragmatic/Playtech)，默认每厂商≤2 只能凑出 4 款；放宽到 6 以填满 12
    baccarat:   sampleSection('baccarat', all.filter((g) => g.category === '101'), score, 12, 6),
    // 高洗码专栏：已在 popular 前先算并登记 seen（见 highRebateList 注释）
    highRebate: highRebateList,
    // 体育：sportsbook 合成条目固定第一席位（前端已移除专属通栏）；Lucky Sports(迁移134统一名) 的 28 个
    // 分项(足球/拳击/…)是同一产品的不同入口，只保留 Basketball，其余席位给独立体育产品(AFB/BTi/Panda/Saba 等)
    sports:     applyManual('sports', [
      ...all.filter((g) => g.uuid === WIN568_SPORTSBOOK_UUID).slice(0, 1),
      ...pick(exFilter('sports', bySite('sports').filter((g) =>
        g.uuid !== WIN568_SPORTSBOOK_UUID
        && !(g.provider === 'Lucky Sports' && g.name !== 'Basketball'))), score, 5, 6),
    ], 6),
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

// 选品快照 3 小时才重算，但 isAvailable 会被烤进快照——上游维护/恢复(is_maintain 变化)
// 需最多等 3 小时才反映。这里按实时游戏缓存(25 分钟重载)重新校准每款游戏的可用状态，
// 使置灰/复亮在缓存周期内生效，达成「不可用立刻置灰、恢复及时变亮」。缓存里已不存在的游戏(下架)保持置灰。
async function hydrateAvailability(env: Env, selection: HomepageSelection): Promise<HomepageSelection> {
  const liveByUuid = new Map((await getGamesFromCache(env)).map((g) => [g.uuid, g.isAvailable !== false]))
  const rehydrate = (games: DbGame[]) =>
    games.map((g) => ({ ...g, isAvailable: liveByUuid.get(g.uuid) ?? false }))
  const out = { ...selection } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = rehydrate(v as DbGame[])
  }
  return out as unknown as HomepageSelection
}

export async function getHomepageSelection(env: Env, currency?: string): Promise<HomepageSelection | null> {
  const redis = getRedis(env)
  const key = `${HOMEPAGE_KEY}:${homepageBucket(currency)}`
  const raw = await redis.get(key)
  if (raw) return hydrateAvailability(env, JSON.parse(raw) as HomepageSelection)
  // 缓存不存在则立即生成
  await refreshHomepageSelection(env)
  const raw2 = await redis.get(key)
  return raw2 ? hydrateAvailability(env, JSON.parse(raw2) as HomepageSelection) : null
}

export function applyHomepageCurrency(selection: HomepageSelection, currency?: string): HomepageSelection {
  const apply = (games: DbGame[]) => sortAvailableFirst(games, currency).map((g) => withCurrencySupport(g, currency))
  return {
    popular: apply(selection.popular),
    recommended: apply(selection.recommended ?? []),
    newGames: apply(selection.newGames ?? []),
    slots: apply(selection.slots),
    casino: apply(selection.casino ?? []),
    perya: apply(selection.perya ?? []),
    fishing: apply(selection.fishing),
    lottery: apply(selection.lottery ?? []),
    baccarat: apply(selection.baccarat ?? []),
    highRtp: apply(selection.highRtp ?? []),
    highRebate: apply(selection.highRebate ?? []),
    sports: apply(selection.sports ?? []),
    generatedAt: selection.generatedAt,
  }
}

export interface GameListResult {
  items: DbGame[]
  total: number
  page: number
  pages: number
}

// 高 cashback「All」分档配额轮播：三档各自按热度降序，每轮按配额从各档取，某档取完则跳过该档继续
const CASHBACK_QUOTA: Array<{ tier: 'elite' | 'pro' | 'basic'; take: number }> = [
  { tier: 'elite', take: 2 },
  { tier: 'pro', take: 3 },
  { tier: 'basic', take: 4 },
]

function orderByCashbackQuota(games: DbGame[]): DbGame[] {
  const buckets: Record<'elite' | 'pro' | 'basic', DbGame[]> = { elite: [], pro: [], basic: [] }
  for (const g of games) {
    if (g.cashbackTier === 'elite' || g.cashbackTier === 'pro' || g.cashbackTier === 'basic') buckets[g.cashbackTier].push(g)
  }
  for (const tier of ['elite', 'pro', 'basic'] as const) buckets[tier].sort((a, b) => b.weight - a.weight)

  const idx = { elite: 0, pro: 0, basic: 0 }
  const result: DbGame[] = []
  let progressed = true
  while (progressed) {
    progressed = false
    for (const { tier, take } of CASHBACK_QUOTA) {
      for (let k = 0; k < take && idx[tier] < buckets[tier].length; k++) {
        result.push(buckets[tier][idx[tier]++])
        progressed = true
      }
    }
  }
  return result
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
    cashbackTier?: string
    rtpMin?: number
    sortBy?: 'weight' | 'name'
    currency?: string
  } = {},
): Promise<GameListResult> {
  const { page = 1, limit = 30, search, provider, category, sortCategory, siteCategory, cashbackTier, rtpMin, sortBy = 'weight', currency } = opts

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
  // 高 cashback 档位过滤：elite=2% / pro=1.5% / basic=1%（Cashback 精选真实费率档）；
  // 'all'=任一档位精选游戏混合展示，undefined=不过滤(普通全量目录)
  if (cashbackTier === 'all') {
    games = games.filter((g) => g.cashbackTier != null)
  } else if (cashbackTier) {
    games = games.filter((g) => g.cashbackTier === cashbackTier)
  }
  if (rtpMin != null) {
    games = games.filter((g) => (g.rtp ?? 0) >= rtpMin)
  }
  // 不支持当前币种的游戏直接不显示(与首页选品口径一致)，避免 PHP 目录混入大量 USD 专用灰卡
  if (currency) {
    games = games.filter((g) => supportsCurrency(g, currency))
  }

  // Games 页分类 All 列表：后台配置的置顶游戏按顺序钉到最前，其余按权重垫后。
  // 仅在「无搜索 + 全部厂商 + 按权重排序 + 单一分类(或全部)」时生效，与前台 All 视图口径一致。
  const singleSiteCategory = siteCategory && !siteCategory.includes(',') && siteCategory !== 'all' ? siteCategory : null
  const categoryKey = singleSiteCategory ?? (!siteCategory ? 'all' : null)
  const canManualSort = !search && !cashbackTier && (!provider || provider === 'all') && sortBy === 'weight' && categoryKey != null
  const pinnedOrder = canManualSort ? (await getCategorySortMap(env)).get(categoryKey!) : undefined

  if (cashbackTier === 'all') {
    // 分档配额轮播：每轮按 elite 2 : pro 3 : basic 4 从各档(档内按热度降序)轮流取，
    // 让 2%/1.5%/1% 三档在整列表里持续穿插露出，而非纯热度把 basic 全顶到前面
    games = orderByCashbackQuota(games)
  } else if (pinnedOrder && pinnedOrder.length) {
    const posByUuid = new Map(pinnedOrder.map((u, i) => [u, i]))
    games = [...games].sort((a, b) => {
      const pa = posByUuid.get(a.uuid)
      const pb = posByUuid.get(b.uuid)
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
      return b.weight - a.weight
    })
  } else {
    games = [...games].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return b.weight - a.weight
    })
  }

  const offset = (page - 1) * limit

  return {
    items: games.slice(offset, offset + limit).map((g) => withCurrencySupport(g, currency)),
    total: games.length,
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

// 启动成功即记录（recently played 的数据源），fire-and-forget
export async function recordGameLaunch(env: Env, userId: string, gameUuid: string): Promise<void> {
  if (!isMysqlEnabled(env)) return
  await getMysqlPool(env).execute(
    `INSERT INTO bg_game_launch (user_id, game_uuid) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE launch_count = launch_count + 1, last_launched_at = NOW(3)`,
    [userId, gameUuid],
  ).catch(() => { /* 记录失败不影响启动 */ })
}

export async function getUserGameHistory(
  env: Env,
  userId: string,
  limit = 10,
): Promise<GameHistoryItem[]> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.game_uuid,
            COALESCE(o.name_override, w.name_en, w.name_zh) AS name,
            w.name_zh,
            w.provider,
            -- 封面优先级与主列表(getSlotGames)一致：后台覆盖 > playtime > fbmplay > bingoplus > 568win 原图
            COALESCE(o.image_override, cp.url, cf.url, cb.url, w.icon_url) AS image_url,
            COALESCE(o.image_override, cp.url, cf.url, cb.url, w.icon_url) AS image_hq_url,
            l.last_launched_at AS last_played_at
     FROM bg_game_launch l
     LEFT JOIN bg_568win_game w ON l.game_uuid LIKE '568win:%:%'
       AND w.game_provider_id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(l.game_uuid, ':', 2), ':', -1) AS UNSIGNED)
       AND w.game_id = CAST(SUBSTRING_INDEX(l.game_uuid, ':', -1) AS UNSIGNED)
     LEFT JOIN bg_568win_game_override o ON o.game_provider_id = w.game_provider_id AND o.game_id = w.game_id
     LEFT JOIN bg_568win_game_cover_candidate cf ON cf.game_provider_id = w.game_provider_id AND cf.game_id = w.game_id AND cf.source = 'fbmplay'
     LEFT JOIN bg_568win_game_cover_candidate cb ON cb.game_provider_id = w.game_provider_id AND cb.game_id = w.game_id AND cb.source = 'bingoplus'
     LEFT JOIN bg_568win_game_cover_candidate cp ON cp.game_provider_id = w.game_provider_id AND cp.game_id = w.game_id AND cp.source = 'playtime'
     WHERE l.user_id = ? AND w.game_id IS NOT NULL
     ORDER BY l.last_launched_at DESC
     LIMIT ?`,
    [userId, limit],
  )
  return rows.map((r) => ({
    uuid: r.game_uuid as string,
    name: r.name as string,
    nameId: null,
    nameVi: null,
    nameZh: (r.name_zh as string) ?? null,
    provider: r.provider as string,
    imageUrl: cdnImg(r.image_url ? String(r.image_url) : null),
    imageHqUrl: cdnImg(r.image_hq_url ? String(r.image_hq_url) : null),
    lastPlayedAt: new Date(r.last_played_at as Date).toISOString(),
  }))
}

const MEM_PROVIDER_WEIGHTS_TTL = 60 * 1000
let memProviderWeights: Map<string, number> | null = null
let memProviderWeightsAt = 0

/** 厂商权重表(bg_568win_provider)，无行的厂商按 1000 兜底 */
export async function getProviderWeights(env: Env): Promise<Map<string, number>> {
  if (memProviderWeights && Date.now() - memProviderWeightsAt < MEM_PROVIDER_WEIGHTS_TTL) return memProviderWeights
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(`SELECT provider, weight FROM bg_568win_provider`)
  memProviderWeights = new Map(rows.map((r) => [String(r.provider), Number(r.weight)]))
  memProviderWeightsAt = Date.now()
  return memProviderWeights
}

/** Returns distinct provider codes from cached games, optionally filtered by sortCategory / siteCategory (comma-separated) */
export async function listProviders(env: Env, sortCategory?: string, siteCategory?: string, rtpMin?: number, currency?: string): Promise<string[]> {
  let games = await getGamesFromCache(env)
  if (sortCategory && sortCategory !== 'all') {
    const cats = new Set(sortCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.sortCategory !== null && cats.has(g.sortCategory))
  }
  if (siteCategory && siteCategory !== 'all') {
    const cats = new Set(siteCategory.split(',').map((s) => s.trim()).filter(Boolean))
    games = games.filter((g) => g.siteCategory != null && cats.has(g.siteCategory))
  }
  if (rtpMin != null) {
    games = games.filter((g) => (g.rtp ?? 0) >= rtpMin)
  }
  // 与 listGames 同口径：只保留当前币种能玩的游戏，避免出现"点了却 No games found"的空厂商 chip
  if (currency) {
    games = games.filter((g) => supportsCurrency(g, currency))
  }
  const weights = await getProviderWeights(env)
  const providers = [...new Set(games.map((g) => g.provider))].sort((a, b) => {
    const wa = weights.get(a) ?? 1000
    const wb = weights.get(b) ?? 1000
    return wb - wa || a.localeCompare(b)
  })
  return providers
}

/** Returns distinct theme values from cache, sorted by game count desc */
