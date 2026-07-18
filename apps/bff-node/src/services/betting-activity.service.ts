import type { Env } from '../config/env.js'
import { getGamesFromCache, type DbGame } from './sg-game.service.js'

export interface BetRecord {
  uuid: string
  name: string
  nameId: string | null
  nameVi: string | null
  nameZh: string | null
  provider: string
  imageUrl: string | null
  betAmount: number
}

// ── 内存缓存 ────────────────────────────────────────────────────────────────

let latestPool: BetRecord[] = []
let weekTop: BetRecord[] = []
let monthTop: BetRecord[] = []

// ── 工具函数 ────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randStep(min: number, max: number, step: number): number {
  return randInt(Math.ceil(min / step), Math.floor(max / step)) * step
}

function latestBetAmount(min: number, max: number, step: number): number {
  if (Math.random() < 0.84) return randStep(min, max, step)
  return randInt(min, max)
}

function skewedBetAmount(): number {
  const r = Math.random()
  if (r < 0.08) return randInt(1, 9)
  if (r < 0.60) return latestBetAmount(10, 99, 10)
  if (r < 0.80) return latestBetAmount(100, 499, 50)
  if (r < 0.90) return latestBetAmount(500, 1499, 100)
  if (r < 0.97) return latestBetAmount(1500, 3000, 100)
  return latestBetAmount(3001, 9999, 500)
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function toRecord(g: DbGame, betAmount: number): BetRecord {
  return {
    uuid: g.uuid,
    name: g.name,
    nameId: g.nameId,
    nameVi: g.nameVi,
    nameZh: g.nameZh,
    provider: g.provider,
    imageUrl: g.imageHqUrl ?? g.imageUrl,
    betAmount,
  }
}

function gameWeightScore(g: DbGame): number {
  return Math.max(1, g.weight * (g.isFeatured ? 1.5 : 1))
}

// 去整：把金额抹成带零头的非整数（真实投注不会恰好是 2,000,000）。
// 精确到 1 元；若碰巧落在整千上，补一个 13~987 的随机零头。
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
  const totalRounds = Math.min(n, games.length)
  for (let round = 0; round < totalRounds; round++) {
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

// 榜单入池：精选(isFeatured)爆款优先，不足 10 款再用权重最高的非精选游戏补齐。
// 避免从全库加权随机抽——那样会混进大量无名气的长尾游戏，榜单显得没热度。
function topGamePool(games: DbGame[], n: number): DbGame[] {
  const featured = games.filter((g) => g.isFeatured)
  if (featured.length >= n) return featured
  const backfill = games
    .filter((g) => !g.isFeatured)
    .sort((a, b) => gameWeightScore(b) - gameWeightScore(a))
    .slice(0, n - featured.length)
  return [...featured, ...backfill]
}

const WEEK_MIN = 60_000
const WEEK_MAX = 520_000

// 周榜/月榜关联生成：同一批精选游戏，每款先算一个周投注额，月额 = 周额 × 各款独立的
// 3.6~4.8 倍（月累计），因此两榜游戏一致、量级关联，但倍数不同使名次略有变化。
// 金额按 权重分 + 每款独立热度系数 分布，不 clamp 到固定上限，避免多款撞同一整数。
function buildRankTops(games: DbGame[]): { week: BetRecord[]; month: BetRecord[] } {
  const picked = weightedPick(topGamePool(games, 10), 10)
  const maxScore = Math.max(...picked.map(gameWeightScore), 1)
  const rows = picked.map((g) => {
    const ratio = Math.pow(gameWeightScore(g) / maxScore, 0.55)
    const heat = 0.80 + Math.random() * 0.4 // 每款独立热度，拉开彼此金额、避免撞顶
    const week = deround(WEEK_MIN + (WEEK_MAX - WEEK_MIN) * ratio * heat)
    const month = deround(week * (3.6 + Math.random() * 1.2))
    return { g, week, month }
  })
  return {
    week: rows.map((r) => toRecord(r.g, r.week)).sort((a, b) => b.betAmount - a.betAmount),
    month: rows.map((r) => toRecord(r.g, r.month)).sort((a, b) => b.betAmount - a.betAmount),
  }
}

// ── 刷新函数 ────────────────────────────────────────────────────────────────

export async function refreshLatestPool(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const pool: BetRecord[] = []
  for (let i = 0; i < 300; i++) {
    const g = games[randInt(0, games.length - 1)]
    pool.push(toRecord(g, skewedBetAmount()))
  }
  latestPool = pool
  console.log('[betting-activity] latest pool refreshed (300 records)')
}

// 周榜与月榜一起生成以保证关联（同一批游戏、月额≈周额数倍）
export async function refreshRankTops(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const { week, month } = buildRankTops(games)
  weekTop = week
  monthTop = month
  console.log('[betting-activity] week/month top refreshed (10+10 records)')
}

// ── 对外查询 ────────────────────────────────────────────────────────────────

export type BetTab = 'latest' | 'week' | 'month'

export function getBettingActivity(tab: BetTab): BetRecord[] {
  if (tab === 'week') return weekTop
  if (tab === 'month') return monthTop
  // latest：从 300 条 pool 中随机取 50 条
  if (latestPool.length === 0) return []
  return shuffle(latestPool).slice(0, 50)
}
