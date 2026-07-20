import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { getBiOverview, listBiAlerts, type BiWindowStats } from './bi.service.js'
import { fetchBadgeCounts } from './sse-badges.js'
import { getRate } from './exchange-rate.service.js'

// 后台首页数据看板：实时快照 + 待办 + 资金 + 心跳。
// 定位与 BI 驾驶舱互补：驾驶舱看趋势与分析，这里看「现在什么状态、有什么事要处理」。

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

async function toPhp(redis: Redis, env: Env, currency: string, amount: number): Promise<number> {
  try {
    return amount * (await getRate(redis, currency, 'PHP', env)).rate
  } catch {
    return amount
  }
}

export interface HomeDashboard {
  asOf: string
  todos: { manualWithdrawals: number; rejectedKyc: number; csConversations: number; openAlerts: number }
  today: BiWindowStats
  yesterdaySameTime: BiWindowStats
  balances: {
    wallets: { currency: string; amount: number; php: number }[]
    walletTotalPhp: number
    pendingWithdrawCount: number
    pendingWithdrawPhp: number
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

export async function getHomeDashboard(env: Env, redis: Redis): Promise<HomeDashboard> {
  const db = pool(env)

  const [overview, badges, alerts] = await Promise.all([
    getBiOverview(env, redis),
    fetchBadgeCounts(env),
    listBiAlerts(env, 'open'),
  ])

  const [walletRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, COALESCE(SUM(available),0) amt FROM bg_wallet GROUP BY currency`,
  )
  const wallets: { currency: string; amount: number; php: number }[] = []
  let walletTotalPhp = 0
  for (const r of walletRows) {
    const amount = Number(r.amt)
    const php = await toPhp(redis, env, String(r.currency), amount)
    wallets.push({ currency: String(r.currency), amount, php })
    walletTotalPhp += php
  }
  wallets.sort((a, b) => b.php - a.php)

  const [pendingRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt
     FROM bg_withdraw_order WHERE status IN ('pending','processing') GROUP BY currency`,
  )
  let pendingWithdrawCount = 0
  let pendingWithdrawPhp = 0
  for (const r of pendingRows) {
    pendingWithdrawCount += Number(r.cnt)
    pendingWithdrawPhp += await toPhp(redis, env, String(r.currency), Number(r.amt))
  }

  const [provRows] = await db.query<RowDataPacket[]>(
    `SELECT provider, balance, currency, status, error_msg, updated_at FROM provider_balance_snapshot ORDER BY provider`,
  )
  const providers = provRows.map((r) => ({
    provider: String(r.provider),
    balance: Number(r.balance),
    currency: String(r.currency ?? ''),
    status: String(r.status ?? '') + (r.error_msg ? `: ${r.error_msg}` : ''),
    updatedAt: iso(r.updated_at),
  }))

  const [[hb]] = await db.query<RowDataPacket[]>(
    `SELECT
      (SELECT MAX(created_at) FROM bg_568win_wallet_txn) last_bet,
      (SELECT MAX(created_at) FROM bg_deposit_order WHERE status='paid') last_dep,
      (SELECT MAX(created_at) FROM bg_login_log) last_login`,
  )
  const manilaToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const [chRows] = await db.query<RowDataPacket[]>(
    `SELECT direction, channel, total, success FROM bi_daily_channel WHERE stat_date=? ORDER BY total DESC`,
    [manilaToday],
  )

  const [uRows] = await db.query<RowDataPacket[]>(`SELECT status, COUNT(*) cnt FROM bg_user GROUP BY status`)
  const users = { total: 0, active: 0, frozen: 0 }
  for (const r of uRows) {
    users.total += Number(r.cnt)
    if (r.status === 'active') users.active = Number(r.cnt)
    if (r.status === 'frozen') users.frozen = Number(r.cnt)
  }

  return {
    asOf: overview.asOf,
    todos: {
      manualWithdrawals: badges.manualWithdrawals,
      rejectedKyc: badges.rejectedKyc,
      csConversations: badges.pendingCs,
      openAlerts: alerts.length,
    },
    today: overview.today,
    yesterdaySameTime: overview.yesterdaySameTime,
    balances: { wallets, walletTotalPhp, pendingWithdrawCount, pendingWithdrawPhp, providers },
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
