import type { Redis } from 'ioredis'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getWithdraw } from './store/index.js'
import { canWithdraw } from './turnover.service.js'
import { approveWithdraw } from './withdraw-approve.service.js'

// ── 规则结果 / 上下文 ─────────────────────────────────────────────────────────

export type RuleVerdict = 'pass' | 'manual'

export interface RuleResult {
  code: string
  verdict: RuleVerdict
  actualValue?: number
  threshold?: number
  detail?: Record<string, unknown>
}

interface RuleConfig {
  enabled: boolean
  threshold: number | null
  params: Record<string, unknown> | null
}

interface ReviewContext {
  pool: Pool
  order: OrderWithdraw
  /** 统计窗口起点：上次成功取款时间，无则用注册时间 */
  since: string
  /** 窗口内真实存款（PHP 分），仅 status=paid */
  depositCents: number
  /** 账号生涯真实存款笔数 */
  lifetimeDepositCount: number
  /** 窗口内净盈利（PHP 分）= 派彩+退款 - 投注 */
  profitCents: number
  /** 近 24h 净盈利（PHP 分） */
  profit24hCents: number
  /** 近 24h 真实存款（PHP 分） */
  deposit24hCents: number
  /** 窗口内领取的优惠总额（PHP 分） */
  bonusCents: number
  /** 已完成取款笔数 */
  completedWithdrawCount: number
  /** 上线（邀请人）是否被封/冻结 */
  uplineBlacklisted: boolean
}

// 规则中文名/说明，供后台展示（阈值在配置表，元信息在代码）
export const RULE_META: Record<string, { name: string; desc: string }> = {
  turnover:                  { name: '流水检查', desc: '窗口内流水未达标转人工（前置闸门兜底）' },
  large_amount:             { name: '大额取款', desc: '单笔金额超阈值转人工（分币种）' },
  large_profit:             { name: '大额盈利', desc: '窗口内净盈利超阈值转人工' },
  high_multiple_profit:     { name: '高倍盈利', desc: '净盈利/存款 超倍数转人工' },
  high_multiple_profit_24h: { name: '24小时高倍盈利', desc: '近24h 盈利/存款 超倍数转人工' },
  deposit_source:           { name: '存款来源', desc: '账号从无真实存款（纯彩金/盈利出款）转人工' },
  total_bonus:              { name: '总优惠金额', desc: '窗口内领取优惠总额超阈值转人工' },
  first_withdraw_no_deposit:{ name: '首次取款', desc: '首次取款且无真实存款转人工' },
  upline_blacklist:         { name: '上线黑名单', desc: '邀请人被封/冻结转人工' },
}

// ── 规则集：默认 pass，仅命中异常特征才 manual ───────────────────────────────

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
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return { code: 'large_amount', verdict: 'pass' }
    }
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
    if (mult <= 0 || ctx.depositCents <= 0) {
      return { code: 'high_multiple_profit', verdict: 'pass', detail: { depositCents: ctx.depositCents } }
    }
    const ratio = ctx.profitCents / ctx.depositCents
    const hit = ratio >= mult
    return { code: 'high_multiple_profit', verdict: hit ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
  },

  high_multiple_profit_24h(ctx, cfg) {
    const mult = Number(cfg.threshold ?? 0)
    if (mult <= 0 || ctx.deposit24hCents <= 0) {
      return { code: 'high_multiple_profit_24h', verdict: 'pass', detail: { deposit24hCents: ctx.deposit24hCents } }
    }
    const ratio = ctx.profit24hCents / ctx.deposit24hCents
    const hit = ratio >= mult
    return { code: 'high_multiple_profit_24h', verdict: hit ? 'manual' : 'pass', actualValue: round2(ratio), threshold: mult }
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
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── 配置加载 ──────────────────────────────────────────────────────────────────

export async function loadReviewConfig(pool: Pool): Promise<Record<string, RuleConfig>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, enabled, threshold, params FROM bg_withdraw_review_config`,
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

// ── 上下文构建（一次取齐聚合数据，规则只读不再查库）───────────────────────────

async function buildContext(pool: Pool, order: OrderWithdraw): Promise<ReviewContext> {
  const userId = order.userId

  // 用户注册时间 + 上线黑名单
  const [[user]] = await pool.query<RowDataPacket[]>(
    `SELECT u.registered_at, inv.status AS inviter_status
     FROM bg_user u
     LEFT JOIN bg_user inv ON inv.id = u.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )
  // mysql2 返回 DATETIME 为 Date 对象，直接作为参数传回比 ISO 字符串更可靠
  const registeredAt = user?.registered_at ? new Date(user.registered_at as Date) : new Date(0)
  const uplineBlacklisted = user?.inviter_status === 'banned' || user?.inviter_status === 'frozen'

  // 上次成功取款时间 + 已完成取款笔数
  const [[wd]] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(created_at) AS last_at, COUNT(*) AS cnt
     FROM bg_withdraw_order
     WHERE user_id = ? AND status = 'completed'`,
    [userId],
  )
  const completedWithdrawCount = Number(wd?.cnt ?? 0)
  const sinceDate = wd?.last_at ? new Date(wd.last_at as Date) : registeredAt
  const since = sinceDate.toISOString()

  // 真实存款：窗口内、近24h、生涯笔数
  const [[dep]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN COALESCE(paid_at, created_at) > ? THEN credited_cents END), 0) AS window_cents,
       COALESCE(SUM(CASE WHEN COALESCE(paid_at, created_at) > NOW() - INTERVAL 24 HOUR THEN credited_cents END), 0) AS d24_cents,
       COUNT(*) AS lifetime_cnt
     FROM bg_deposit_order
     WHERE user_id = ? AND status = 'paid'`,
    [sinceDate, userId],
  )

  // 注单盈利：窗口内、近24h（amount 与钱包同单位=PHP分）
  const [[bet]] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > ? AND bet_type IN ('win','refund') THEN amount
                         WHEN created_at > ? AND bet_type = 'bet' THEN -amount ELSE 0 END), 0) AS window_profit,
       COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR AND bet_type IN ('win','refund') THEN amount
                         WHEN created_at > NOW() - INTERVAL 24 HOUR AND bet_type = 'bet' THEN -amount ELSE 0 END), 0) AS d24_profit
     FROM bg_bet_order
     WHERE user_id = ? AND status = 'settled'`,
    [sinceDate, sinceDate, userId],
  )

  // 窗口内优惠总额
  const [[promo]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS bonus_cents
     FROM bg_promo_claim
     WHERE user_id = ? AND claimed_at > ?`,
    [userId, sinceDate],
  )

  return {
    pool,
    order,
    since,
    depositCents: Number(dep?.window_cents ?? 0),
    deposit24hCents: Number(dep?.d24_cents ?? 0),
    lifetimeDepositCount: Number(dep?.lifetime_cnt ?? 0),
    profitCents: Number(bet?.window_profit ?? 0),
    profit24hCents: Number(bet?.d24_profit ?? 0),
    bonusCents: Number(promo?.bonus_cents ?? 0),
    completedWithdrawCount,
    uplineBlacklisted,
  }
}

// ── 主流程：审核一笔提案 ──────────────────────────────────────────────────────

/**
 * 对一笔 pending 提案跑自动审核。全部通过则自动批准出款，否则置 manual 留人工。
 * 在请求路径里以 await 调用即可（响应仍为 pending），出款失败不影响提交。
 */
export async function reviewWithdraw(env: Env, redis: Redis, orderId: string): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const pool = getMysqlPool(env)

  // 用最新状态，避免与人工操作竞态
  const order = await getWithdraw(redis, orderId)
  if (!order || order.status !== 'pending') return

  const config = await loadReviewConfig(pool)
  const ctx = await buildContext(pool, order)

  const results: RuleResult[] = []
  for (const [code, rule] of Object.entries(RULES)) {
    const cfg = config[code]
    if (!cfg || !cfg.enabled) continue
    try {
      results.push(await rule(ctx, cfg))
    } catch (err) {
      // 单条规则异常不应放行：保守转人工
      results.push({ code, verdict: 'manual', detail: { error: err instanceof Error ? err.message : String(err) } })
    }
  }

  // 落逐规则结果
  for (const r of results) {
    await pool.execute(
      `INSERT INTO bg_withdraw_review_log (order_id, user_id, rule_code, verdict, actual_value, threshold, detail)
       VALUES (?,?,?,?,?,?,?)`,
      [
        order.orderId, order.userId, r.code, r.verdict,
        r.actualValue ?? null, r.threshold ?? null,
        r.detail ? JSON.stringify(r.detail) : null,
      ],
    )
  }

  const verdict: RuleVerdict = results.some((r) => r.verdict === 'manual') ? 'manual' : 'pass'
  await pool.execute(
    `UPDATE bg_withdraw_order SET review_verdict = ?, reviewed_at = NOW(3) WHERE order_id = ?`,
    [verdict, order.orderId],
  )

  if (verdict === 'pass') {
    try {
      await approveWithdraw(env, redis, order)
    } catch {
      // 出款失败（如 matrix API）：executeMatrixWithdrawOrder 内部已退款并置 failed，留人工跟进
    }
  }
}

// ── 后台查询：单笔逐规则明细 ──────────────────────────────────────────────────

export async function getReviewLog(env: Env, orderId: string) {
  if (!isMysqlEnabled(env)) return []
  const pool = getMysqlPool(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, verdict, actual_value, threshold, detail, created_at
     FROM bg_withdraw_review_log WHERE order_id = ? ORDER BY id ASC`,
    [orderId],
  )
  return rows.map((r) => ({
    ruleCode: String(r.rule_code),
    ruleName: RULE_META[String(r.rule_code)]?.name ?? String(r.rule_code),
    verdict: String(r.verdict),
    actualValue: r.actual_value == null ? null : Number(r.actual_value),
    threshold: r.threshold == null ? null : Number(r.threshold),
    detail: r.detail ?? null,
    createdAt: new Date(r.created_at as Date).toISOString(),
  }))
}
