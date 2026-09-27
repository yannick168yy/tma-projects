import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { currencyOffsetHours } from './rebate.service.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getGamesFromCache, supportsCurrency, type DbGame } from './sg-game.service.js'

export interface BetRecord {
  uuid: string
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  imageUrl: string | null
  betAmount: number
  currency: ActivityCurrency
}

/** 投注榜按市场本币分池：菲律宾 PHP、印尼 IDR、印度 INR */
export type ActivityCurrency = 'PHP' | 'IDR' | 'INR'

// 菲律宾、印度按「游戏权重 + 偏态金额分布」随机生成（用户明确要求，勿改回真实注单）；
// 印尼仍取真实注单与 bi_daily_game 聚合
const GENERATED_CURRENCIES = ['PHP', 'INR'] as const
type GeneratedCurrency = typeof GENERATED_CURRENCIES[number]

// ── 内存缓存 ────────────────────────────────────────────────────────────────

const latestBets: Record<ActivityCurrency, BetRecord[]> = { PHP: [], IDR: [], INR: [] }
const weekTop: Record<ActivityCurrency, BetRecord[]> = { PHP: [], IDR: [], INR: [] }
const monthTop: Record<ActivityCurrency, BetRecord[]> = { PHP: [], IDR: [], INR: [] }

function toRecord(g: DbGame, betAmount: number, currency: ActivityCurrency): BetRecord {
  return {
    uuid: g.uuid,
    name: g.name,
    nameId: g.nameId,
    nameVi: g.nameVi,
    nameZh: g.nameZh,
    provider: g.provider,
    imageUrl: g.imageHqUrl ?? g.imageUrl,
    betAmount,
    currency,
  }
}

function gamesByUuid(games: DbGame[]): Map<string, DbGame> {
  return new Map(games.map((g) => [g.uuid, g]))
}

// ── 生成数据（PHP / INR）────────────────────────────────────────────────────

const LATEST_POOL_SIZE = 300
const LATEST_SHOW = 50
const RANK_TOP_N = 10
// latest 池每 20 分钟重生成（每次请求再从池里洗牌取 50）；周/月榜每 7 天重生成一次，榜单不能一刷一个样
const LATEST_REGEN_MS = 20 * 60 * 1000
const RANK_REGEN_MS = 7 * 24 * 60 * 60 * 1000
const generatedAt = { latest: 0, rank: 0 }

// 单注金额分档：[累计概率, 最小, 最大, 步长]，步长 0 表示任意整数。
// 小额为主、长尾大额；INR 约为 PHP 的 1.5 倍，档位按印度常见注额取整
const LATEST_TIERS: Record<GeneratedCurrency, [number, number, number, number][]> = {
  PHP: [[0.08, 1, 9, 0], [0.60, 10, 99, 10], [0.80, 100, 499, 50], [0.90, 500, 1499, 100], [0.97, 1500, 3000, 100], [1, 3001, 9999, 500]],
  INR: [[0.08, 2, 14, 0], [0.60, 10, 149, 10], [0.80, 150, 749, 50], [0.90, 750, 2249, 100], [0.97, 2250, 4500, 250], [1, 4501, 14999, 500]],
}
const WEEK_RANGE: Record<GeneratedCurrency, [number, number]> = {
  PHP: [60_000, 520_000],
  INR: [90_000, 780_000],
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randStep(min: number, max: number, step: number): number {
  return randInt(Math.ceil(min / step), Math.floor(max / step)) * step
}

// 84% 落在步长整数上（真人多按筹码档下注），其余是任意金额
function skewedBetAmount(currency: GeneratedCurrency): number {
  const r = Math.random()
  const [, min, max, step] = LATEST_TIERS[currency].find(([p]) => r < p) ?? LATEST_TIERS[currency][0]
  if (step === 0 || Math.random() >= 0.84) return randInt(min, max)
  return randStep(min, max, step)
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function gameWeightScore(g: DbGame): number {
  return Math.max(1, g.weight * (g.isFeatured ? 1.5 : 1))
}

// 去整：真实投注额不会恰好是整千；落在整千上补一个 13~987 的随机零头
function deround(v: number): number {
  const n = Math.round(v)
  return n % 1000 === 0 ? n + randInt(13, 987) : n
}

// 加权随机选 n 款不重复游戏（权重 = weight × isFeatured ? 1.5 : 1）
function weightedPick(games: DbGame[], n: number): DbGame[] {
  if (games.length <= n) return [...games]
  const scores = games.map(gameWeightScore)
  const result: DbGame[] = []
  const used = new Set<number>()
  for (let round = 0; round < n; round++) {
    const total = scores.reduce((s, v, i) => (used.has(i) ? s : s + v), 0)
    let r = Math.random() * total
    for (let i = 0; i < games.length; i++) {
      if (used.has(i)) continue
      r -= scores[i]
      if (r <= 0) {
        used.add(i)
        result.push(games[i])
        break
      }
    }
  }
  return result
}

// 榜单入池：精选(isFeatured)爆款优先，不足 n 款再用权重最高的非精选游戏补齐，避免混进长尾冷门游戏
function topGamePool(games: DbGame[], n: number): DbGame[] {
  const featured = games.filter((g) => g.isFeatured)
  if (featured.length >= n) return featured
  const backfill = games
    .filter((g) => !g.isFeatured)
    .sort((a, b) => gameWeightScore(b) - gameWeightScore(a))
    .slice(0, n - featured.length)
  return [...featured, ...backfill]
}

// 只用该市场币种下能启动的游戏，行点击要能进游戏
async function marketGames(env: Env, currency: GeneratedCurrency): Promise<DbGame[]> {
  const games = await getGamesFromCache(env, currency)
  return games.filter((g) => g.isAvailable !== false && g.sortCategory !== 'sports' && supportsCurrency(g, currency))
}

function buildLatestPool(games: DbGame[], currency: GeneratedCurrency): BetRecord[] {
  const pool: BetRecord[] = []
  for (let i = 0; i < LATEST_POOL_SIZE; i++) {
    pool.push(toRecord(games[randInt(0, games.length - 1)], skewedBetAmount(currency), currency))
  }
  return pool
}

// 周榜/月榜关联生成：同一批游戏，月额 = 周额 × 各款独立的 3.6~4.8 倍，两榜游戏一致但名次略有变化。
// 金额按 权重分 + 每款独立热度系数 分布，拉开彼此金额、避免撞同一整数
function buildRankTops(games: DbGame[], currency: GeneratedCurrency): { week: BetRecord[]; month: BetRecord[] } {
  const picked = weightedPick(topGamePool(games, RANK_TOP_N), RANK_TOP_N)
  const maxScore = Math.max(...picked.map(gameWeightScore), 1)
  const [weekMin, weekMax] = WEEK_RANGE[currency]
  const rows = picked.map((g) => {
    const ratio = Math.pow(gameWeightScore(g) / maxScore, 0.55)
    const heat = 0.80 + Math.random() * 0.4
    const week = deround(weekMin + (weekMax - weekMin) * ratio * heat)
    const month = deround(week * (3.6 + Math.random() * 1.2))
    return { g, week, month }
  })
  return {
    week: rows.map((r) => toRecord(r.g, r.week, currency)).sort((a, b) => b.betAmount - a.betAmount),
    month: rows.map((r) => toRecord(r.g, r.month, currency)).sort((a, b) => b.betAmount - a.betAmount),
  }
}

async function regenerateLatest(env: Env): Promise<void> {
  if (Date.now() - generatedAt.latest < LATEST_REGEN_MS) return
  for (const currency of GENERATED_CURRENCIES) {
    const games = await marketGames(env, currency)
    if (games.length === 0) return
    latestBets[currency] = buildLatestPool(games, currency)
  }
  generatedAt.latest = Date.now()
  console.log(`[betting-activity] latest generated (PHP=${latestBets.PHP.length}, INR=${latestBets.INR.length})`)
}

async function regenerateRankTops(env: Env): Promise<void> {
  if (Date.now() - generatedAt.rank < RANK_REGEN_MS) return
  for (const currency of GENERATED_CURRENCIES) {
    const games = await marketGames(env, currency)
    if (games.length === 0) return
    const { week, month } = buildRankTops(games, currency)
    weekTop[currency] = week
    monthTop[currency] = month
  }
  generatedAt.rank = Date.now()
  console.log(`[betting-activity] week/month top generated (PHP=${weekTop.PHP.length}, INR=${weekTop.INR.length})`)
}

// ── 真实数据（IDR）──────────────────────────────────────────────────────────

// Latest 展示门槛：Rp1500 起显示（绝大多数注单是最小额 spin，全放会滚一屏最小额）。
// 玩家常连打几十把相同金额，相邻去重会大幅缩水，因此回看窗口给足 6000 行；去重后够 15 条就坚持门槛，不足才降档兜底
const IDR_LATEST_MIN_AMOUNTS = [1500, 300, 0]
const LATEST_SCAN_LIMIT = 6000
const LATEST_MIN_KEEP = 15

// bi_daily_game 的 stat_date 按市场日切；窗口边界也按市场时区算
function marketDate(currency: ActivityCurrency, daysAgo: number): string {
  const offsetHours = currencyOffsetHours(currency)
  const d = new Date(Date.now() + offsetHours * 3600 * 1000 - daysAgo * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

async function refreshRealLatest(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const byUuid = gamesByUuid(games)
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT gpid, provider_id, amount FROM bg_568win_wallet_txn
     WHERE txn_type='bet' AND voided_at IS NULL AND currency='IDR'
     ORDER BY id DESC LIMIT ?`,
    [LATEST_SCAN_LIMIT],
  )
  const candidates: { g: DbGame; amount: number }[] = []
  for (const r of rows) {
    if (r.gpid == null) continue
    const g = byUuid.get(`568win:${Number(r.gpid)}:${Number(r.provider_id)}`)
    if (!g) continue // 映射不到 games 缓存的（下架/体育）不展示，行点击要能启动游戏
    candidates.push({ g, amount: Number(r.amount) })
  }
  for (const min of IDR_LATEST_MIN_AMOUNTS) {
    const picked: BetRecord[] = []
    for (const c of candidates) {
      if (c.amount < min) continue
      const prev = picked[picked.length - 1]
      if (prev && prev.uuid === c.g.uuid && prev.betAmount === c.amount) continue
      picked.push(toRecord(c.g, c.amount, 'IDR'))
      if (picked.length >= LATEST_SHOW) break
    }
    if (picked.length >= LATEST_MIN_KEEP || min === 0) {
      latestBets.IDR = picked
      break
    }
  }
  console.log(`[betting-activity] latest refreshed (IDR=${latestBets.IDR.length})`)
}

// 周榜/月榜：bi_daily_game 滚动 7/30 天真实投注额 Top10，一条 SQL 同时算两个窗口
async function refreshRealRankTops(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const byUuid = gamesByUuid(games)
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT game_provider_id gpid, game_id,
          SUM(CASE WHEN stat_date >= ? THEN bet_amount ELSE 0 END) week_amt,
          SUM(bet_amount) month_amt
   FROM bi_daily_game
   WHERE stat_date >= ? AND currency='IDR' AND game_provider_id <> 0
   GROUP BY game_provider_id, game_id`,
    [marketDate('IDR', 6), marketDate('IDR', 29)],
  )
  const mapped = rows.flatMap((r) => {
    const g = byUuid.get(`568win:${Number(r.gpid)}:${Number(r.game_id)}`)
    return g ? [{ g, week: Math.round(Number(r.week_amt)), month: Math.round(Number(r.month_amt)) }] : []
  })
  weekTop.IDR = mapped.filter((r) => r.week > 0).sort((a, b) => b.week - a.week).slice(0, RANK_TOP_N).map((r) => toRecord(r.g, r.week, 'IDR'))
  monthTop.IDR = mapped.sort((a, b) => b.month - a.month).slice(0, RANK_TOP_N).map((r) => toRecord(r.g, r.month, 'IDR'))
  console.log(`[betting-activity] week/month top refreshed (IDR=${weekTop.IDR.length}+${monthTop.IDR.length})`)
}

// ── 刷新入口（app.ts 定时调用：latest 每 60 秒，榜单每 30 分钟；生成数据内部按自己的周期守卫）──

export async function refreshLatestPool(env: Env): Promise<void> {
  await Promise.all([regenerateLatest(env), refreshRealLatest(env)])
}

export async function refreshRankTops(env: Env): Promise<void> {
  await Promise.all([regenerateRankTops(env), refreshRealRankTops(env)])
}

// ── 对外查询 ────────────────────────────────────────────────────────────────

export type BetTab = 'latest' | 'week' | 'month'

export function getBettingActivity(tab: BetTab, currency: ActivityCurrency): BetRecord[] {
  if (tab === 'week') return weekTop[currency]
  if (tab === 'month') return monthTop[currency]
  // 生成的 latest 池 300 条，每次请求洗牌取 50，每个访客看到的滚动顺序都不同
  if (currency !== 'IDR') return shuffle(latestBets[currency]).slice(0, LATEST_SHOW)
  return latestBets[currency]
}
