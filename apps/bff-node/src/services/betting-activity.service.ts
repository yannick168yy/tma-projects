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

function skewedBetAmount(): number {
  const r = Math.random()
  if (r < 0.60) return randInt(1, 99)
  if (r < 0.80) return randInt(100, 499)
  if (r < 0.90) return randInt(500, 1499)
  if (r < 0.97) return randInt(1500, 3000)
  return randInt(3001, 5000)
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

// 加权随机选 n 款不重复游戏（权重 = weight × isFeatured ? 1.5 : 1）
function weightedPick(games: DbGame[], n: number): DbGame[] {
  if (games.length <= n) return [...games]
  const scores = games.map((g) => g.weight * (g.isFeatured ? 1.5 : 1))
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

export async function refreshWeekTop(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const picked = weightedPick(games, 10)
  weekTop = picked
    .map((g) => toRecord(g, randInt(50_000, 500_000)))
    .sort((a, b) => b.betAmount - a.betAmount)
  console.log('[betting-activity] week top refreshed (10 records)')
}

export async function refreshMonthTop(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return

  // 周榜所有游戏进入月榜，金额按随机倍数放大体现月度积累
  const base = weekTop.map((r) => ({
    ...r,
    betAmount: Math.round(r.betAmount * (3 + Math.random() * 5)),
  }))
  // 不足 10 条时从剩余游戏库补
  const usedUuids = new Set(base.map((r) => r.uuid))
  const remaining = games.filter((g) => !usedUuids.has(g.uuid))
  const extra = weightedPick(remaining, 10 - base.length).map((g) =>
    toRecord(g, randInt(200_000, 2_000_000)),
  )
  monthTop = [...base, ...extra].sort((a, b) => b.betAmount - a.betAmount)
  console.log('[betting-activity] month top refreshed (10 records)')
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
