import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import {
  RULE_META,
  loadReviewConfig,
  buildWin568ReviewStats,
  evalUpstreamReconcile,
  reconcileGraceMinutes,
  type RuleConfig,
  type RuleResult,
  type ReviewVerdict,
  type Win568ReviewStats,
} from './withdraw-review.service.js'
import { broadcastBadges } from './sse-badges.js'
import { notifyWithdrawManual } from './admin-notify.js'

interface TeamWithdrawal {
  id: number
  userId: string
  amountCents: number
  currency: 'PHP' | 'IDR' | 'USDT' | 'USDC'
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
  relatedDeviceIdAccounts: number
  relatedDeviceFpAccounts: number
  tamperOrphanRounds: number
  commissionEarnedCents: number
  commissionDownlineGgrCents: number
  commissionDupGroups: number
  /** 窗口内佣金入账（分） */
  windowCommissionCents: number
  /** 窗口起点前 30 天的佣金总和（分） */
  prior30dCommissionCents: number
  /** 窗口内来自新注册下线的佣金（分），口径随 fresh_downline_commission 的 params.days */
  freshCommissionCents: number
  /** 名下产生过佣金的下线累计真实存款（分） */
  downlineDepositCents: number
  /** 近 30 天与团队长共用 IP 的下线账号数 */
  downlineIpOverlap: number
  win568: Win568ReviewStats
}

type Rule = (ctx: ReviewContext, cfg: RuleConfig) => Promise<RuleResult> | RuleResult

const TEAM_RULES: Record<string, Rule> = {
  large_amount(ctx, cfg) {
    const threshold = teamCurrencyThreshold(ctx, cfg, '')
    if (!Number.isFinite(threshold) || threshold <= 0) return { code: 'large_amount', verdict: 'pass' }
    const amount = ctx.withdrawal.amountCents / 100
    const hit = amount > threshold
    return { code: 'large_amount', verdict: hit ? 'manual' : 'pass', actualValue: amount, threshold, detail: { currency: ctx.withdrawal.currency } }
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

  same_ip(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 3)
    const hit = ctx.relatedIpAccounts >= threshold
    return { code: 'same_ip', verdict: hit ? 'manual' : 'pass', actualValue: ctx.relatedIpAccounts, threshold }
  },

  same_device_id(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 2)
    const accountsTotal = ctx.relatedDeviceIdAccounts + 1
    const hit = accountsTotal >= threshold
    return {
      code: 'same_device_id',
      verdict: hit ? 'manual' : 'pass',
      actualValue: accountsTotal,
      threshold,
      detail: { relatedDeviceIdAccounts: ctx.relatedDeviceIdAccounts, accountsTotal },
    }
  },

  same_device_fp(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 2)
    const accountsTotal = ctx.relatedDeviceFpAccounts + 1
    const hit = accountsTotal >= threshold
    return {
      code: 'same_device_fp',
      verdict: hit ? 'manual' : 'pass',
      actualValue: accountsTotal,
      threshold,
      detail: { relatedDeviceFpAccounts: ctx.relatedDeviceFpAccounts, accountsTotal },
    }
  },

  tampered_bet(ctx) {
    const hit = ctx.tamperOrphanRounds > 0
    return { code: 'tampered_bet', verdict: hit ? 'manual' : 'pass', detail: { orphanRounds: ctx.tamperOrphanRounds } }
  },

  upstream_reconcile(ctx) {
    return evalUpstreamReconcile(ctx.win568)
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

  commission_surge(ctx, cfg) {
    const p = cfg.params ?? {}
    const mult = Number(p.mult ?? 1.0)
    const minCents = teamCurrencyThreshold(ctx, cfg, 'min') * 100
    const hit = ctx.windowCommissionCents >= minCents
      && ctx.windowCommissionCents > ctx.prior30dCommissionCents * mult
    return {
      code: 'commission_surge',
      verdict: hit ? 'manual' : 'pass',
      actualValue: ctx.windowCommissionCents,
      detail: { prior30dCents: ctx.prior30dCommissionCents, mult, minCents },
    }
  },

  fresh_downline_commission(ctx, cfg) {
    const p = cfg.params ?? {}
    const ratioTh = Number(p.ratio ?? 0.6)
    const minCents = teamCurrencyThreshold(ctx, cfg, 'min') * 100
    const total = ctx.windowCommissionCents
    const ratio = total > 0 ? ctx.freshCommissionCents / total : 0
    const hit = total >= minCents && ratio >= ratioTh
    return {
      code: 'fresh_downline_commission',
      verdict: hit ? 'manual' : 'pass',
      actualValue: Math.round(ratio * 100) / 100,
      detail: { freshCents: ctx.freshCommissionCents, totalCents: total, ratioTh, minCents },
    }
  },

  commission_deposit_ratio(ctx, cfg) {
    const p = cfg.params ?? {}
    const ratioTh = Number(p.ratio ?? 0.5)
    const minCents = teamCurrencyThreshold(ctx, cfg, 'min') * 100
    const hit = ctx.commissionEarnedCents >= minCents
      && ctx.commissionEarnedCents > ctx.downlineDepositCents * ratioTh
    return {
      code: 'commission_deposit_ratio',
      verdict: hit ? 'manual' : 'pass',
      actualValue: ctx.commissionEarnedCents,
      detail: { downlineDepositCents: ctx.downlineDepositCents, ratioTh, minCents },
    }
  },

  downline_ip_overlap(ctx, cfg) {
    const th = Number(cfg.threshold ?? 2)
    const hit = th > 0 && ctx.downlineIpOverlap >= th
    return {
      code: 'downline_ip_overlap',
      verdict: hit ? 'manual' : 'pass',
      actualValue: ctx.downlineIpOverlap,
      threshold: th,
    }
  },
}

function teamCurrencyThreshold(ctx: ReviewContext, cfg: RuleConfig, prefix: '' | 'min'): number {
  const suffix = ctx.withdrawal.currency === 'IDR'
    ? 'Idr'
    : ctx.withdrawal.currency === 'USDT' || ctx.withdrawal.currency === 'USDC'
      ? 'Usdt'
      : 'Php'
  const key = prefix ? `${prefix}${suffix}` : suffix.toLowerCase()
  const configured = Number(cfg.params?.[key])
  if (Number.isFinite(configured)) return configured
  return prefix ? Number(cfg.params?.minCents ?? 50000) / 100 : Number(cfg.threshold ?? 0)
}

async function buildContext(pool: Pool, withdrawal: TeamWithdrawal, config: Record<string, RuleConfig>, usdToPhpRate: number, idrToPhpRate: number): Promise<ReviewContext> {
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
  const targetToPhpRate = withdrawal.currency === 'IDR'
    ? idrToPhpRate
    : withdrawal.currency === 'USDT' || withdrawal.currency === 'USDC' ? usdToPhpRate : 1

  const [[dep]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? THEN ROUND(amount * (CASE WHEN currency IN ('USDT','USDC') THEN ? WHEN currency = 'IDR' THEN ? ELSE 1 END) / ? * 100) END), 0) AS window_cents,
       COUNT(*) AS lifetime_cnt
     FROM bg_deposit_order WHERE user_id = ? AND status = 'paid'`,
    [sinceDate, usdToPhpRate, idrToPhpRate, targetToPhpRate, userId],
  )

  const [[ip]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  const [[devId]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.device_id = l1.device_id AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.device_id IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  const [[devFp]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.fp_visitor = l1.fp_visitor AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.fp_visitor IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
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
     FROM bg_team_commission WHERE beneficiary_id = ? AND currency = ? AND status <> 'voided'`,
    [userId, withdrawal.currency],
  )
  const [[dup]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT 1 FROM bg_team_commission
       WHERE beneficiary_id = ? AND currency = ?
       GROUP BY from_user_id, level, period HAVING COUNT(*) > 1
     ) t`,
    [userId, withdrawal.currency],
  )

  // 佣金激增：窗口内 vs 窗口起点前 30 天
  const [[surge]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? THEN commission_cents END), 0) AS window_cents,
       COALESCE(SUM(CASE WHEN created_at <= ? AND created_at > DATE_SUB(?, INTERVAL 30 DAY) THEN commission_cents END), 0) AS prior_cents
     FROM bg_team_commission
     WHERE beneficiary_id = ? AND currency = ? AND status <> 'voided'`,
    [sinceDate, sinceDate, sinceDate, userId, withdrawal.currency],
  )

  // 新号佣金：窗口内来自「入账时注册龄 ≤ days 天」下线的佣金
  const freshDays = Math.max(1, Number(config.fresh_downline_commission?.params?.days ?? 7))
  const [[fresh]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(c.commission_cents), 0) AS fresh_cents
     FROM bg_team_commission c
     JOIN bg_user u ON u.id = c.from_user_id
     WHERE c.beneficiary_id = ? AND c.currency = ? AND c.status <> 'voided' AND c.created_at > ?
       AND u.registered_at > DATE_SUB(c.created_at, INTERVAL ? DAY)`,
    [userId, withdrawal.currency, sinceDate, freshDays],
  )

  // 名下产生过佣金的下线累计真实存款
  const [[ddep]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(ROUND(d.amount * (CASE WHEN d.currency IN ('USDT','USDC') THEN ? WHEN d.currency = 'IDR' THEN ? ELSE 1 END) / ? * 100)), 0) AS cents
     FROM bg_deposit_order d
     WHERE d.status = 'paid' AND d.user_id IN (
       SELECT DISTINCT from_user_id FROM bg_team_commission WHERE beneficiary_id = ? AND currency = ?
     )`,
    [usdToPhpRate, idrToPhpRate, targetToPhpRate, userId, withdrawal.currency],
  )

  // 近 30 天与团队长共用 IP 的下线账号数
  const [[dip]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY
       AND l2.user_id IN (SELECT DISTINCT from_user_id FROM bg_team_commission WHERE beneficiary_id = ? AND currency = ?)`,
    [userId, userId, withdrawal.currency],
  )

  const win568 = await buildWin568ReviewStats(pool, userId, sinceDate, reconcileGraceMinutes(config), usdToPhpRate)

  return {
    pool,
    withdrawal,
    since: sinceDate.toISOString(),
    depositCents: Number(dep?.window_cents ?? 0),
    lifetimeDepositCount: Number(dep?.lifetime_cnt ?? 0),
    approvedTeamWithdrawCount,
    uplineBlacklisted,
    relatedIpAccounts: Number(ip?.cnt ?? 0),
    relatedDeviceIdAccounts: Number(devId?.cnt ?? 0),
    relatedDeviceFpAccounts: Number(devFp?.cnt ?? 0),
    tamperOrphanRounds: Number(orphan?.cnt ?? 0),
    commissionEarnedCents: Number(comm?.earned ?? 0),
    commissionDownlineGgrCents: Number(comm?.downline_ggr ?? 0),
    commissionDupGroups: Number(dup?.cnt ?? 0),
    windowCommissionCents: Number(surge?.window_cents ?? 0),
    prior30dCommissionCents: Number(surge?.prior_cents ?? 0),
    freshCommissionCents: Number(fresh?.fresh_cents ?? 0),
    downlineDepositCents: Number(ddep?.cents ?? 0),
    downlineIpOverlap: Number(dip?.cnt ?? 0),
    win568,
  }
}

function snapshotOf(ctx: ReviewContext): Record<string, number | string | boolean> {
  return {
    since: ctx.since,
    amountCents: ctx.withdrawal.amountCents,
    currency: ctx.withdrawal.currency,
    depositCents: ctx.depositCents,
    lifetimeDepositCount: ctx.lifetimeDepositCount,
    approvedTeamWithdrawCount: ctx.approvedTeamWithdrawCount,
    uplineBlacklisted: ctx.uplineBlacklisted,
    relatedIpAccounts: ctx.relatedIpAccounts,
    relatedDeviceIdAccounts: ctx.relatedDeviceIdAccounts,
    relatedDeviceFpAccounts: ctx.relatedDeviceFpAccounts,
    tamperOrphanRounds: ctx.tamperOrphanRounds,
    commissionEarnedCents: ctx.commissionEarnedCents,
    commissionDownlineGgrCents: ctx.commissionDownlineGgrCents,
    commissionDupGroups: ctx.commissionDupGroups,
    windowCommissionCents: ctx.windowCommissionCents,
    prior30dCommissionCents: ctx.prior30dCommissionCents,
    freshCommissionCents: ctx.freshCommissionCents,
    downlineDepositCents: ctx.downlineDepositCents,
    downlineIpOverlap: ctx.downlineIpOverlap,
    win568SyncWatermark: ctx.win568.watermarkMs === null ? '' : new Date(ctx.win568.watermarkMs).toISOString(),
    win568CoverageStart: ctx.win568.coverageStartMs === null ? '' : new Date(ctx.win568.coverageStartMs).toISOString(),
    win568ReconcileChecked: ctx.win568.reconcileChecked,
    win568ReconcileMissing: ctx.win568.reconcileMissing,
    win568ReconcileStakeMismatch: ctx.win568.reconcileStakeMismatch,
    win568ReconcileVoidPaid: ctx.win568.reconcileVoidPaid,
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
    `SELECT id, user_id, currency, amount_cents, status FROM bg_team_withdrawal WHERE id = ? LIMIT 1`,
    [withdrawalId],
  )
  if (!row || row.status !== 'pending') return

  const withdrawal: TeamWithdrawal = {
    id: Number(row.id),
    userId: String(row.user_id),
    amountCents: Number(row.amount_cents),
    currency: row.currency === 'IDR' || row.currency === 'USDT' || row.currency === 'USDC' ? row.currency : 'PHP',
    status: row.status,
  }
  const t0 = Date.now()
  let verdict: ReviewVerdict = 'manual'
  let snapshot: Record<string, unknown> | null = null

  try {
    const config = await loadReviewConfig(pool, 'team')
    const ctx = await buildContext(pool, withdrawal, config, env.USDT_TO_PHP_RATE, env.IDR_TO_PHP_RATE)
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

  const notifyManual = () => {
    if (round !== 1) return
    notifyWithdrawManual(env, {
      scope: 'team',
      orderId: withdrawal.id,
      userId: withdrawal.userId,
      amount: withdrawal.amountCents / 100,
      currency: withdrawal.currency,
    }).catch(() => {})
  }

  if (verdict === 'pass') {
    try {
      await approveTeamWithdrawal(env, withdrawal.id)
    } catch {
      await pool.execute(
        `UPDATE bg_team_withdrawal SET review_verdict = 'manual' WHERE id = ? AND status = 'pending'`,
        [withdrawal.id],
      )
      broadcastBadges(env).catch(() => {})
      notifyManual()
    }
  } else {
    broadcastBadges(env).catch(() => {})
    notifyManual()
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
