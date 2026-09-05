import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'
import { currentTenant } from '../../lib/tenant-context.js'
import { forEachTenant } from '../tenant-jobs.js'
import { round4 } from './billing-engine.js'
import { statDate } from './billing-daily.service.js'

const log = childLogger('platform-bi')

/**
 * 平台总览抽数（P2-11）。
 *
 * 每个租户库读自己的 bi_daily_platform / bi_daily_active，折 USDT 后写平台库一行。
 * 与计费快照读同一份聚合 —— 总览上的 GGR 和账单上的 GGR 必须是同一个数，
 * 否则运营会拿着两个数字来问哪个对。
 */
export async function collectTenantBi(env: Env, date: string): Promise<void> {
  const tenant = currentTenant()
  const db = getMysqlPool(env)

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.currency, p.deposit_amount, p.deposit_count, p.deposit_users, p.withdraw_amount,
            p.bet_amount, p.payout_amount, p.bet_users, p.bonus_cost, p.first_dep_users,
            r.rate_to_usdt
       FROM bi_daily_platform p
       LEFT JOIN bi_daily_exchange_rate r ON r.stat_date = p.stat_date AND r.currency = p.currency
      WHERE p.stat_date = ?`, [date])

  const [commissionRows] = await db.query<RowDataPacket[]>(
    `SELECT c.currency, COALESCE(SUM(c.commission_cents),0) / 100 AS amt,
            (SELECT rate_to_usdt FROM bi_daily_exchange_rate r
              WHERE r.stat_date = ? AND r.currency = c.currency) AS rate
       FROM bg_team_commission c
      WHERE c.period = ? AND c.status <> 'voided' GROUP BY c.currency`, [date, date])

  const [[active]] = await db.query<RowDataPacket[]>(
    "SELECT new_users, dau FROM bi_daily_active WHERE stat_date = ? AND market = 'ALL'",
    [date]) as unknown as [RowDataPacket[]]

  const agg = {
    deposit: 0, withdraw: 0, turnover: 0, payout: 0, bonus: 0, commission: 0,
    depositCount: 0, depositUsers: 0, firstDepUsers: 0, betUsers: 0, skipped: 0,
  }
  for (const r of rows) {
    const fx = r.currency === 'USDT' ? Number(r.rate_to_usdt ?? 1) : Number(r.rate_to_usdt ?? 0)
    // 人数不受汇率影响，先加；金额只在有汇率时加
    agg.depositCount += Number(r.deposit_count)
    agg.depositUsers += Number(r.deposit_users)
    agg.firstDepUsers += Number(r.first_dep_users)
    agg.betUsers += Number(r.bet_users)
    if (!(fx > 0)) { agg.skipped += 1; continue }
    agg.deposit += Number(r.deposit_amount) * fx
    agg.withdraw += Number(r.withdraw_amount) * fx
    agg.turnover += Number(r.bet_amount) * fx
    agg.payout += Number(r.payout_amount) * fx
    agg.bonus += Number(r.bonus_cost) * fx
  }
  for (const c of commissionRows) {
    const fx = c.currency === 'USDT' ? Number(c.rate ?? 1) : Number(c.rate ?? 0)
    if (fx > 0) agg.commission += Number(c.amt) * fx
  }

  await getPlatformPool().execute(
    `INSERT INTO pf_bi_daily
       (tenant_id, stat_date, deposit_usdt, withdraw_usdt, turnover_usdt, payout_usdt, ggr_usdt,
        bonus_usdt, commission_usdt, deposit_count, deposit_users, first_dep_users, bet_users,
        new_users, dau, skipped_rows)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       deposit_usdt = VALUES(deposit_usdt), withdraw_usdt = VALUES(withdraw_usdt),
       turnover_usdt = VALUES(turnover_usdt), payout_usdt = VALUES(payout_usdt),
       ggr_usdt = VALUES(ggr_usdt), bonus_usdt = VALUES(bonus_usdt),
       commission_usdt = VALUES(commission_usdt), deposit_count = VALUES(deposit_count),
       deposit_users = VALUES(deposit_users), first_dep_users = VALUES(first_dep_users),
       bet_users = VALUES(bet_users), new_users = VALUES(new_users), dau = VALUES(dau),
       skipped_rows = VALUES(skipped_rows)`,
    [tenant.id, date, round4(agg.deposit), round4(agg.withdraw), round4(agg.turnover), round4(agg.payout),
     round4(agg.turnover - agg.payout), round4(agg.bonus), round4(agg.commission),
     agg.depositCount, agg.depositUsers, agg.firstDepUsers, agg.betUsers,
     Number(active?.new_users ?? 0), Number(active?.dau ?? 0), agg.skipped])
}

/**
 * 抽数任务。
 * 默认重算今天与前三天：BI 侧的注单派彩、提现终态会晚到，只算一次就永远缺那一块。
 * 半小时一轮的高频刷新只传 [0, -1]，把回填留给每日那一轮。
 */
export async function runPlatformBi(env: Env, offsets: number[] = [0, -1, -2, -3]): Promise<void> {
  for (const offset of offsets) {
    const date = statDate(offset)
    await forEachTenant(`platform-bi${offset}`, async () => { await collectTenantBi(env, date) })
  }
  log.info('平台总览抽数完成')
}

export interface OverviewRow {
  tenantId: number
  code: string
  name: string
  status: string
  planName: string | null
  depositUsdt: number
  withdrawUsdt: number
  turnoverUsdt: number
  ggrUsdt: number
  bonusUsdt: number
  commissionUsdt: number
  netGgrUsdt: number
  depositUsers: number
  firstDepUsers: number
  dau: number
  newUsers: number
  skippedRows: number
}

/** 各租户区间汇总。总览页的主表 */
export async function tenantOverview(from: string, to: string): Promise<OverviewRow[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT t.id AS tenant_id, t.code, t.name, t.status, bp.name AS plan_name,
            COALESCE(SUM(b.deposit_usdt),0) deposit_usdt,
            COALESCE(SUM(b.withdraw_usdt),0) withdraw_usdt,
            COALESCE(SUM(b.turnover_usdt),0) turnover_usdt,
            COALESCE(SUM(b.ggr_usdt),0) ggr_usdt,
            COALESCE(SUM(b.bonus_usdt),0) bonus_usdt,
            COALESCE(SUM(b.commission_usdt),0) commission_usdt,
            COALESCE(SUM(b.deposit_users),0) deposit_users,
            COALESCE(SUM(b.first_dep_users),0) first_dep_users,
            COALESCE(MAX(b.dau),0) dau,
            COALESCE(SUM(b.new_users),0) new_users,
            COALESCE(SUM(b.skipped_rows),0) skipped_rows
       FROM pf_tenant t
       LEFT JOIN pf_bi_daily b ON b.tenant_id = t.id AND b.stat_date BETWEEN ? AND ?
       LEFT JOIN pf_tenant_billing_plan tbp ON tbp.tenant_id = t.id AND tbp.ended_at IS NULL
       LEFT JOIN pf_billing_plan bp ON bp.id = tbp.billing_plan_id
      WHERE t.status <> 'closed'
      GROUP BY t.id
      ORDER BY ggr_usdt DESC`, [from, to])
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    status: r.status,
    planName: r.plan_name ?? null,
    depositUsdt: Number(r.deposit_usdt),
    withdrawUsdt: Number(r.withdraw_usdt),
    turnoverUsdt: Number(r.turnover_usdt),
    ggrUsdt: Number(r.ggr_usdt),
    bonusUsdt: Number(r.bonus_usdt),
    commissionUsdt: Number(r.commission_usdt),
    netGgrUsdt: round4(Number(r.ggr_usdt) - Number(r.bonus_usdt) - Number(r.commission_usdt)),
    depositUsers: Number(r.deposit_users),
    firstDepUsers: Number(r.first_dep_users),
    dau: Number(r.dau),
    newUsers: Number(r.new_users),
    skippedRows: Number(r.skipped_rows),
  }))
}

/** 全平台日趋势（所有租户合计） */
export async function platformTrend(from: string, to: string): Promise<Array<{
  statDate: string; depositUsdt: number; turnoverUsdt: number; ggrUsdt: number; dau: number; tenants: number
}>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT stat_date, SUM(deposit_usdt) deposit_usdt, SUM(turnover_usdt) turnover_usdt,
            SUM(ggr_usdt) ggr_usdt, SUM(dau) dau, COUNT(*) tenants
       FROM pf_bi_daily WHERE stat_date BETWEEN ? AND ?
      GROUP BY stat_date ORDER BY stat_date DESC`, [from, to])
  return rows.map((r) => ({
    statDate: r.stat_date instanceof Date ? r.stat_date.toISOString().slice(0, 10) : String(r.stat_date).slice(0, 10),
    depositUsdt: Number(r.deposit_usdt),
    turnoverUsdt: Number(r.turnover_usdt),
    ggrUsdt: Number(r.ggr_usdt),
    dau: Number(r.dau),
    tenants: Number(r.tenants),
  }))
}
