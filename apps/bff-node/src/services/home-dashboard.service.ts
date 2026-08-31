import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getBiOverview, listBiAlerts, marketCurrency, marketOffsetHours, type BiMarket, type BiWindowStats } from './bi.service.js'
import { fetchBadgeCounts } from './sse-badges.js'
import { usdtRateMap } from './marketing-bi.service.js'

// 后台首页数据看板：实时快照 + 待办 + 资金 + 心跳。
// 定位与 BI 驾驶舱互补：驾驶舱看趋势与分析，这里看「现在什么状态、有什么事要处理」。

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

async function toUsdt(redis: Redis, env: Env, currency: string, amount: number): Promise<number> {
  const rates = await usdtRateMap(redis, env, [currency])
  return amount * (rates.get(currency) ?? 0)
}

export interface HomeDashboard {
  asOf: string
  market: BiMarket
  currency: 'USDT' | 'PHP' | 'IDR'
  timezone: 'UTC+7' | 'UTC+8'
  todos: { manualWithdrawals: number; rejectedKyc: number; csConversations: number; openAlerts: number }
  today: BiWindowStats
  yesterdaySameTime: BiWindowStats
  balances: {
    wallets: { currency: string; amount: number; usdt: number }[]
    walletTotalUsdt: number
    pendingWithdrawCount: number
    pendingWithdrawUsdt: number
    pendingWithdrawals: { currency: string; amount: number; count: number; usdt: number }[]
    providers: { provider: string; balance: number; currency: string; status: string; updatedAt: string | null }[]
  }
  heartbeat: {
    lastBetAt: string | null
    lastDepositAt: string | null
    lastLoginAt: string | null
    channelsToday: { direction: string; channel: string; total: number; success: number }[]
  }
  users: { total: number; active: number; frozen: number }
}

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()

export async function getHomeDashboard(env: Env, redis: Redis, market: BiMarket = 'ALL'): Promise<HomeDashboard> {
  const db = pool(env)
  const currency = marketCurrency(market)

  const [overview, badges, alerts] = await Promise.all([
    getBiOverview(env, redis, market),
    fetchBadgeCounts(env),
    listBiAlerts(env, 'open'),
  ])

  const [walletRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, COALESCE(SUM(available),0) amt FROM bg_wallet GROUP BY currency`,
  )
  const wallets: { currency: string; amount: number; usdt: number }[] = []
  let walletTotalUsdt = 0
  for (const r of walletRows) {
    if (currency !== 'ALL' && String(r.currency) !== currency) continue
    const amount = Number(r.amt)
    const usdt = await toUsdt(redis, env, String(r.currency), amount)
    wallets.push({ currency: String(r.currency), amount, usdt })
    walletTotalUsdt += usdt
  }
  wallets.sort((a, b) => b.usdt - a.usdt)

  const [pendingRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt
     FROM bg_withdraw_order WHERE status IN ('pending','processing') GROUP BY currency`,
  )
  let pendingWithdrawCount = 0
  let pendingWithdrawUsdt = 0
  const pendingWithdrawals: { currency: string; amount: number; count: number; usdt: number }[] = []
  for (const r of pendingRows) {
    if (currency !== 'ALL' && String(r.currency) !== currency) continue
    const count = Number(r.cnt)
    const amount = Number(r.amt)
    const usdt = await toUsdt(redis, env, String(r.currency), amount)
    pendingWithdrawCount += count
    pendingWithdrawUsdt += usdt
    pendingWithdrawals.push({ currency: String(r.currency), amount, count, usdt })
  }

  const [provRows] = await db.query<RowDataPacket[]>(
    `SELECT provider, balance, currency, status, error_msg, updated_at FROM provider_balance_snapshot ORDER BY provider`,
  )
  const providers = provRows.filter((r) => currency === 'ALL' || String(r.currency) === currency).map((r) => ({
    provider: String(r.provider),
    balance: Number(r.balance),
    currency: String(r.currency ?? ''),
    status: String(r.status ?? '') + (r.error_msg ? `: ${r.error_msg}` : ''),
    updatedAt: iso(r.updated_at),
  }))

  const currencyCondition = currency === 'ALL' ? '' : ' AND currency=?'
  const currencyParams = currency === 'ALL' ? [] : [currency]
  const [[hb]] = await db.query<RowDataPacket[]>(
    `SELECT
      (SELECT MAX(created_at) FROM bg_568win_wallet_txn WHERE 1=1${currencyCondition}) last_bet,
      (SELECT MAX(created_at) FROM bg_deposit_order WHERE status='paid'${currencyCondition}) last_dep,
      (SELECT MAX(l.created_at) FROM bg_login_log l JOIN bg_user u ON u.id=l.user_id WHERE 1=1${market === 'ALL' ? '' : ' AND u.market=?'}) last_login`,
    [...currencyParams, ...currencyParams, ...(market === 'ALL' ? [] : [market])],
  )
  const localToday = new Date(Date.now() + marketOffsetHours(market) * 3600 * 1000).toISOString().slice(0, 10)
  const channelFilter = market === 'ID' ? " AND channel LIKE 'unispay%'" : market === 'PH' ? " AND channel NOT LIKE 'unispay%'" : ''
  const [chRows] = await db.query<RowDataPacket[]>(
    `SELECT direction, channel, total, success FROM bi_daily_channel WHERE stat_date=?${channelFilter} ORDER BY total DESC`,
    [localToday],
  )

  const [uRows] = await db.query<RowDataPacket[]>(`SELECT status, COUNT(*) cnt FROM bg_user${market === 'ALL' ? '' : ' WHERE market=?'} GROUP BY status`, market === 'ALL' ? [] : [market])
  const users = { total: 0, active: 0, frozen: 0 }
  for (const r of uRows) {
    users.total += Number(r.cnt)
    if (r.status === 'active') users.active = Number(r.cnt)
    if (r.status === 'frozen') users.frozen = Number(r.cnt)
  }

  return {
    asOf: overview.asOf,
    market,
    currency: overview.currency,
    timezone: overview.timezone,
    todos: {
      manualWithdrawals: badges.manualWithdrawals,
      rejectedKyc: badges.rejectedKyc,
      csConversations: badges.pendingCs,
      openAlerts: alerts.length,
    },
    today: overview.today,
    yesterdaySameTime: overview.yesterdaySameTime,
    balances: { wallets, walletTotalUsdt, pendingWithdrawCount, pendingWithdrawUsdt, pendingWithdrawals, providers },
    heartbeat: {
      lastBetAt: iso(hb?.last_bet),
      lastDepositAt: iso(hb?.last_dep),
      lastLoginAt: iso(hb?.last_login),
      channelsToday: chRows.map((r) => ({
        direction: String(r.direction), channel: String(r.channel),
        total: Number(r.total), success: Number(r.success),
      })),
    },
    users,
  }
}
