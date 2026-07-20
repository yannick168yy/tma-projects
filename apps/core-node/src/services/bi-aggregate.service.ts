import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'

// BI 日聚合：把一个马尼拉统计日的数据重算进 bi_* 聚合表。
// 全量重算当日窗口 + 事务内先删后插，天然幂等，可任意回填。
// 数据源只读业务表的窄时间范围（走 created_at 索引），方案见 docs/bi-analytics-plan.md。

const DAY_MS = 24 * 60 * 60 * 1000

export function manilaToday(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

// 马尼拉日 D = UTC [D-1 16:00, D 16:00)，业务表 created_at 均为 UTC
function manilaWindow(date: string): { start: string; end: string } {
  const startMs = Date.parse(`${date}T00:00:00+08:00`)
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  return { start: fmt(startMs), end: fmt(startMs + DAY_MS) }
}

const BONUS_LEDGER_TYPES = "'bonus','red_packet','rebate','vip_bonus','task_bonus'"

export async function aggregateBiDay(app: FastifyInstance, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date: ${date}`)
  const { start, end } = manilaWindow(date)
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
     FROM bg_deposit_order WHERE status='paid' AND created_at>=? AND created_at<? GROUP BY currency`,
    [start, end],
  )
  for (const r of deps) acc(r.currency, { depositAmount: Number(r.amt), depositCount: Number(r.cnt), depositUsers: Number(r.users) })

  const [wds] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) amt
     FROM bg_withdraw_order WHERE status IN ('completed','processing') AND created_at>=? AND created_at<? GROUP BY currency`,
    [start, end],
  )
  for (const r of wds) acc(r.currency, { withdrawAmount: Number(r.amt), withdrawCount: Number(r.cnt) })

  const [bets] = await db.query<RowDataPacket[]>(
    `SELECT currency, COUNT(*) cnt, COALESCE(SUM(amount),0) stake,
            COALESCE(SUM(CASE WHEN status='settled' THEN win_loss ELSE 0 END),0) payout,
            COUNT(DISTINCT user_id) users
     FROM bg_568win_wallet_txn
     WHERE txn_type='bet' AND voided_at IS NULL AND created_at>=? AND created_at<? GROUP BY currency`,
    [start, end],
  )
  for (const r of bets) acc(r.currency, { betAmount: Number(r.stake), payoutAmount: Number(r.payout), betCount: Number(r.cnt), betUsers: Number(r.users) })

  const [bonus] = await db.query<RowDataPacket[]>(
    `SELECT currency, COALESCE(SUM(amount),0) amt
     FROM bg_wallet_ledger WHERE type IN (${BONUS_LEDGER_TYPES}) AND amount>0 AND created_at>=? AND created_at<? GROUP BY currency`,
    [start, end],
  )
  for (const r of bonus) acc(r.currency, { bonusCost: Number(r.amt) })

  // 首充=该用户平台首笔已支付充值发生在当日（同秒双笔的极端情况用 DISTINCT user_id 保人数不重）
  const [fdeps] = await db.query<RowDataPacket[]>(
    `SELECT d.currency, COUNT(DISTINCT d.user_id) users, COALESCE(SUM(d.amount),0) amt
     FROM bg_deposit_order d
     JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' GROUP BY user_id) f
       ON f.user_id=d.user_id AND f.first_at=d.created_at
     WHERE d.status='paid' AND d.created_at>=? AND d.created_at<? GROUP BY d.currency`,
    [start, end],
  )
  for (const r of fdeps) acc(r.currency, { firstDepUsers: Number(r.users), firstDepAmount: Number(r.amt) })

  // ---- 用户活跃（不分币种）：DAU=登录∪投注∪充值 ----
  const [[active]] = await db.query<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM bg_user WHERE registered_at>=? AND registered_at<?) new_users,
      (SELECT COUNT(*) FROM bg_login_log WHERE created_at>=? AND created_at<?) login_count,
      (SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM bg_login_log WHERE created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_568win_wallet_txn WHERE txn_type='bet' AND created_at>=? AND created_at<?
        UNION SELECT user_id FROM bg_deposit_order WHERE status='paid' AND created_at>=? AND created_at<?
      ) u) dau`,
    [start, end, start, end, start, end, start, end, start, end],
  )

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(`DELETE FROM bi_daily_platform WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_active WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_provider WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_game WHERE stat_date=?`, [date])
    await conn.execute(`DELETE FROM bi_daily_acquisition WHERE stat_date=?`, [date])

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
    }

    await conn.execute(
      `INSERT INTO bi_daily_active (stat_date, new_users, dau, login_count) VALUES (?,?,?,?)`,
      [date, Number(active?.new_users ?? 0), Number(active?.dau ?? 0), Number(active?.login_count ?? 0)],
    )

    // 厂商归因必须 (gpid, game_id) 复合键；provider_id 为 GameId 字符串，CAST 后走游戏表主键
    await conn.execute(
      `INSERT INTO bi_daily_provider (stat_date, provider, currency, bet_count, bet_users, bet_amount, payout_amount)
       SELECT ?, COALESCE(g.provider,'Unknown'), t.currency, COUNT(*), COUNT(DISTINCT t.user_id),
              COALESCE(SUM(t.amount),0), COALESCE(SUM(CASE WHEN t.status='settled' THEN t.win_loss ELSE 0 END),0)
       FROM bg_568win_wallet_txn t
       LEFT JOIN bg_568win_game g ON g.game_provider_id=t.gpid AND g.game_id=CAST(t.provider_id AS UNSIGNED)
       WHERE t.txn_type='bet' AND t.voided_at IS NULL AND t.created_at>=? AND t.created_at<?
       GROUP BY COALESCE(g.provider,'Unknown'), t.currency`,
      [date, start, end],
    )

    await conn.execute(
      `INSERT INTO bi_daily_game (stat_date, game_provider_id, game_id, currency, bet_count, bet_users, bet_amount, payout_amount)
       SELECT ?, COALESCE(t.gpid,0), COALESCE(CAST(t.provider_id AS UNSIGNED),0), t.currency,
              COUNT(*), COUNT(DISTINCT t.user_id),
              COALESCE(SUM(t.amount),0), COALESCE(SUM(CASE WHEN t.status='settled' THEN t.win_loss ELSE 0 END),0)
       FROM bg_568win_wallet_txn t
       WHERE t.txn_type='bet' AND t.voided_at IS NULL AND t.created_at>=? AND t.created_at<?
       GROUP BY COALESCE(t.gpid,0), COALESCE(CAST(t.provider_id AS UNSIGNED),0), t.currency`,
      [date, start, end],
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
       JOIN (SELECT user_id, MIN(created_at) first_at FROM bg_deposit_order WHERE status='paid' GROUP BY user_id) f
         ON f.user_id=d.user_id AND f.first_at=d.created_at
       JOIN bg_user u ON u.id=d.user_id
       WHERE d.status='paid' AND d.created_at>=? AND d.created_at<? GROUP BY u.register_entry_source`,
      [start, end],
    )
    for (const r of fdSrcRows) src(r.s).firstDep = Number(r.cnt)
    for (const [entrySource, m] of srcMap) {
      await conn.execute(
        `INSERT INTO bi_daily_acquisition (stat_date, entry_source, new_users, dau, first_dep_users) VALUES (?,?,?,?,?)`,
        [date, entrySource, m.newUsers, m.dau, m.firstDep],
      )
    }

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
