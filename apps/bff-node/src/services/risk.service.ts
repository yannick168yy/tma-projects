import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { notifyRiskHit } from './admin-notify.js'

// 风控管控层：识别「人」的风险并在关键时刻自动干预。
// 与 withdraw-review（审核）的分工：审核判定单笔订单是否需要人工复核，风控判定这个人能不能做这件事。
// 风控要转人工时用 action='escalate' 把人推给审核模块，自己不做复核。

export type RiskCheckpoint = 'login' | 'promo_claim' | 'withdraw'
export type RiskAction = 'tag_only' | 'limit' | 'deny' | 'escalate'

/** pass = 未命中任何启用的规则 */
export interface RiskDecision {
  action: RiskAction | 'pass'
  ruleCode?: string
  message?: string
}

export interface RiskContext {
  checkpoint: RiskCheckpoint
  userId?: string
  ip?: string
  deviceId?: string
  /** FingerprintJS 硬件指纹：清缓存 deviceId 会重置，指纹不变，设备名单按两者任一匹配 */
  fpVisitor?: string
  region?: string
}

interface PolicyRow extends RowDataPacket {
  rule_code: string
  action: RiskAction
  params: unknown
}

interface SignalRow extends RowDataPacket {
  bonus_ratio: string | number
  withdraw_count: number
  device_shared_users: number
}

const BLACKLIST_RULES: Record<string, 'user' | 'ip' | 'device' | 'region'> = {
  blacklist_user: 'user',
  blacklist_ip: 'ip',
  blacklist_device: 'device',
  blacklist_region: 'region',
}

/** deny 优先于 escalate 优先于 limit；tag_only 永不阻断，只落日志 */
const ACTION_SEVERITY: Record<RiskAction, number> = { tag_only: 0, limit: 1, escalate: 2, deny: 3 }

function parseParams(raw: unknown): Record<string, number> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, number>
  try {
    return JSON.parse(String(raw)) as Record<string, number>
  } catch {
    return {}
  }
}

async function loadPolicies(pool: Pool, checkpoint: RiskCheckpoint): Promise<PolicyRow[]> {
  const [rows] = await pool.query<PolicyRow[]>(
    'SELECT rule_code, action, params FROM bg_risk_policy WHERE checkpoint = ? AND enabled = 1',
    [checkpoint],
  )
  return rows
}

/** 一次查完本次上下文涉及的所有名单值，避免每条规则各打一次库 */
async function matchBlacklist(pool: Pool, ctx: RiskContext): Promise<Map<string, string>> {
  const pairs: Array<[string, string]> = []
  if (ctx.userId) pairs.push(['user', ctx.userId])
  if (ctx.ip) pairs.push(['ip', ctx.ip])
  if (ctx.deviceId) pairs.push(['device', ctx.deviceId])
  if (ctx.fpVisitor && ctx.fpVisitor !== ctx.deviceId) pairs.push(['device', ctx.fpVisitor])
  if (ctx.region) pairs.push(['region', ctx.region])
  if (pairs.length === 0) return new Map()

  const where = pairs.map(() => '(type = ? AND value = ?)').join(' OR ')
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT type, value FROM bg_risk_blacklist WHERE ${where}`,
    pairs.flat(),
  )
  return new Map(rows.map((r) => [String(r.type), String(r.value)]))
}

async function loadSignal(pool: Pool, userId: string): Promise<SignalRow | null> {
  const [rows] = await pool.query<SignalRow[]>(
    'SELECT bonus_ratio, withdraw_count, device_shared_users FROM bg_user_risk_signal WHERE user_id = ?',
    [userId],
  )
  return rows[0] ?? null
}

function evalBehaviourRule(ruleCode: string, params: Record<string, number>, signal: SignalRow): boolean {
  if (ruleCode === 'bonus_abuse') {
    return (
      Number(signal.bonus_ratio) >= (params.minRatio ?? 1.5) &&
      signal.withdraw_count >= (params.minWithdrawCount ?? 1)
    )
  }
  if (ruleCode === 'multi_account') {
    return signal.device_shared_users >= (params.minSharedUsers ?? 3)
  }
  return false
}

async function logHit(
  pool: Pool,
  ctx: RiskContext,
  ruleCode: string,
  action: RiskAction,
  matchedValue: string | null,
  detail: unknown,
): Promise<void> {
  await pool.execute(
    `INSERT INTO bg_risk_hit_log (user_id, checkpoint, rule_code, action, matched_value, detail, ip, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx.userId ?? null,
      ctx.checkpoint,
      ruleCode,
      action,
      matchedValue,
      detail ? JSON.stringify(detail) : null,
      ctx.ip ?? null,
      ctx.deviceId ?? null,
    ],
  )
}

export async function evaluateCheckpoint(env: Env, ctx: RiskContext): Promise<RiskDecision> {
  if (!isMysqlEnabled(env)) return { action: 'pass' }
  // getMysqlPool 自身可能抛（池未初始化），必须一并兜住：
  // 风控不可用时应放行，绝不能让它把登录/领取主链路一起拖垮
  let pool: Pool
  try {
    pool = getMysqlPool(env)
  } catch {
    return { action: 'pass' }
  }
  const decision = await evaluateWithPool(pool, ctx)
  // 仅高危动作(拦截/升级)告警;tag_only/limit 噪音大不推
  if ((decision.action === 'deny' || decision.action === 'escalate') && decision.ruleCode) {
    notifyRiskHit(env, {
      userId: ctx.userId,
      checkpoint: ctx.checkpoint,
      ruleCode: decision.ruleCode,
      action: decision.action,
      ip: ctx.ip,
    }).catch(() => {})
  }
  return decision
}

/**
 * 评估一个管控点。命中即落日志（tag_only 也落，否则影子模式期无法评估误报率），
 * 返回严重度最高的动作。风控本身永不抛错——任何异常都放行，风控不该阻断主链路。
 *
 * 首充彩金走支付 webhook，没有 Koa ctx 也没有 env，只能拿到 pool，故单独暴露此入口。
 */
export async function evaluateWithPool(pool: Pool, ctx: RiskContext): Promise<RiskDecision> {
  try {
    const policies = await loadPolicies(pool, ctx.checkpoint)
    if (policies.length === 0) return { action: 'pass' }

    const needsBlacklist = policies.some((p) => p.rule_code in BLACKLIST_RULES)
    const needsSignal = policies.some((p) => !(p.rule_code in BLACKLIST_RULES))
    const blacklist = needsBlacklist ? await matchBlacklist(pool, ctx) : new Map<string, string>()
    const signal = needsSignal && ctx.userId ? await loadSignal(pool, ctx.userId) : null

    let best: RiskDecision = { action: 'pass' }
    let bestSeverity = -1
    for (const policy of policies) {
      const blacklistType = BLACKLIST_RULES[policy.rule_code]
      let matchedValue: string | null = null
      let detail: unknown = null

      if (blacklistType) {
        const hit = blacklist.get(blacklistType)
        if (!hit) continue
        matchedValue = hit
      } else {
        if (!signal) continue
        const params = parseParams(policy.params)
        if (!evalBehaviourRule(policy.rule_code, params, signal)) continue
        detail = { params, bonusRatio: Number(signal.bonus_ratio), deviceSharedUsers: signal.device_shared_users }
      }

      await logHit(pool, ctx, policy.rule_code, policy.action, matchedValue, detail)
      if (policy.action === 'tag_only') continue
      if (ACTION_SEVERITY[policy.action] > bestSeverity) {
        bestSeverity = ACTION_SEVERITY[policy.action]
        best = { action: policy.action, ruleCode: policy.rule_code }
      }
    }
    return best
  } catch {
    return { action: 'pass' }
  }
}
