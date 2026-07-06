import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getWithdraw } from './store/index.js'
import { canWithdraw } from './turnover.service.js'
import { approveWithdraw } from './withdraw-approve.service.js'
import { broadcastBadges } from './sse-badges.js'

// ── 规则结果 / 上下文 ─────────────────────────────────────────────────────────

export type RuleVerdict = 'pass' | 'manual' | 'skipped' | 'error'
export type ReviewVerdict = 'pass' | 'manual'

export interface RuleResult {
  code: string
  verdict: RuleVerdict
  actualValue?: number
  threshold?: number
  detail?: Record<string, unknown>
}

export interface RuleConfig {
  enabled: boolean
  threshold: number | null
  params: Record<string, unknown> | null
}

interface ReviewContext {
  pool: Pool
  order: OrderWithdraw
  /** 统计窗口起点：上次成功取款时间，无则注册时间 */
  since: string
  // 资金面（窗口内，PHP 分）
  depositCents: number
  deposit24hCents: number
  lifetimeDepositCount: number
  profitCents: number
  profit24hCents: number
  bonusCents: number
  completedWithdrawCount: number
  // 关系/风控面
  uplineBlacklisted: boolean
  /** 未完成的优惠流水（required-completed，PHP 分） */
  promoTurnoverRemaining: number
  /** 近30天共用同 IP 的其他账号数 */
  relatedIpAccounts: number
  /** 共用同设备的其他账号数 */
  relatedDeviceAccounts: number
  /** 窗口内"有派彩无下注"的异常 round 数 */
  tamperOrphanRounds: number
  /** 作为收益人累计佣金（PHP 分） */
  commissionEarnedCents: number
  /** 名下下线累计 GGR（PHP 分，可为负） */
  commissionDownlineGgrCents: number
  /** 佣金重复入账组数 */
  commissionDupGroups: number
  /** 568Win 数据面统计（上游对账/彩金/取消） */
  win568: Win568ReviewStats
}

export const RULE_META: Record<string, { name: string; desc: string }> = {
  turnover:                  { name: '流水检查', desc: '复核「上次成功取款至今」窗口内的有效投注流水是否达到打码要求；未达标则转人工（与请求路径的流水闸门一致，此处兜底）。' },
  large_amount:             { name: '大额取款', desc: '本次取款金额超过设定阈值转人工；按币种分别设阈（phpCents=法币分，usdt=Matrix 链上 USDT）。' },
  large_profit:             { name: '大额盈利', desc: '统计窗口内的净盈利（总派彩−总投注）超过阈值（PHP 分）转人工。阈值≤0 表示不启用。' },
  high_multiple_profit:     { name: '高倍盈利', desc: '窗口内 净盈利 ÷ 累计存款 的倍数 ≥ 阈值倍数转人工；无存款时跳过。' },
  high_multiple_profit_24h: { name: '24小时高倍盈利', desc: '近 24 小时内 盈利 ÷ 存款 的倍数 ≥ 阈值倍数转人工，用于抓短时暴赚；近 24h 无存款时跳过。' },
  deposit_source:           { name: '存款来源', desc: '账号历史从未有过真实成功存款（即纯靠彩金/盈利出款）转人工。' },
  total_bonus:              { name: '总优惠金额', desc: '历史优惠领取表已废弃；当前无可用统计源。阈值≤0 表示不启用。' },
  first_withdraw_no_deposit:{ name: '首次取款', desc: '该账号此前无任何成功取款，且历史无真实存款，首次取款即转人工。' },
  upline_blacklist:         { name: '上线黑名单', desc: '该用户的邀请人（上线）处于封禁/冻结或风控黑名单中，则本次取款转人工。' },
  same_ip_device:           { name: '同IP同设备', desc: '与其它账号共用同一 IP 的数量 ≥ ip 阈值；设备会话表已废弃。' },
  promo_turnover:           { name: '优惠流水', desc: '存在已领取但尚未打完所需流水的优惠（剩余打码 > 0）则转人工。' },
  tampered_bet:             { name: '篡改注单', desc: '存在无对应投注却凭空派彩的 round，疑似数据被篡改，转人工。' },
  commission_anomaly:       { name: '三级分销佣金', desc: '三级分销佣金出现重复入账，或自身有佣金收益但下线累计 GGR ≤ 0（疑似刷佣），转人工。' },
  upstream_reconcile:       { name: '上游对账', desc: '窗口内本地已结算注单与 568Win 报表按 RefNo 双边核对：本地有上游无（伪造注单）、投注额不符（篡改）、上游已作废但本地已派彩（回滚遗漏）任一命中转人工。报表同步停摆时跳过不拦截。' },
  bonus_bet_abuse:          { name: '上游彩金异常', desc: '窗口内 568Win Bonus 入账总额超过阈值（PHP 分）或笔数超过 params.count，疑似薅上游活动，转人工。' },
  cancel_pattern:           { name: '取消注单异常', desc: '窗口内被作废（Void）的注单笔数 ≥ 阈值且占比 ≥ params.ratio，疑似利用取消机制套利，转人工。' },
  commission_surge:         { name: '佣金激增', desc: '（佣金提现专用）窗口内佣金入账超过之前 30 天佣金总和 × params.mult，且不低于 params.minCents 起查额，疑似速成刷佣，转人工。新代理首笔大额佣金也会命中，由人工过目。' },
  fresh_downline_commission:{ name: '新号佣金占比', desc: '（佣金提现专用）窗口内佣金中来自「注册 ≤ params.days 天下线」的占比 ≥ params.ratio 且总额 ≥ params.minCents，疑似批量注册小号刷佣，转人工。' },
  commission_deposit_ratio: { name: '佣金存款比', desc: '（佣金提现专用）累计佣金 > 下线累计真实存款 × params.ratio 且 ≥ params.minCents。佣金规模不可能长期超过下线净存入，命中即彩金刷佣或结算故障，转人工。' },
  downline_ip_overlap:      { name: '下线同IP', desc: '（佣金提现专用）近 30 天与团队长共用 IP 的下线账号数 ≥ 阈值，疑似自己给自己当下线，转人工。' },
}

// ── 568Win 数据面统计：user 与 team 审核共用 ─────────────────────────────────

export interface Win568ReviewStats {
  /** 报表同步水位（UTC ms），null=从未同步 */
  watermarkMs: number | null
  /** 报表覆盖起点（UTC ms），早于它结算的注单不在报表里，不参与对账 */
  coverageStartMs: number | null
  reconcileChecked: number
  reconcileMissing: number
  reconcileStakeMismatch: number
  reconcileVoidPaid: number
  bonusCount: number
  bonusAmountCents: number
  betTxnCount: number
  voidTxnCount: number
}

/** 水位超过此时限视为报表同步停摆，对账规则跳过不拦截 */
const RECONCILE_WATERMARK_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function reconcileGraceMinutes(config: Record<string, RuleConfig>): number {
  const n = Number(config.upstream_reconcile?.params?.graceMinutes ?? 30)
  return Number.isFinite(n) && n >= 0 ? n : 30
}

/**
 * 统计窗口内 568Win 无缝钱包交易面指标。
 * 对账只核对「结算时间早于 水位-graceMinutes」的注单，给上游报表管道留时间，避免同步滞后误报。
 */
export async function buildWin568ReviewStats(
  pool: Pool,
  userId: string,
  since: Date,
  graceMinutes: number,
): Promise<Win568ReviewStats> {
  const [wmRows] = await pool.query<RowDataPacket[]>(
    `SELECT \`key\`, \`value\` FROM bg_admin_settings
     WHERE \`key\` IN ('win568_report_sync_watermark', 'win568_report_sync_coverage_start')`,
  )
  const parseSetting = (key: string): number | null => {
    const row = wmRows.find((r) => String(r.key) === key)
    const ts = row?.value ? Date.parse(String(row.value)) : NaN
    return Number.isFinite(ts) ? ts : null
  }
  const watermarkMs = parseSetting('win568_report_sync_watermark')
  const coverageStartMs = parseSetting('win568_report_sync_coverage_start')

  const [[txn]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(txn_type = 'bet'), 0) AS bet_cnt,
       COALESCE(SUM(txn_type = 'bet' AND status = 'Void'), 0) AS void_cnt,
       COALESCE(SUM(txn_type = 'bonus' AND status <> 'Void'), 0) AS bonus_cnt,
       COALESCE(SUM(CASE WHEN txn_type = 'bonus' AND status <> 'Void' THEN ROUND(amount * 100) ELSE 0 END), 0) AS bonus_cents
     FROM bg_568win_wallet_txn WHERE user_id = ? AND created_at > ?`,
    [userId, since],
  )

  let checked = 0, missing = 0, stakeMismatch = 0, voidPaid = 0
  if (watermarkMs !== null && coverageStartMs !== null) {
    // 对账范围：[max(窗口起点, 报表覆盖起点), 水位-grace]，两头都收敛避免报表天然缺数据的误报
    const lower = new Date(Math.max(since.getTime(), coverageStartMs))
    const bound = new Date(watermarkMs - graceMinutes * 60_000)
    // PT9 同一 transfer_code 可有多笔 transaction，按 transfer_code 聚合后与报表 refNo 对齐
    const [[rec]] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS checked,
         COALESCE(SUM(has_report = 0), 0) AS missing,
         COALESCE(SUM(has_report = 1 AND report_stake IS NOT NULL AND ABS(report_stake - amount) > 0.01), 0) AS stake_mismatch,
         COALESCE(SUM(win_loss > 0 AND report_void = 1), 0) AS void_paid
       FROM (
         SELECT t.transfer_code,
                SUM(t.amount) AS amount,
                COALESCE(SUM(t.win_loss), 0) AS win_loss,
                EXISTS(SELECT 1 FROM bg_568win_report_bet r WHERE r.ref_no = t.transfer_code) AS has_report,
                (SELECT MAX(r.stake) FROM bg_568win_report_bet r WHERE r.ref_no = t.transfer_code) AS report_stake,
                EXISTS(SELECT 1 FROM bg_568win_report_bet r
                       WHERE r.ref_no = t.transfer_code AND LOWER(COALESCE(r.status, '')) LIKE '%void%') AS report_void
         FROM bg_568win_wallet_txn t
         WHERE t.user_id = ? AND t.txn_type = 'bet' AND t.status = 'settled'
           AND t.settled_at > ? AND t.settled_at < ?
         GROUP BY t.transfer_code
       ) x`,
      [userId, lower, bound],
    )
    checked = Number(rec?.checked ?? 0)
    missing = Number(rec?.missing ?? 0)
    stakeMismatch = Number(rec?.stake_mismatch ?? 0)
    voidPaid = Number(rec?.void_paid ?? 0)
  }

  return {
    watermarkMs,
    coverageStartMs,
    reconcileChecked: checked,
    reconcileMissing: missing,
    reconcileStakeMismatch: stakeMismatch,
    reconcileVoidPaid: voidPaid,
    bonusCount: Number(txn?.bonus_cnt ?? 0),
    bonusAmountCents: Number(txn?.bonus_cents ?? 0),
    betTxnCount: Number(txn?.bet_cnt ?? 0),
    voidTxnCount: Number(txn?.void_cnt ?? 0),
  }
}

export function evalUpstreamReconcile(stats: Win568ReviewStats): RuleResult {
  if (stats.watermarkMs === null || stats.coverageStartMs === null) {
    return { code: 'upstream_reconcile', verdict: 'skipped', detail: { reason: 'report sync not ready' } }
  }
  if (Date.now() - stats.watermarkMs > RECONCILE_WATERMARK_MAX_AGE_MS) {
    return {
      code: 'upstream_reconcile',
      verdict: 'skipped',
      detail: { reason: 'report sync stale', watermark: new Date(stats.watermarkMs).toISOString() },
    }
  }
  const diff = stats.reconcileMissing + stats.reconcileStakeMismatch + stats.reconcileVoidPaid
  return {
    code: 'upstream_reconcile',
    verdict: diff > 0 ? 'manual' : 'pass',
    actualValue: diff,
    detail: {
      checked: stats.reconcileChecked,
      missing: stats.reconcileMissing,
      stakeMismatch: stats.reconcileStakeMismatch,
      voidPaid: stats.reconcileVoidPaid,
    },
  }
}

// ── 规则集：默认 pass，仅命中异常才 manual ─────────────────────────────────────

type Rule = (ctx: ReviewContext, cfg: RuleConfig) => Promise<RuleResult> | RuleResult

const RULES: Record<string, Rule> = {
  async turnover(ctx) {
    const ok = await canWithdraw(ctx.pool, ctx.order.userId, ctx.order.currency)
    return { code: 'turnover', verdict: ok ? 'pass' : 'manual' }
  },

  large_amount(ctx, cfg) {
    const params = cfg.params ?? {}
    const isMatrix = ctx.order.channelId === 'matrix'
    const threshold = Number(isMatrix ? params.usdt : params.phpCents)
    if (!Number.isFinite(threshold) || threshold <= 0) return { code: 'large_amount', verdict: 'pass' }
    const hit = ctx.order.amount > threshold
    return { code: 'large_amount', verdict: hit ? 'manual' : 'pass', actualValue: ctx.order.amount, threshold }
  },

  large_profit(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 0)
    if (threshold <= 0) return { code: 'large_profit', verdict: 'pass' }
    const hit = ctx.profitCents > threshold
    return { code: 'large_profit', verdict: hit ? 'manual' : 'pass', actualValue: ctx.profitCents, threshold }
  },

  high_multiple_profit(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    if (mult <= 0 || ctx.depositCents <= 0) return { code: 'high_multiple_profit', verdict: 'pass', detail: { depositCents: ctx.depositCents } }
    const ratio = ctx.profitCents / ctx.depositCents
    return { code: 'high_multiple_profit', verdict: ratio >= mult ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
  },

  high_multiple_profit_24h(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    if (mult <= 0 || ctx.deposit24hCents <= 0) return { code: 'high_multiple_profit_24h', verdict: 'pass', detail: { deposit24hCents: ctx.deposit24hCents } }
    const ratio = ctx.profit24hCents / ctx.deposit24hCents
    return { code: 'high_multiple_profit_24h', verdict: ratio >= mult ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
  },

  deposit_source(ctx) {
    const hit = ctx.lifetimeDepositCount === 0
    return { code: 'deposit_source', verdict: hit ? 'manual' : 'pass', detail: { lifetimeDepositCount: ctx.lifetimeDepositCount } }
  },

  total_bonus(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 0)
    if (threshold <= 0) return { code: 'total_bonus', verdict: 'pass' }
    const hit = ctx.bonusCents > threshold
    return { code: 'total_bonus', verdict: hit ? 'manual' : 'pass', actualValue: ctx.bonusCents, threshold }
  },

  first_withdraw_no_deposit(ctx) {
    const hit = ctx.completedWithdrawCount === 0 && ctx.lifetimeDepositCount === 0
    return { code: 'first_withdraw_no_deposit', verdict: hit ? 'manual' : 'pass' }
  },

  upline_blacklist(ctx) {
    return { code: 'upline_blacklist', verdict: ctx.uplineBlacklisted ? 'manual' : 'pass' }
  },

  same_ip_device(ctx, cfg) {
    const params = cfg.params ?? {}
    const ipTh = Number(params.ip ?? 3)
    const hit = ctx.relatedIpAccounts >= ipTh
    return {
      code: 'same_ip_device',
      verdict: hit ? 'manual' : 'pass',
      actualValue: Math.max(ctx.relatedIpAccounts, ctx.relatedDeviceAccounts),
      threshold: ipTh,
      detail: { relatedIpAccounts: ctx.relatedIpAccounts, relatedDeviceAccounts: ctx.relatedDeviceAccounts },
    }
  },

  promo_turnover(ctx) {
    const hit = ctx.promoTurnoverRemaining > 0
    return { code: 'promo_turnover', verdict: hit ? 'manual' : 'pass', actualValue: ctx.promoTurnoverRemaining }
  },

  tampered_bet(ctx) {
    const hit = ctx.tamperOrphanRounds > 0
    return {
      code: 'tampered_bet',
      verdict: hit ? 'manual' : 'pass',
      detail: { orphanRounds: ctx.tamperOrphanRounds },
    }
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

  upstream_reconcile(ctx) {
    return evalUpstreamReconcile(ctx.win568)
  },

  bonus_bet_abuse(ctx, cfg) {
    const threshold = Number(cfg.threshold ?? 0)
    const countTh = Number(cfg.params?.count ?? 0)
    const amtHit = threshold > 0 && ctx.win568.bonusAmountCents > threshold
    const cntHit = countTh > 0 && ctx.win568.bonusCount >= countTh
    return {
      code: 'bonus_bet_abuse',
      verdict: amtHit || cntHit ? 'manual' : 'pass',
      actualValue: ctx.win568.bonusAmountCents,
      threshold: threshold > 0 ? threshold : undefined,
      detail: { bonusCount: ctx.win568.bonusCount, countThreshold: countTh },
    }
  },

  cancel_pattern(ctx, cfg) {
    const minCount = Number(cfg.threshold ?? 0)
    const ratioTh = Number(cfg.params?.ratio ?? 0.3)
    const total = ctx.win568.betTxnCount
    const voided = ctx.win568.voidTxnCount
    const ratio = total > 0 ? voided / total : 0
    const hit = minCount > 0 && voided >= minCount && ratio >= ratioTh
    return {
      code: 'cancel_pattern',
      verdict: hit ? 'manual' : 'pass',
      actualValue: voided,
      threshold: minCount > 0 ? minCount : undefined,
      detail: { totalBets: total, voidRatio: round2(ratio), ratioThreshold: ratioTh },
    }
  },
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ── 配置加载 ──────────────────────────────────────────────────────────────────

export type ReviewScope = 'user' | 'team'

export async function loadReviewConfig(pool: Pool, scope: ReviewScope = 'user'): Promise<Record<string, RuleConfig>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, enabled, threshold, params FROM bg_withdraw_review_config WHERE scope = ?`,
    [scope],
  )
  const out: Record<string, RuleConfig> = {}
  for (const r of rows) {
    out[String(r.rule_code)] = {
      enabled: Boolean(r.enabled),
      threshold: r.threshold == null ? null : Number(r.threshold),
      params: r.params == null ? null : (typeof r.params === 'string' ? JSON.parse(r.params) : r.params),
    }
  }
  return out
}

// ── 上下文构建 ────────────────────────────────────────────────────────────────

async function buildContext(pool: Pool, order: OrderWithdraw, config: Record<string, RuleConfig>): Promise<ReviewContext> {
  const userId = order.userId

  const [[user]] = await pool.query<RowDataPacket[]>(
    `SELECT u.registered_at, inv.status AS inviter_status
     FROM bg_user u LEFT JOIN bg_user inv ON inv.id = u.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )
  const registeredAt = user?.registered_at ? new Date(user.registered_at as Date) : new Date(0)
  const uplineBlacklisted = user?.inviter_status === 'banned' || user?.inviter_status === 'frozen'

  const [[wd]] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(created_at) AS last_at, COUNT(*) AS cnt
     FROM bg_withdraw_order WHERE user_id = ? AND status = 'completed'`,
    [userId],
  )
  const completedWithdrawCount = Number(wd?.cnt ?? 0)
  const sinceDate = wd?.last_at ? new Date(wd.last_at as Date) : registeredAt
  const since = sinceDate.toISOString()

  const [[dep]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? THEN ROUND(amount * 100) END), 0) AS window_cents,
       COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR THEN ROUND(amount * 100) END), 0) AS d24_cents,
       COUNT(*) AS lifetime_cnt
     FROM bg_deposit_order WHERE user_id = ? AND status = 'paid'`,
    [sinceDate, userId],
  )

  const [[bet]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? AND bet_type IN ('win','refund') THEN amount
                         WHEN created_at > ? AND bet_type = 'bet' THEN -amount ELSE 0 END), 0) AS window_profit,
       COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR AND bet_type IN ('win','refund') THEN amount
                         WHEN created_at > NOW() - INTERVAL 24 HOUR AND bet_type = 'bet' THEN -amount ELSE 0 END), 0) AS d24_profit
     FROM bg_bet_order WHERE user_id = ? AND status = 'settled'`,
    [sinceDate, sinceDate, userId],
  )

  // 优惠流水未完成（promotion 类型），只检查与本次取款同币种的要求，跨币种不拦截
  const [[pt]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(required_amount - completed_amount), 0) AS remaining
     FROM bg_turnover_requirements
     WHERE user_id = ? AND currency = ? AND source_type = 'promotion' AND status = 'pending'`,
    [userId, order.currency],
  )

  // 同 IP（近30天）的其他账号数；设备会话表已废弃。
  const [[ip]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT l2.user_id) AS cnt
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY`,
    [userId],
  )

  // 篡改注单：凭空派彩 round
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
  // 三级分销佣金
  const [[comm]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(commission_cents), 0) AS earned,
       COALESCE(SUM(ggr_cents), 0)        AS downline_ggr
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

  const win568 = await buildWin568ReviewStats(pool, userId, sinceDate, reconcileGraceMinutes(config))

  return {
    pool, order, since,
    depositCents: Number(dep?.window_cents ?? 0),
    deposit24hCents: Number(dep?.d24_cents ?? 0),
    lifetimeDepositCount: Number(dep?.lifetime_cnt ?? 0),
    profitCents: Number(bet?.window_profit ?? 0),
    profit24hCents: Number(bet?.d24_profit ?? 0),
    bonusCents: 0,
    completedWithdrawCount,
    uplineBlacklisted,
    promoTurnoverRemaining: Number(pt?.remaining ?? 0),
    relatedIpAccounts: Number(ip?.cnt ?? 0),
    relatedDeviceAccounts: 0,
    tamperOrphanRounds: Number(orphan?.cnt ?? 0),
    commissionEarnedCents: Number(comm?.earned ?? 0),
    commissionDownlineGgrCents: Number(comm?.downline_ggr ?? 0),
    commissionDupGroups: Number(dup?.cnt ?? 0),
    win568,
  }
}

function snapshotOf(ctx: ReviewContext): Record<string, number | string | boolean> {
  return {
    since: ctx.since,
    depositCents: ctx.depositCents,
    deposit24hCents: ctx.deposit24hCents,
    lifetimeDepositCount: ctx.lifetimeDepositCount,
    profitCents: ctx.profitCents,
    profit24hCents: ctx.profit24hCents,
    bonusCents: ctx.bonusCents,
    completedWithdrawCount: ctx.completedWithdrawCount,
    uplineBlacklisted: ctx.uplineBlacklisted,
    promoTurnoverRemaining: ctx.promoTurnoverRemaining,
    relatedIpAccounts: ctx.relatedIpAccounts,
    relatedDeviceAccounts: ctx.relatedDeviceAccounts,
    tamperOrphanRounds: ctx.tamperOrphanRounds,
    commissionEarnedCents: ctx.commissionEarnedCents,
    commissionDownlineGgrCents: ctx.commissionDownlineGgrCents,
    commissionDupGroups: ctx.commissionDupGroups,
    win568SyncWatermark: ctx.win568.watermarkMs === null ? '' : new Date(ctx.win568.watermarkMs).toISOString(),
    win568CoverageStart: ctx.win568.coverageStartMs === null ? '' : new Date(ctx.win568.coverageStartMs).toISOString(),
    win568ReconcileChecked: ctx.win568.reconcileChecked,
    win568ReconcileMissing: ctx.win568.reconcileMissing,
    win568ReconcileStakeMismatch: ctx.win568.reconcileStakeMismatch,
    win568ReconcileVoidPaid: ctx.win568.reconcileVoidPaid,
    win568BonusCount: ctx.win568.bonusCount,
    win568BonusAmountCents: ctx.win568.bonusAmountCents,
    win568BetTxnCount: ctx.win568.betTxnCount,
    win568VoidTxnCount: ctx.win568.voidTxnCount,
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

/**
 * 对一笔 pending 提案跑自动审核。全部通过则自动批准出款，否则置 manual 留人工。
 * 整体异常一律转人工，绝不静默放行。
 * @param round 审核轮次，重跑时由调用方递增
 */
export async function reviewWithdraw(env: Env, redis: Redis, orderId: string, round = 1): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)

  const order = await getWithdraw(redis, orderId)
  if (!order || order.status !== 'pending') return

  const t0 = Date.now()
  let verdict: ReviewVerdict = 'manual'
  let snapshot: Record<string, unknown> | null = null

  try {
    const config = await loadReviewConfig(pool)
    const ctx = await buildContext(pool, order, config)
    snapshot = snapshotOf(ctx)

    const results: RuleResult[] = []
    for (const [code, rule] of Object.entries(RULES)) {
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
        `INSERT INTO bg_withdraw_review_log (order_id, user_id, rule_code, round, verdict, actual_value, threshold, detail)
         VALUES (?,?,?,?,?,?,?,?)`,
        [order.orderId, order.userId, r.code, round, r.verdict,
         r.actualValue ?? null, r.threshold ?? null, r.detail ? JSON.stringify(r.detail) : null],
      )
    }

    // manual 或 error 均不放行
    verdict = results.some((r) => r.verdict === 'manual' || r.verdict === 'error') ? 'manual' : 'pass'
  } catch (err) {
    // 引擎级异常：保守转人工，记一条审核日志
    await pool.execute(
      `INSERT INTO bg_withdraw_review_log (order_id, user_id, rule_code, round, verdict, detail)
       VALUES (?,?,?,?,?,?)`,
      [order.orderId, order.userId, '_engine', round, 'error',
       JSON.stringify({ error: err instanceof Error ? err.message : String(err) })],
    ).catch(() => {})
    verdict = 'manual'
  }

  await pool.execute(
    `UPDATE bg_withdraw_order
       SET review_verdict = ?, reviewed_at = NOW(3), review_round = ?, review_ms = ?, review_snapshot = ?
     WHERE order_id = ?`,
    [verdict, round, Date.now() - t0, snapshot ? JSON.stringify(snapshot) : null, order.orderId],
  )

  if (verdict === 'pass') {
    try { await approveWithdraw(env, redis, order) }
    catch { /* 出款失败内部已退款并置 failed，留人工跟进 */ }
  } else {
    broadcastBadges(env).catch(() => {})
  }
}

/** 人工触发重跑审核：轮次递增，生成新一轮记录而非覆盖 */
export async function rerunReview(env: Env, redis: Redis, orderId: string): Promise<{ round: number }> {
  if (!isMysqlEnabled(env)) return { round: 0 }
  const pool = getMysqlPool(env)
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round), 0) AS r FROM bg_withdraw_review_log WHERE order_id = ?`,
    [orderId],
  )
  const nextRound = Number(row?.r ?? 0) + 1
  await reviewWithdraw(env, redis, orderId, nextRound)
  return { round: nextRound }
}

// ── 后台查询 ──────────────────────────────────────────────────────────────────

/** 单笔最新一轮的逐规则结果 */
export async function getReviewLog(env: Env, orderId: string) {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [[r]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round), 1) AS r FROM bg_withdraw_review_log WHERE order_id = ?`, [orderId],
  )
  const round = Number(r?.r ?? 1)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, verdict, actual_value, threshold, detail, created_at
     FROM bg_withdraw_review_log WHERE order_id = ? AND round = ? ORDER BY id ASC`,
    [orderId, round],
  )
  return rows.map((x) => ({
    ruleCode: String(x.rule_code),
    ruleName: RULE_META[String(x.rule_code)]?.name ?? String(x.rule_code),
    verdict: String(x.verdict),
    actualValue: x.actual_value == null ? null : Number(x.actual_value),
    threshold: x.threshold == null ? null : Number(x.threshold),
    detail: x.detail ?? null,
    createdAt: new Date(x.created_at as Date).toISOString(),
  }))
}

/** 与某用户共用同 IP 的关联账号（人工核查辅助，实时查询） */
export async function getRelatedAccounts(env: Env, userId: string) {
  if (!isMysqlEnabled(env)) return { ip: [], device: [] }
  const pool = getMysqlPool(env)
  const [ipRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT l2.user_id, l1.ip
     FROM bg_login_log l1
     JOIN bg_login_log l2 ON l2.ip = l1.ip AND l2.user_id <> l1.user_id
     WHERE l1.user_id = ? AND l1.ip IS NOT NULL AND l1.created_at > NOW() - INTERVAL 30 DAY
     LIMIT 50`,
    [userId],
  )
  return {
    ip: ipRows.map((r) => ({ userId: String(r.user_id), ip: String(r.ip) })),
    device: [],
  }
}
