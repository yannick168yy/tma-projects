// 买量渠道 BI：按 channel_code（投手渠道）× 马尼拉日实时统计投放核心指标。
// 与 bi_daily_* 聚合表不同，这里直接查业务表——投放要看当天实时消耗，10 分钟延迟的
// 预聚合不够用；且单渠道数据量小，走 bg_user_attribution.idx_channel_created 索引足够快。
//
// 指标口径对齐投放合作条款：
//   注册数     = 当日归因到该渠道的新注册（attribution.created_at 即注册时刻，仅 isNewUser 写入）
//   首存人数   = 平台历史首笔成功充值发生在当日、且归因到该渠道的人
//   客均       = 当日该渠道所有用户的充值总额 ÷ 首存人数
//   首存成本   = 广告花费在投手侧，我方只给首存数；成本由投手用「花费 ÷ 首存数」自算
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

const DAY_MS = 24 * 60 * 60 * 1000

function pool(env: Env): Pool {
  return getMysqlPool(env)
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** 马尼拉某天 0 点的 UTC 毫秒（offsetDays 相对今天） */
function manilaDayStartMs(offsetDays = 0): number {
  const date = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  return Date.parse(`${date}T00:00:00+08:00`) + offsetDays * DAY_MS
}

/** UTC 时间戳 → 所属马尼拉日 YYYY-MM-DD */
function manilaDateOf(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export interface AdSourceRow {
  channelCode: string
  regUsers: number
  firstDepUsers: number
  firstDepAmount: number
  depositAmount: number
  depositUsers: number
  /** 客均 = depositAmount / firstDepUsers；首存人数为 0 时为 null */
  arpu: number | null
}

export interface AdSourceReport {
  from: string
  to: string
  currency: string
  rows: AdSourceRow[]
  totals: Omit<AdSourceRow, 'channelCode'>
}

function isValidChannel(c: string): boolean {
  return /^[\w.-]{1,64}$/.test(c)
}

/**
 * 渠道汇总报表：给定马尼拉日范围 [from, to]（含端点），按 channel_code 聚合。
 * currency 固定单币种（投放默认 PHP，客均门槛即 PHP 口径）；channel 省略则返回全部渠道。
 */
export async function getAdSourceReport(
  env: Env,
  opts: { from: string; to: string; currency: string; channel?: string },
): Promise<AdSourceReport> {
  const db = pool(env)
  const { currency } = opts
  // from/to 是马尼拉日；转成 UTC 半开区间 [start, end)
  const startMs = Date.parse(`${opts.from}T00:00:00+08:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+08:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)
  const chanFilter = opts.channel ? ' AND a.channel_code=?' : ''
  const chanArg = opts.channel ? [opts.channel] : []

  const map = new Map<string, AdSourceRow>()
  const rowOf = (code: string): AdSourceRow => {
    let r = map.get(code)
    if (!r) {
      r = { channelCode: code, regUsers: 0, firstDepUsers: 0, firstDepAmount: 0, depositAmount: 0, depositUsers: 0, arpu: null }
      map.set(code, r)
    }
    return r
  }

  // 注册数：attribution.created_at 即注册时刻
  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(*) cnt
     FROM bg_user_attribution a
     WHERE a.channel_code IS NOT NULL AND a.created_at>=? AND a.created_at<?${chanFilter}
     GROUP BY a.channel_code`,
    [start, end, ...chanArg],
  )
  for (const r of regRows) rowOf(String(r.code)).regUsers = Number(r.cnt)

  // 当日充值（指定币种）：该渠道用户当日全部成功充值的额与人数
  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COALESCE(SUM(d.amount),0) amt, COUNT(DISTINCT d.user_id) users
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}
     GROUP BY a.channel_code`,
    [currency, start, end, ...chanArg],
  )
  for (const r of depRows) {
    const row = rowOf(String(r.code))
    row.depositAmount = Number(r.amt)
    row.depositUsers = Number(r.users)
  }

  // 首存：平台历史首笔成功充值在当日窗口内（NOT EXISTS 更早的 paid 单），且币种匹配
  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT a.channel_code code, COUNT(DISTINCT d.user_id) users, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND a.channel_code IS NOT NULL${chanFilter}
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )
     GROUP BY a.channel_code`,
    [currency, start, end, ...chanArg],
  )
  for (const r of fdRows) {
    const row = rowOf(String(r.code))
    row.firstDepUsers = Number(r.users)
    row.firstDepAmount = Number(r.amt)
  }

  const rows = [...map.values()]
  for (const r of rows) r.arpu = r.firstDepUsers > 0 ? r.depositAmount / r.firstDepUsers : null
  rows.sort((a, b) => b.firstDepUsers - a.firstDepUsers || b.regUsers - a.regUsers)

  const totals = rows.reduce(
    (t, r) => {
      t.regUsers += r.regUsers
      t.firstDepUsers += r.firstDepUsers
      t.firstDepAmount += r.firstDepAmount
      t.depositAmount += r.depositAmount
      t.depositUsers += r.depositUsers
      return t
    },
    { regUsers: 0, firstDepUsers: 0, firstDepAmount: 0, depositAmount: 0, depositUsers: 0, arpu: null as number | null },
  )
  totals.arpu = totals.firstDepUsers > 0 ? totals.depositAmount / totals.firstDepUsers : null

  return { from: opts.from, to: opts.to, currency, rows, totals }
}

export interface AdSourceTrendPoint {
  date: string
  regUsers: number
  firstDepUsers: number
  depositAmount: number
  arpu: number | null
}

/**
 * 单渠道逐日趋势，用于投手面板画曲线。channel 必填。
 */
export async function getAdSourceTrend(
  env: Env,
  opts: { channel: string; from: string; to: string; currency: string },
): Promise<{ channel: string; currency: string; points: AdSourceTrendPoint[] }> {
  const db = pool(env)
  const { channel, currency } = opts
  const startMs = Date.parse(`${opts.from}T00:00:00+08:00`)
  const endMs = Date.parse(`${opts.to}T00:00:00+08:00`) + DAY_MS
  const start = fmtUtc(startMs)
  const end = fmtUtc(endMs)

  // 预建全部日期槽，无数据的日子补 0，曲线不断点
  const byDate = new Map<string, AdSourceTrendPoint>()
  for (let ms = startMs; ms < endMs; ms += DAY_MS) {
    const d = new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
    byDate.set(d, { date: d, regUsers: 0, firstDepUsers: 0, depositAmount: 0, arpu: null })
  }

  const [regRows] = await db.query<RowDataPacket[]>(
    `SELECT a.created_at ca FROM bg_user_attribution a
     WHERE a.channel_code=? AND a.created_at>=? AND a.created_at<?`,
    [channel, start, end],
  )
  for (const r of regRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.regUsers += 1
  }

  const [depRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca, d.amount amt
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?`,
    [channel, currency, start, end],
  )
  for (const r of depRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.depositAmount += Number(r.amt)
  }

  const [fdRows] = await db.query<RowDataPacket[]>(
    `SELECT d.created_at ca
     FROM bg_deposit_order d JOIN bg_user_attribution a ON a.user_id=d.user_id
     WHERE a.channel_code=? AND d.status='paid' AND d.currency=? AND d.created_at>=? AND d.created_at<?
       AND NOT EXISTS (
         SELECT 1 FROM bg_deposit_order d2
         WHERE d2.user_id=d.user_id AND d2.status='paid' AND d2.created_at<d.created_at
       )`,
    [channel, currency, start, end],
  )
  for (const r of fdRows) {
    const p = byDate.get(manilaDateOf(new Date(r.ca)))
    if (p) p.firstDepUsers += 1
  }

  const points = [...byDate.values()]
  for (const p of points) p.arpu = p.firstDepUsers > 0 ? p.depositAmount / p.firstDepUsers : null
  return { channel, currency, points }
}

export { isValidChannel }
