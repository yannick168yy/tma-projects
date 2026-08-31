import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { getExchangeRate } from './exchange-rate.service.js'

// BI 日聚合：把一个马尼拉统计日的数据重算进 bi_* 聚合表。
// 全量重算当日窗口 + 事务内先删后插，天然幂等，可任意回填。
// 数据源只读业务表的窄时间范围（走 created_at 索引），方案见 docs/bi-analytics-plan.md。

const DAY_MS = 24 * 60 * 60 * 1000

export function manilaToday(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

// 马尼拉日 D = UTC [D-1 16:00, D 16:00)，业务表 created_at 均为 UTC
function businessWindow(date: string, offset: 7 | 8): { start: string; end: string } {
  const startMs = Date.parse(`${date}T00:00:00+0${offset}:00`)
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  return { start: fmt(startMs), end: fmt(startMs + DAY_MS) }
}

const BONUS_LEDGER_TYPES = "'bonus','red_packet','rebate','vip_bonus','task_bonus'"
// channel='admin' 是后台调整余额写入的 paid/completed 单，不是真实充值/提现，运营口径全部排除
const NOT_ADMIN = "channel<>'admin'"

export async function aggregateBiDay(app: FastifyInstance, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date: ${date}`)
  const ph = businessWindow(date, 8)
  const id = businessWindow(date, 7)
  const { start, end } = ph
  const moneyWindow = (alias = '') => `((${alias}currency='IDR' AND ${alias}created_at>=? AND ${alias}created_at<?) OR (${alias}currency<>'IDR' AND ${alias}created_at>=? AND ${alias}created_at<?))`
  const moneyParams = [id.start, id.end, ph.start, ph.end]
  const db = app.mysql

  // ---- 平台按币种（JS 合并多数据源） ----
  const byCur = new Map<string, Record<string, number>>()
  const acc = (cur: string, patch: Record<string, number>) => {
    const row = byCur.get(cur) ?? {}
    Object.assign(row, patch)
    byCur.set(cur, row)
  }

  const [deps] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt, COUNT(DISTINCT user_id) users
     FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND ${moneyWindow()} GROUP BY currency`,
    moneyParams,
  )
  for (const r of deps) acc(r.currency, { depositAmount: Number(r.amt), depositCount: Number(r.cnt), depositUsers: Number(r.users) })

  const [wds] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt
     FROM bg_withdraw_order WHERE status IN ('completed','processing') AND ${NOT_ADMIN} AND ${moneyWindow()} GROUP BY currency`,
    moneyParams,
  )
  for (const r of wds) acc(r.currency, { withdrawAmount: Number(r.amt), withdrawCount: Number(r.cnt) })

  const [bets] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) stake,
            COALESCE(SUM(CASE WHEN status='settled' THEN win_loss ELSE 0 END),0) payout,
            COUNT(DISTINCT user_id) users
     FROM bg_568win_wallet_txn
     WHERE txn_type='bet' AND voided_at IS NULL AND ${moneyWindow()} GROUP BY currency`,
    moneyParams,
  )
  for (const r of bets) acc(r.currency, { betAmount: Number(r.stake), payoutAmount: Number(r.payout), betCount: Number(r.cnt), betUsers: Number(r.users) })

  const [bonus] = await db.query<RowDataPacket[]>(
    `SELECT currency, COALESCE(SUM(amount),0) amt
     FROM bg_wallet_ledger WHERE type IN (${BONUS_LEDGER_TYPES}) AND amount>0 AND ${moneyWindow()} GROUP BY currency`,
    moneyParams,
  )
  for (const r of bonus) acc(r.currency, { bonusCost: Number(r.amt) })

  // 首充=该用户平台首笔已支付充值发生在当日（同秒双笔的极端情况用 DISTINCT user_id 保人数不重）
  const [fdeps] = await db.query<RowDataPacket[]>(
    `SELECT d.currency, COUNT(DISTINCT d.user_id) users, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} GROUP BY user_id) f
       ON f.user_id=d.user_id AND f.first_at=d.created_at
     WHERE d.status='paid' AND d.channel<>'admin' AND ${moneyWindow('d.')} GROUP BY d.currency`,
    moneyParams,
  )
  for (const r of fdeps) acc(r.currency, { firstDepUsers: Number(r.users), firstDepAmount: Number(r.amt) })

  // ---- 用户活跃（不分币种）：DAU=登录∪投注∪充值 ----
  const activeFor = async (market: 'PH' | 'ID', window: { start: string; end: string }) => {
    const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM bg_user WHERE market=? AND registered_at>=? AND registered_at<?) new_users,
      (SELECT COUNT(*) FROM bg_login_log l JOIN bg_user lu ON lu.id=l.user_id WHERE lu.market=? AND l.created_at>=? AND l.created_at<?) login_count,
      (SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM bg_login_log WHERE created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_568win_wallet_txn WHERE txn_type='bet' AND created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND created_at>=? AND created_at<?
      ) a JOIN bg_user u ON u.id=a.user_id WHERE u.market=?) dau`,
      [market, window.start, window.end, market, window.start, window.end,
       window.start, window.end, window.start, window.end, window.start, window.end, market],
    )
    return row
  }
  const [activePh, activeId] = await Promise.all([activeFor('PH', ph), activeFor('ID', id)])

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`DELETE FROM bi_daily_platform WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_active WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_provider WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_game WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_acquisition WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_user WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_user_active_day WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_channel WHERE stat_date=?`, [date])

    for (const [currency, m] of byCur) {
      await conn.execute(
        `INSERT INTO bi_daily_platform
           (stat_date, currency, deposit_amount, deposit_count, deposit_users, withdraw_amount, withdraw_count,
            bet_amount, payout_amount, bet_count, bet_users, bonus_cost, first_dep_users, first_dep_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [date, currency,
         m.depositAmount ?? 0, m.depositCount ?? 0, m.depositUsers ?? 0,
         m.withdrawAmount ?? 0, m.withdrawCount ?? 0,
         m.betAmount ?? 0, m.payoutAmount ?? 0, m.betCount ?? 0, m.betUsers ?? 0,
         m.bonusCost ?? 0, m.firstDepUsers ?? 0, m.firstDepAmount ?? 0],
      )
      const rateToUsdt = await getExchangeRate(currency, 'USDT', app.redis)
      await conn.execute(
        `INSERT INTO bi_daily_exchange_rate (stat_date, currency, rate_to_usdt, source)
         VALUES (?,?,?,'managed')
         ON DUPLICATE KEY UPDATE rate_to_usdt=VALUES(rate_to_usdt), source=VALUES(source), captured_at=NOW(3)`,
        [date, currency, rateToUsdt],
      )
    }

    const activeAll = {
      new_users: Number(activePh?.new_users ?? 0) + Number(activeId?.new_users ?? 0),
      dau: Number(activePh?.dau ?? 0) + Number(activeId?.dau ?? 0),
      login_count: Number(activePh?.login_count ?? 0) + Number(activeId?.login_count ?? 0),
    }
    for (const [market, active] of [['ALL', activeAll], ['PH', activePh], ['ID', activeId]] as const) {
      await conn.execute(
        `INSERT INTO bi_daily_active (stat_date, market, new_users, dau, login_count) VALUES (?,?,?,?,?)`,
        [date, market, Number(active?.new_users ?? 0), Number(active?.dau ?? 0), Number(active?.login_count ?? 0)],
      )
    }

    // 厂商归因必须 (gpid, game_id) 复合键；provider_id 为 GameId 字符串，CAST 后走游戏表主键
    await conn.execute(
      `INSERT INTO bi_daily_provider (stat_date, provider, currency, bet_count, bet_users, bet_amount, payout_amount)
       SELECT ?, COALESCE(g.provider,'Unknown'), t.currency, COUNT(*), COUNT(DISTINCT t.user_id),
              COALESCE(SUM(t.amount),0), COALESCE(SUM(CASE WHEN t.status='settled' THEN t.win_loss ELSE 0 END),0)
       FROM bg_568win_wallet_txn t
       LEFT JOIN bg_568win_game g ON g.game_provider_id=t.gpid AND g.game_id=CAST(t.provider_id AS UNSIGNED)
       WHERE t.txn_type='bet' AND t.voided_at IS NULL AND ${moneyWindow('t.')}
       GROUP BY COALESCE(g.provider,'Unknown'), t.currency`,
      [date, ...moneyParams],
    )

    await conn.execute(
      `INSERT INTO bi_daily_game (stat_date, game_provider_id, game_id, currency, bet_count, bet_users, bet_amount, payout_amount)
       SELECT ?, COALESCE(t.gpid,0), COALESCE(CAST(t.provider_id AS UNSIGNED),0), t.currency,
              COUNT(*), COUNT(DISTINCT t.user_id),
              COALESCE(SUM(t.amount),0), COALESCE(SUM(CASE WHEN t.status='settled' THEN t.win_loss ELSE 0 END),0)
       FROM bg_568win_wallet_txn t
       WHERE t.txn_type='bet' AND t.voided_at IS NULL AND ${moneyWindow('t.')}
       GROUP BY COALESCE(t.gpid,0), COALESCE(CAST(t.provider_id AS UNSIGNED),0), t.currency`,
      [date, ...moneyParams],
    )

    // 渠道：注册/首充按注册入口归因，DAU 按当日登录入口归因，三源 JS 合并
    const srcMap = new Map<string, { newUsers: number; dau: number; firstDep: number }>()
    const src = (s: string | null) => {
      const key = s || 'unknown'
      let row = srcMap.get(key)
      if (!row) { row = { newUsers: 0, dau: 0, firstDep: 0 }; srcMap.set(key, row) }
      return row
    }
    const [regRows] = await conn.query<RowDataPacket[]>(
      `SELECT register_entry_source s, COUNT(*) cnt FROM bg_user WHERE registered_at>=? AND registered_at<? GROUP BY register_entry_source`,
      [start, end],
    )
    for (const r of regRows) src(r.s).newUsers = Number(r.cnt)
    const [dauRows] = await conn.query<RowDataPacket[]>(
      `SELECT entry_source s, COUNT(DISTINCT user_id) cnt FROM bg_login_log WHERE created_at>=? AND created_at<? GROUP BY entry_source`,
      [start, end],
    )
    for (const r of dauRows) src(r.s).dau = Number(r.cnt)
    const [fdSrcRows] = await conn.query<RowDataPacket[]>(
      `SELECT u.register_entry_source s, COUNT(DISTINCT d.user_id) cnt
       FROM bg_deposit_order d
       JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} GROUP BY user_id) f
         ON f.user_id=d.user_id AND f.first_at=d.created_at
       JOIN bg_user u ON u.id=d.user_id
       WHERE d.status='paid' AND d.channel<>'admin' AND d.created_at>=? AND d.created_at<? GROUP BY u.register_entry_source`,
      [start, end],
    )
    for (const r of fdSrcRows) src(r.s).firstDep = Number(r.cnt)
    for (const [entrySource, m] of srcMap) {
      await conn.execute(
        `INSERT INTO bi_daily_acquisition (stat_date, entry_source, new_users, dau, first_dep_users) VALUES (?,?,?,?,?)`,
        [date, entrySource, m.newUsers, m.dau, m.firstDep],
      )
    }

    // 用户日聚合：四个资金来源合并进 bi_daily_user
    await conn.execute(
      `INSERT INTO bi_daily_user (stat_date, user_id, currency, bet_amount, payout_amount, bet_count)
       SELECT ?, user_id, currency, COALESCE(SUM(amount),0),
              COALESCE(SUM(CASE WHEN status='settled' THEN win_loss ELSE 0 END),0), COUNT(*)
       FROM bg_568win_wallet_txn
       WHERE txn_type='bet' AND voided_at IS NULL AND ${moneyWindow()}
       GROUP BY user_id, currency`,
      [date, ...moneyParams],
    )
    await conn.execute(
      `INSERT INTO bi_daily_user (stat_date, user_id, currency, deposit_amount)
       SELECT ?, user_id, currency, COALESCE(SUM(amount),0)
       FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND ${moneyWindow()}
       GROUP BY user_id, currency
       ON DUPLICATE KEY UPDATE deposit_amount=VALUES(deposit_amount)`,
      [date, ...moneyParams],
    )
    await conn.execute(
      `INSERT INTO bi_daily_user (stat_date, user_id, currency, withdraw_amount)
       SELECT ?, user_id, currency, COALESCE(SUM(amount),0)
       FROM bg_withdraw_order WHERE status IN ('completed','processing') AND ${NOT_ADMIN} AND ${moneyWindow()}
       GROUP BY user_id, currency
       ON DUPLICATE KEY UPDATE withdraw_amount=VALUES(withdraw_amount)`,
      [date, ...moneyParams],
    )
    await conn.execute(
      `INSERT INTO bi_daily_user (stat_date, user_id, currency, bonus_amount)
       SELECT ?, user_id, currency, COALESCE(SUM(amount),0)
       FROM bg_wallet_ledger WHERE type IN (${BONUS_LEDGER_TYPES}) AND amount>0 AND ${moneyWindow()}
       GROUP BY user_id, currency
       ON DUPLICATE KEY UPDATE bonus_amount=VALUES(bonus_amount)`,
      [date, ...moneyParams],
    )

    // 支付通道：只统计终态订单，成功率与处理时长
    await conn.execute(
      `INSERT INTO bi_daily_channel (stat_date, direction, channel, total, success, avg_secs)
       SELECT ?, 'deposit', channel, COUNT(*), SUM(status='paid'),
              AVG(CASE WHEN status='paid' THEN TIMESTAMPDIFF(SECOND, created_at, updated_at) END)
       FROM bg_deposit_order
       WHERE status IN ('paid','failed','rejected','admin_rejected') AND ${NOT_ADMIN} AND created_at>=? AND created_at<?
       GROUP BY channel`,
      [date, start, end],
    )
    await conn.execute(
      `INSERT INTO bi_daily_channel (stat_date, direction, channel, total, success, avg_secs)
       SELECT ?, 'withdraw', channel, COUNT(*), SUM(status='completed'),
              AVG(CASE WHEN status='completed' THEN TIMESTAMPDIFF(SECOND, created_at, updated_at) END)
       FROM bg_withdraw_order
       WHERE status IN ('completed','failed','rejected','admin_rejected') AND ${NOT_ADMIN} AND created_at>=? AND created_at<?
       GROUP BY channel`,
      [date, start, end],
    )

    await conn.execute(
      `INSERT IGNORE INTO bi_user_active_day (stat_date, user_id)
       SELECT DISTINCT ?, user_id FROM (
         SELECT user_id FROM bg_login_log WHERE created_at>=? AND created_at<?
         UNION SELECT user_id FROM bg_568win_wallet_txn WHERE txn_type='bet' AND created_at>=? AND created_at<?
         UNION SELECT user_id FROM bg_deposit_order WHERE status='paid' AND ${NOT_ADMIN} AND created_at>=? AND created_at<?
       ) u`,
      [date, start, end, start, end, start, end],
    )

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function aggregateBiRange(app: FastifyInstance, from: string, to: string): Promise<number> {
  let count = 0
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += DAY_MS) {
    await aggregateBiDay(app, new Date(ms).toISOString().slice(0, 10))
    count++
  }
  return count
}

// ---- RTP 异常检测（P2）：厂商当日 RTP 偏离自身 28 天基线 |z|>=3 时写告警 ----
const RTP_MIN_BET_COUNT = 30      // 当日注单数低于此值样本太小，不检测
const RTP_MIN_BASELINE_DAYS = 7   // 基线样本天数下限
const RTP_BASELINE_DAYS = 28
const RTP_SIGMA_FLOOR = 0.02      // σ 下限，防止基线太稳导致 z 爆表

export async function detectBiAlerts(app: FastifyInstance, date: string): Promise<number> {
  const db = app.mysql
  const fromDate = new Date(Date.parse(`${date}T00:00:00Z`) - RTP_BASELINE_DAYS * DAY_MS)
    .toISOString().slice(0, 10)

  const [curRows] = await db.query<RowDataPacket[]>(
    `SELECT provider, currency, bet_amount, payout_amount, bet_count
     FROM bi_daily_provider WHERE stat_date=? AND provider<>'Unknown'`,
    [date],
  )
  const [histRows] = await db.query<RowDataPacket[]>(
    `SELECT provider, currency, bet_amount, payout_amount
     FROM bi_daily_provider WHERE stat_date>=? AND stat_date<? AND provider<>'Unknown'`,
    [fromDate, date],
  )

  const baseline = new Map<string, number[]>()
  for (const r of histRows) {
    const stake = Number(r.bet_amount)
    if (stake <= 0) continue
    const key = `${r.provider}|${r.currency}`
    const arr = baseline.get(key) ?? []
    arr.push(Number(r.payout_amount) / stake)
    baseline.set(key, arr)
  }

  let inserted = 0
  for (const r of curRows) {
    const stake = Number(r.bet_amount)
    if (stake <= 0 || Number(r.bet_count) < RTP_MIN_BET_COUNT) continue
    const samples = baseline.get(`${r.provider}|${r.currency}`)
    if (!samples || samples.length < RTP_MIN_BASELINE_DAYS) continue

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length
    const sigma = Math.max(Math.sqrt(variance), RTP_SIGMA_FLOOR)
    const rtp = Number(r.payout_amount) / stake
    const z = (rtp - mean) / sigma
    if (Math.abs(z) < 3) continue

    const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
      `INSERT IGNORE INTO bi_alert (stat_date, alert_type, dimension, currency, value, baseline, deviation, severity)
       VALUES (?,'provider_rtp',?,?,?,?,?,?)`,
      [date, r.provider, r.currency, rtp, mean, Math.round(z * 100) / 100, Math.abs(z) >= 4 ? 'critical' : 'warn'],
    )
    inserted += res.affectedRows
  }
  // 通道成功率告警：终态订单 >=10 且成功率 <80%（<50% 升级 critical）
  const [chRows] = await db.query<RowDataPacket[]>(
    `SELECT direction, channel, total, success FROM bi_daily_channel WHERE stat_date=? AND total>=10`,
    [date],
  )
  for (const r of chRows) {
    const rate = Number(r.success) / Number(r.total)
    if (rate >= 0.8) continue
    const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
      `INSERT IGNORE INTO bi_alert (stat_date, alert_type, dimension, currency, value, baseline, deviation, severity)
       VALUES (?,'channel_success',?,'',?,0.8,0,?)`,
      [date, `${r.direction}:${r.channel}`, Math.round(rate * 10000) / 10000, rate < 0.5 ? 'critical' : 'warn'],
    )
    inserted += res.affectedRows
  }

  if (inserted > 0) app.log.warn({ date, inserted }, '[bi-alert] anomalies detected')
  return inserted
}
