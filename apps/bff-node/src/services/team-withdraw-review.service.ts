import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { RULE_META, loadReviewConfig, type RuleResult, type ReviewVerdict } from './withdraw-review.service.js'
import { broadcastBadges } from './sse-badges.js'

interface TeamWithdrawal {
  id: number
  userId: string
  amountCents: number
  status: 'pending' | 'approved' | 'rejected'
}

interface ReviewContext {
  pool: Pool
  withdrawal: TeamWithdrawal
  since: string
  depositCents: number
  lifetimeDepositCount: number
  approvedTeamWithdrawCount: number
  uplineBlacklisted: boolean
  relatedIpAccounts: number
  tamperOrphanRounds: number
  commissionEarnedCents: number
  commissionDownlineGgrCents: number
  commissionDupGroups: number
}

interface RuleConfig {
  enabled: boolean
  threshold: number | null
  params: Record<string, unknown> | null
}

type Rule = (ctx: ReviewContext, cfg: RuleConfig) => Promise<RuleResult> | RuleResult

const TEAM_RULES: Record<string, Rule> = {
  large_amount(ctx, cfg) {
    const threshold = Number((cfg.params ?? {}).phpCents)
    if (!Number.isFinite(threshold) || threshold <= 0) return { code: 'large_amount', verdict: 'pass' }
    const hit = ctx.withdrawal.amountCents > threshold
    return { code: 'large_amount', verdict: hit ? 'manual' : 'pass', actualValue: ctx.withdrawal.amountCents, threshold }
  },

  deposit_source(ctx) {
    const hit = ctx.lifetimeDepositCount === 0
    return { code: 'deposit_source', verdict: hit ? 'manual' : 'pass', detail: { lifetimeDepositCount: ctx.lifetimeDepositCount } }
  },

  first_withdraw_no_deposit(ctx) {
    const hit = ctx.approvedTeamWithdrawCount === 0 && ctx.lifetimeDepositCount === 0
    return { code: 'first_withdraw_no_deposit', verdict: hit ? 'manual' : 'pass' }
  },

  upline_blacklist(ctx) {
    return { code: 'upline_blacklist', verdict: ctx.uplineBlacklisted ? 'manual' : 'pass' }
  },

  same_ip_device(ctx, cfg) {
    const ipTh = Number((cfg.params ?? {}).ip ?? 3)
    const hit = ctx.relatedIpAccounts >= ipTh
    return {
      code: 'same_ip_device',
      verdict: hit ? 'manual' : 'pass',
      actualValue: ctx.relatedIpAccounts,
      threshold: ipTh,
      detail: { relatedIpAccounts: ctx.relatedIpAccounts, relatedDeviceAccounts: 0 },
    }
  },

  tampered_bet(ctx) {
    const hit = ctx.tamperOrphanRounds > 0
    return { code: 'tampered_bet', verdict: hit ? 'manual' : 'pass', detail: { orphanRounds: ctx.tamperOrphanRounds } }
  },

  commission_anomaly(ctx) {
    const dup = ctx.commissionDupGroups > 0
    const noGgr = ctx.commissionEarnedCents > 0 && ctx.commissionDownlineGgrCents <= 0
    return {
      code: 'commission_anomaly',
      verdict: dup || noGgr ? 'manual' : 'pass',
      detail: {
        dupGroups: ctx.commissionDupGroups,
        earnedCents: ctx.commissionEarnedCents,
        downlineGgrCents: ctx.commissionDownlineGgrCents,
      },
    }
  },
}

async function buildContext(pool: Pool, withdrawal: TeamWithdrawal): Promise<ReviewContext> {
  const userId = withdrawal.userId
  const [[user]] = await pool.query<RowDataPacket[]>(
    `SELECT u.registered_at, inv.status AS inviter_status
     FROM bg_user u LEFT JOIN bg_user inv ON inv.id = u.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )
  const registeredAt = user?.registered_at ? new Date(user.registered_at as Date) : new Date(0)
  const uplineBlacklisted = user?.inviter_status === 'banned' || user?.inviter_status === 'frozen'

  const [[tw]] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(reviewed_at) AS last_at, COUNT(*) AS cnt
     FROM bg_team_withdrawal WHERE user_id = ? AND status = 'approved'`,
    [userId],
  )
  const approvedTeamWithdrawCount = Number(tw?.cnt ?? 0)
  const sinceDate = tw?.last_at ? new Date(tw.last_at as Date) : registeredAt

  const [[dep]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? THEN ROUND(amount * 100) END), 0) AS window_cents,
       COUNT(*) AS lifetime_cnt
     FROM bg_deposit_order WHERE user_id = ? AND status = 'paid'`,
    [sinceDate, userId],
  )

  const [[ip]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  const [[orphan]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT round_id
       FROM bg_bet_order
       WHERE user_id = ? AND status = 'settled' AND created_at > ? AND round_id IS NOT NULL
       GROUP BY round_id
       HAVING SUM(bet_type = 'bet') = 0 AND SUM(bet_type IN ('win','refund')) > 0
     ) t`,
    [userId, sinceDate],
  )

  const [[comm]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(commission_cents), 0) AS earned,
       COALESCE(SUM(ggr_cents), 0) AS downline_ggr
     FROM bg_team_commission WHERE beneficiary_id = ? AND status <> 'voided'`,
    [userId],
  )
  const [[dup]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT 1 FROM bg_team_commission
       WHERE beneficiary_id = ?
       GROUP BY from_user_id, level, period HAVING COUNT(*) > 1
     ) t`,
    [userId],
  )

  return {
    pool,
    withdrawal,
    since: sinceDate.toISOString(),
    depositCents: Number(dep?.window_cents ?? 0),
    lifetimeDepositCount: Number(dep?.lifetime_cnt ?? 0),
    approvedTeamWithdrawCount,
    uplineBlacklisted,
    relatedIpAccounts: Number(ip?.cnt ?? 0),
    tamperOrphanRounds: Number(orphan?.cnt ?? 0),
    commissionEarnedCents: Number(comm?.earned ?? 0),
    commissionDownlineGgrCents: Number(comm?.downline_ggr ?? 0),
    commissionDupGroups: Number(dup?.cnt ?? 0),
  }
}

function snapshotOf(ctx: ReviewContext): Record<string, number | string | boolean> {
  return {
    since: ctx.since,
    amountCents: ctx.withdrawal.amountCents,
    depositCents: ctx.depositCents,
    lifetimeDepositCount: ctx.lifetimeDepositCount,
    approvedTeamWithdrawCount: ctx.approvedTeamWithdrawCount,
    uplineBlacklisted: ctx.uplineBlacklisted,
    relatedIpAccounts: ctx.relatedIpAccounts,
    tamperOrphanRounds: ctx.tamperOrphanRounds,
    commissionEarnedCents: ctx.commissionEarnedCents,
    commissionDownlineGgrCents: ctx.commissionDownlineGgrCents,
    commissionDupGroups: ctx.commissionDupGroups,
  }
}

async function approveTeamWithdrawal(env: Env, withdrawalId: number): Promise<void> {
  const res = await fetch(`${env.CORE_NODE_URL}/internal/team/withdrawal/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_TOKEN },
    body: JSON.stringify({ withdrawalId }),
  })
  if (!res.ok) throw new Error('team withdrawal approval failed')
}

export async function reviewTeamWithdrawal(env: Env, _redis: Redis, withdrawalId: number, round = 1): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, amount_cents, status FROM bg_team_withdrawal WHERE id = ? LIMIT 1`,
    [withdrawalId],
  )
  if (!row || row.status !== 'pending') return

  const withdrawal: TeamWithdrawal = {
    id: Number(row.id),
    userId: String(row.user_id),
    amountCents: Number(row.amount_cents),
    status: row.status,
  }
  const t0 = Date.now()
  let verdict: ReviewVerdict = 'manual'
  let snapshot: Record<string, unknown> | null = null

  try {
    const config = await loadReviewConfig(pool, 'team')
    const ctx = await buildContext(pool, withdrawal)
    snapshot = snapshotOf(ctx)
    const results: RuleResult[] = []
    for (const [code, rule] of Object.entries(TEAM_RULES)) {
      const cfg = config[code]
      if (!cfg || !cfg.enabled) { results.push({ code, verdict: 'skipped' }); continue }
      try {
        results.push(await rule(ctx, cfg))
      } catch (err) {
        results.push({ code, verdict: 'error', detail: { error: err instanceof Error ? err.message : String(err) } })
      }
    }
    for (const r of results) {
      await pool.execute(
        `INSERT INTO bg_team_withdraw_review_log (withdrawal_id, user_id, rule_code, round, verdict, actual_value, threshold, detail)
         VALUES (?,?,?,?,?,?,?,?)`,
        [withdrawal.id, withdrawal.userId, r.code, round, r.verdict,
         r.actualValue ?? null, r.threshold ?? null, r.detail ? JSON.stringify(r.detail) : null],
      )
    }
    verdict = results.some((r) => r.verdict === 'manual' || r.verdict === 'error') ? 'manual' : 'pass'
  } catch (err) {
    await pool.execute(
      `INSERT INTO bg_team_withdraw_review_log (withdrawal_id, user_id, rule_code, round, verdict, detail)
       VALUES (?,?,?,?,?,?)`,
      [withdrawal.id, withdrawal.userId, '_engine', round, 'error',
       JSON.stringify({ error: err instanceof Error ? err.message : String(err) })],
    ).catch(() => {})
    verdict = 'manual'
  }

  await pool.execute(
    `UPDATE bg_team_withdrawal
       SET review_verdict = ?, reviewed_at = NOW(3), review_round = ?, review_ms = ?, review_snapshot = ?
     WHERE id = ?`,
    [verdict, round, Date.now() - t0, snapshot ? JSON.stringify(snapshot) : null, withdrawal.id],
  )

  if (verdict === 'pass') {
    try {
      await approveTeamWithdrawal(env, withdrawal.id)
    } catch {
      await pool.execute(
        `UPDATE bg_team_withdrawal SET review_verdict = 'manual' WHERE id = ? AND status = 'pending'`,
        [withdrawal.id],
      )
      broadcastBadges(env).catch(() => {})
    }
  } else {
    broadcastBadges(env).catch(() => {})
  }
}

export async function rerunTeamWithdrawalReview(env: Env, redis: Redis, withdrawalId: number): Promise<{ round: number }> {
  if (!isMysqlEnabled(env)) return { round: 0 }
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round), 0) AS r FROM bg_team_withdraw_review_log WHERE withdrawal_id = ?`,
    [withdrawalId],
  )
  const nextRound = Number(row?.r ?? 0) + 1
  await reviewTeamWithdrawal(env, redis, withdrawalId, nextRound)
  return { round: nextRound }
}
