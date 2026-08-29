import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
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
  currency: 'PHP' | 'IDR'
}

// ── 内存缓存 ────────────────────────────────────────────────────────────────

const latestBets: Record<'PHP' | 'IDR', BetRecord[]> = { PHP: [], IDR: [] }
const weekTop: Record<'PHP' | 'IDR', BetRecord[]> = { PHP: [], IDR: [] }
const monthTop: Record<'PHP' | 'IDR', BetRecord[]> = { PHP: [], IDR: [] }

// Latest 展示门槛：₱5 起显示（87% 注单是 ₱5 以下的最小额 spin，全放会滚一屏 ₱1）。
// 玩家常连打几十把相同金额，相邻去重会大幅缩水（生产实测 2000 行→34 条），
// 因此回看窗口给足 6000 行；去重后够 15 条就坚持门槛，不足才降档兜底，绝不造假数据。
const LATEST_MIN_AMOUNT: Record<'PHP' | 'IDR', number> = { PHP: 5, IDR: 1500 }
const LATEST_FALLBACK_AMOUNTS: Record<'PHP' | 'IDR', number[]> = { PHP: [1, 0], IDR: [300, 0] }
const LATEST_SCAN_LIMIT = 6000
const LATEST_SHOW = 50
const LATEST_MIN_KEEP = 15
const RANK_TOP_N = 10

function toRecord(g: DbGame, betAmount: number, currency: 'PHP' | 'IDR'): BetRecord {
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

// bi_daily_game 的 stat_date 是马尼拉日；窗口边界也按马尼拉时区算
function marketDate(currency: 'PHP' | 'IDR', daysAgo: number): string {
  const offsetHours = currency === 'IDR' ? 7 : 8
  const d = new Date(Date.now() + offsetHours * 3600 * 1000 - daysAgo * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// ── 刷新函数 ────────────────────────────────────────────────────────────────

// Latest：bg_568win_wallet_txn 最近真实注单，₱5 起显示，同游戏同金额相邻去重
export async function refreshLatestPool(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const byUuid = gamesByUuid(games)
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT gpid, provider_id, amount, currency FROM bg_568win_wallet_txn
     WHERE txn_type='bet' AND voided_at IS NULL AND currency IN ('PHP','IDR')
     ORDER BY id DESC LIMIT ?`,
    [LATEST_SCAN_LIMIT],
  )
  const candidates: Record<'PHP' | 'IDR', { g: DbGame; amount: number }[]> = { PHP: [], IDR: [] }
  for (const r of rows) {
    if (r.gpid == null) continue
    const g = byUuid.get(`568win:${Number(r.gpid)}:${Number(r.provider_id)}`)
    if (!g) continue // 映射不到 games 缓存的（下架/体育）不展示，行点击要能启动游戏
    const currency = r.currency === 'IDR' ? 'IDR' : 'PHP'
    candidates[currency].push({ g, amount: Number(r.amount) })
  }
  for (const currency of ['PHP', 'IDR'] as const) {
    for (const min of [LATEST_MIN_AMOUNT[currency], ...LATEST_FALLBACK_AMOUNTS[currency]]) {
      const picked: BetRecord[] = []
      for (const c of candidates[currency]) {
        if (c.amount < min) continue
        const prev = picked[picked.length - 1]
        if (prev && prev.uuid === c.g.uuid && prev.betAmount === c.amount) continue
        picked.push(toRecord(c.g, c.amount, currency))
        if (picked.length >= LATEST_SHOW) break
      }
      if (picked.length >= LATEST_MIN_KEEP || min === 0) {
        latestBets[currency] = picked
        break
      }
    }
  }
  console.log(`[betting-activity] latest refreshed (PHP=${latestBets.PHP.length}, IDR=${latestBets.IDR.length})`)
}

// 周榜/月榜：bi_daily_game 滚动 7/30 天真实投注额 Top10（core-node 每 10 分钟重算当日）。
// 一条 SQL 同时算两个窗口，月窗口做基础过滤，周金额用条件求和。
export async function refreshRankTops(env: Env): Promise<void> {
  const games = await getGamesFromCache(env)
  if (games.length === 0) return
  const byUuid = gamesByUuid(games)
  for (const currency of ['PHP', 'IDR'] as const) {
    const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
      `SELECT game_provider_id gpid, game_id,
            SUM(CASE WHEN stat_date >= ? THEN bet_amount ELSE 0 END) week_amt,
            SUM(bet_amount) month_amt
     FROM bi_daily_game
     WHERE stat_date >= ? AND currency=? AND game_provider_id <> 0
     GROUP BY game_provider_id, game_id`,
      [marketDate(currency, 6), marketDate(currency, 29), currency],
    )
    const mapped = rows.flatMap((r) => {
      const g = byUuid.get(`568win:${Number(r.gpid)}:${Number(r.game_id)}`)
      return g ? [{ g, week: Math.round(Number(r.week_amt)), month: Math.round(Number(r.month_amt)) }] : []
    })
    weekTop[currency] = mapped.filter((r) => r.week > 0).sort((a, b) => b.week - a.week).slice(0, RANK_TOP_N).map((r) => toRecord(r.g, r.week, currency))
    monthTop[currency] = mapped.sort((a, b) => b.month - a.month).slice(0, RANK_TOP_N).map((r) => toRecord(r.g, r.month, currency))
  }
  console.log(`[betting-activity] week/month top refreshed (PHP=${weekTop.PHP.length}+${monthTop.PHP.length}, IDR=${weekTop.IDR.length}+${monthTop.IDR.length})`)
}

// ── 对外查询 ────────────────────────────────────────────────────────────────

export type BetTab = 'latest' | 'week' | 'month'

export function getBettingActivity(tab: BetTab, currency: 'PHP' | 'IDR'): BetRecord[] {
  if (tab === 'week') return weekTop[currency]
  if (tab === 'month') return monthTop[currency]
  return latestBets[currency]
}
