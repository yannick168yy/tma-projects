import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'
import { currentTenant } from '../../lib/tenant-context.js'
import { forEachTenant } from '../tenant-jobs.js'

const log = childLogger('billing-daily')

const DAY_MS = 86_400_000

/**
 * 统计日窗口。与租户库 bi_* 完全同口径（IDR 走 UTC+7，其余走 UTC+8），
 * 差一小时就会让计费快照和客户自己后台看到的 BI 数字对不上，这种不一致没法解释。
 */
function businessWindow(date: string, offset: 7 | 8): { start: string; end: string } {
  const startMs = Date.parse(`${date}T00:00:00+0${offset}:00`)
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  return { start: fmt(startMs), end: fmt(startMs + DAY_MS) }
}

export function statDate(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

interface ChannelMeta { owner: 'platform' | 'tenant'; feeRatePct: number; feeFixed: number }

async function channelMeta(tenantId: number): Promise<Map<string, ChannelMeta>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT channel_code, owner, fee_rate_pct, fee_fixed FROM pf_tenant_channel WHERE tenant_id = ?', [tenantId])
  const map = new Map<string, ChannelMeta>()
  for (const r of rows) {
    map.set(String(r.channel_code), {
      owner: r.owner === 'platform' ? 'platform' : 'tenant',
      feeRatePct: Number(r.fee_rate_pct ?? 0),
      feeFixed: Number(r.fee_fixed ?? 0),
    })
  }
  return map
}

interface DailyRow {
  currency: string
  fxRateUsdt: number
  depositAmount: number
  depositPlatform: number
  depositTenant: number
  depositCount: number
  withdrawAmount: number
  withdrawPlatform: number
  withdrawTenant: number
  turnover: number
  payout: number
  ggr: number
  bonusCost: number
  commissionCost: number
  channelFee: number
  venueTurnover: Record<string, number>
  channelDetail: Record<string, { owner: string; amount: number; fee: number; count: number }>
}

/**
 * 算一个租户一天的计费快照。**只读租户库，不写**。
 *
 * 数据源用租户库已有的 bi_daily_*（core-node 的 BI 日聚合产物），不重新扫原始注单：
 * 一是省掉一遍全表窗口扫描，二是保证「客户在自己后台看到的数字」与「平台拿来收钱的数字」
 * 出自同一份聚合，对不上时只有一个地方要查。
 *
 * 通道拆分（模式 A/B）与手续费按订单表的 channel 现算 —— bi_daily_channel 只有笔数没有金额。
 */
export async function computeTenantDaily(env: Env, date: string): Promise<DailyRow[]> {
  const tenant = currentTenant()
  const db = getMysqlPool(env)

  const [platformRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, deposit_amount, deposit_count, withdraw_amount, bet_amount, payout_amount, bonus_cost
       FROM bi_daily_platform WHERE stat_date = ?`, [date])
  if (platformRows.length === 0) return []

  const [rateRows] = await db.query<RowDataPacket[]>(
    'SELECT currency, rate_to_usdt FROM bi_daily_exchange_rate WHERE stat_date = ?', [date])
  const rates = new Map(rateRows.map((r) => [String(r.currency), Number(r.rate_to_usdt)]))

  const [venueRows] = await db.query<RowDataPacket[]>(
    'SELECT currency, provider, bet_amount FROM bi_daily_provider WHERE stat_date = ?', [date])

  // 团队佣金按 period（结算日）归集，与 bi 的统计日同一天
  const [commissionRows] = await db.query<RowDataPacket[]>(
    `SELECT currency, COALESCE(SUM(commission_cents),0) / 100 AS amt
       FROM bg_team_commission WHERE period = ? AND status <> 'voided' GROUP BY currency`, [date])
  const commissions = new Map(commissionRows.map((r) => [String(r.currency), Number(r.amt)]))

  const channels = await channelMeta(tenant.id)
  const rows: DailyRow[] = []

  for (const p of platformRows) {
    const currency = String(p.currency)
    const win = businessWindow(date, currency === 'IDR' ? 7 : 8)

    const [depByChannel] = await db.query<RowDataPacket[]>(
      `SELECT channel, COUNT(*) cnt, COALESCE(SUM(amount),0) amt
         FROM bg_deposit_order
        WHERE status = 'paid' AND channel <> 'admin' AND currency = ?
          AND created_at >= ? AND created_at < ?
        GROUP BY channel`, [currency, win.start, win.end])

    const [wdByChannel] = await db.query<RowDataPacket[]>(
      `SELECT channel, COALESCE(SUM(amount),0) amt
         FROM bg_withdraw_order
        WHERE status IN ('completed','processing') AND channel <> 'admin' AND currency = ?
          AND created_at >= ? AND created_at < ?
        GROUP BY channel`, [currency, win.start, win.end])

    let depositPlatform = 0
    let depositTenant = 0
    let channelFee = 0
    const channelDetail: DailyRow['channelDetail'] = {}
    for (const r of depByChannel) {
      const code = String(r.channel)
      const amt = Number(r.amt)
      const cnt = Number(r.cnt)
      // 平台库没登记的通道按「租户自带」处理：平台没经手这笔钱，就不能拿它算代收手续费
      const meta = channels.get(code) ?? { owner: 'tenant' as const, feeRatePct: 0, feeFixed: 0 }
      const fee = meta.owner === 'platform'
        ? Math.round((amt * meta.feeRatePct / 100 + meta.feeFixed * cnt) * 10000) / 10000
        : 0
      if (meta.owner === 'platform') { depositPlatform += amt; channelFee += fee } else depositTenant += amt
      channelDetail[code] = { owner: meta.owner, amount: amt, fee, count: cnt }
    }

    let withdrawPlatform = 0
    let withdrawTenant = 0
    for (const r of wdByChannel) {
      const meta = channels.get(String(r.channel)) ?? { owner: 'tenant' as const, feeRatePct: 0, feeFixed: 0 }
      if (meta.owner === 'platform') withdrawPlatform += Number(r.amt)
      else withdrawTenant += Number(r.amt)
    }

    const venueTurnover: Record<string, number> = {}
    for (const v of venueRows) {
      if (String(v.currency) !== currency) continue
      venueTurnover[String(v.provider)] = Number(v.bet_amount)
    }

    const turnover = Number(p.bet_amount)
    const payout = Number(p.payout_amount)
    rows.push({
      currency,
      // 汇率快照缺失时记 0 而不是 1：1 会把 PHP 当 USDT 算，账单直接放大 50 倍
      fxRateUsdt: rates.get(currency) ?? (currency === 'USDT' ? 1 : 0),
      depositAmount: Number(p.deposit_amount),
      depositPlatform,
      depositTenant,
      depositCount: Number(p.deposit_count),
      withdrawAmount: Number(p.withdraw_amount),
      withdrawPlatform,
      withdrawTenant,
      turnover,
      payout,
      ggr: Math.round((turnover - payout) * 10000) / 10000,
      bonusCost: Number(p.bonus_cost),
      commissionCost: commissions.get(currency) ?? 0,
      channelFee,
      venueTurnover,
      channelDetail,
    })
  }
  return rows
}

/**
 * 写快照。已锁定（locked_at 非空）的行拒绝覆盖 —— 账单已经按它出过账，
 * 事后改数就是改客户已确认的账，只能走人工重开账单流程。
 */
export async function saveTenantDaily(tenantId: number, date: string, rows: DailyRow[]): Promise<number> {
  const pool = getPlatformPool()
  let written = 0
  for (const r of rows) {
    const [res] = await pool.execute(
      `INSERT INTO pf_billing_daily
         (tenant_id, stat_date, currency, fx_rate_usdt, deposit_amount, deposit_platform, deposit_tenant,
          deposit_count, withdraw_amount, withdraw_platform, withdraw_tenant, turnover, payout, ggr,
          bonus_cost, commission_cost, channel_fee, venue_turnover, channel_detail, computed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))
       ON DUPLICATE KEY UPDATE
         fx_rate_usdt = IF(locked_at IS NULL, VALUES(fx_rate_usdt), fx_rate_usdt),
         deposit_amount = IF(locked_at IS NULL, VALUES(deposit_amount), deposit_amount),
         deposit_platform = IF(locked_at IS NULL, VALUES(deposit_platform), deposit_platform),
         deposit_tenant = IF(locked_at IS NULL, VALUES(deposit_tenant), deposit_tenant),
         deposit_count = IF(locked_at IS NULL, VALUES(deposit_count), deposit_count),
         withdraw_amount = IF(locked_at IS NULL, VALUES(withdraw_amount), withdraw_amount),
         withdraw_platform = IF(locked_at IS NULL, VALUES(withdraw_platform), withdraw_platform),
         withdraw_tenant = IF(locked_at IS NULL, VALUES(withdraw_tenant), withdraw_tenant),
         turnover = IF(locked_at IS NULL, VALUES(turnover), turnover),
         payout = IF(locked_at IS NULL, VALUES(payout), payout),
         ggr = IF(locked_at IS NULL, VALUES(ggr), ggr),
         bonus_cost = IF(locked_at IS NULL, VALUES(bonus_cost), bonus_cost),
         commission_cost = IF(locked_at IS NULL, VALUES(commission_cost), commission_cost),
         channel_fee = IF(locked_at IS NULL, VALUES(channel_fee), channel_fee),
         venue_turnover = IF(locked_at IS NULL, VALUES(venue_turnover), venue_turnover),
         channel_detail = IF(locked_at IS NULL, VALUES(channel_detail), channel_detail),
         computed_at = IF(locked_at IS NULL, NOW(3), computed_at)`,
      [tenantId, date, r.currency, r.fxRateUsdt, r.depositAmount, r.depositPlatform, r.depositTenant,
       r.depositCount, r.withdrawAmount, r.withdrawPlatform, r.withdrawTenant, r.turnover, r.payout, r.ggr,
       r.bonusCost, r.commissionCost, r.channelFee,
       JSON.stringify(r.venueTurnover), JSON.stringify(r.channelDetail)],
    )
    written += (res as { affectedRows: number }).affectedRows > 0 ? 1 : 0
  }
  return written
}

/** 单租户重算一天。平台控制台的「重算」按钮与定时任务共用这一条路径 */
export async function snapshotTenantDay(env: Env, date: string): Promise<number> {
  const tenant = currentTenant()
  const rows = await computeTenantDaily(env, date)
  if (rows.length === 0) return 0
  return saveTenantDaily(tenant.id, date, rows)
}

/**
 * 日切任务：重算昨天与前两天。
 *
 * 回填三天而不是只算昨天 —— 注单回调、提现终态、佣金结算都可能晚到，
 * 只算一次的话晚到的数据永远不会进账单。与 BI 的回填窗口一致。
 */
export async function runBillingSnapshot(env: Env): Promise<void> {
  for (const offset of [-1, -2, -3]) {
    const date = statDate(offset)
    await forEachTenant(`billing-snapshot${offset}`, async (tenant) => {
      const n = await snapshotTenantDay(env, date)
      if (n > 0) log.info({ tenant: tenant.code, date, rows: n }, '计费快照已更新')
    })
  }
}

/** 锁定某段周期的快照。账单一旦生成就锁 —— 之后重算不再改动已出账的数字 */
export async function lockDailyRange(tenantId: number, start: string, end: string): Promise<number> {
  const [res] = await getPlatformPool().execute(
    `UPDATE pf_billing_daily SET locked_at = NOW(3)
      WHERE tenant_id = ? AND stat_date BETWEEN ? AND ? AND locked_at IS NULL`,
    [tenantId, start, end])
  return (res as { affectedRows: number }).affectedRows
}
