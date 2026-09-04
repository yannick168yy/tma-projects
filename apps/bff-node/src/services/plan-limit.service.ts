import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getDefaultRedis, scanKeys } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'

const log = childLogger('plan-limit')

// 同其他平台级配置：无前缀客户端，否则平台控制台改完失效不掉
const CACHE_PREFIX = 'platform:plan-limits:'
const CACHE_TTL_SECONDS = 300

/**
 * 受套餐范围约束的业务参数（P1-14）。
 *
 * 这些参数租户化后天然 per-tenant，租户后台就能改 —— 但不能让试用站
 * 把返水调到 50% 或把提现下限设成 0。套餐给出允许区间，超出直接拒绝。
 *
 * **只收录真正会影响商务结算的参数**。把所有后台配置都纳管既做不完，
 * 也会让平台后台变成一张永远对不上的表。
 */
export const LIMIT_KEYS = {
  rebate_rate_pct: '洗码返水费率（%）',
  rebate_max_bonus: '洗码单档封顶',
  withdraw_min: '提现下限',
  withdraw_max: '提现上限',
  bonus_wager_mult: '彩金流水倍数',
} as const

export type LimitKey = keyof typeof LIMIT_KEYS

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === 'string' && value in LIMIT_KEYS
}

export interface LimitRange {
  min: number | null
  max: number | null
}

export type PlanLimits = Partial<Record<LimitKey, LimitRange>>

interface Row extends RowDataPacket {
  config_key: string
  min_value: string | number | null
  max_value: string | number | null
}

function num(raw: string | number | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function queryLimits(tenantId: number): Promise<PlanLimits> {
  const [rows] = await getPlatformPool().query<Row[]>(
    `SELECT po.config_key, po.min_value, po.max_value
       FROM pf_tenant_plan tp
       JOIN pf_plan_override po ON po.plan_id = tp.plan_id
      WHERE tp.tenant_id = ? AND tp.ended_at IS NULL`,
    [tenantId],
  )
  const out: PlanLimits = {}
  for (const row of rows) {
    if (!isLimitKey(row.config_key)) continue
    out[row.config_key] = { min: num(row.min_value), max: num(row.max_value) }
  }
  return out
}

export async function getPlanLimits(env: Env, tenantId: number): Promise<PlanLimits> {
  const redis = getDefaultRedis(env)
  const cacheKey = `${CACHE_PREFIX}${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try { return JSON.parse(cached) as PlanLimits } catch { /* 缓存脏了就回源 */ }
  }

  let limits: PlanLimits
  try {
    limits = await queryLimits(tenantId)
  } catch (err) {
    // 🔴 故障时按「不限制」处理，与功能开关的兜底方向一致。
    // 反过来（一律拒绝）会让一次平台库抖动把所有租户的后台配置页全部锁死。
    log.error({ err, tenantId }, '读取套餐可覆盖范围失败，本次不做范围校验')
    return {}
  }

  await redis.set(cacheKey, JSON.stringify(limits), 'EX', CACHE_TTL_SECONDS)
  return limits
}

export async function invalidatePlanLimitCache(env: Env, tenantId?: number): Promise<void> {
  const redis = getDefaultRedis(env)
  if (tenantId !== undefined) {
    await redis.del(`${CACHE_PREFIX}${tenantId}`)
    return
  }
  const keys = await scanKeys(redis, `${CACHE_PREFIX}*`)
  if (keys.length > 0) await redis.del(...keys)
}

/**
 * 校验一批取值是否落在套餐允许区间内。返回第一条错误信息，全部合法返回 null。
 *
 * 没有配置区间的 key 一律放行 —— 白名单语义：平台没表态就是不管。
 * 自营站同样走这条链路，它挂的是旗舰版，区间给足即可，不做特例分支：
 * 特例分支意味着自营站的校验路径和客户站不同，测不出来的问题就藏在那里。
 */
export async function checkPlanLimits(
  env: Env,
  values: Array<{ key: LimitKey; value: number; label?: string }>,
): Promise<string | null> {
  const tenant = currentTenantOrNull()
  if (!tenant) return null
  const limits = await getPlanLimits(env, tenant.id)

  for (const { key, value, label } of values) {
    const range = limits[key]
    if (!range) continue
    const where = label ? `${LIMIT_KEYS[key]}（${label}）` : LIMIT_KEYS[key]
    if (range.min !== null && value < range.min) {
      return `${where} 不得低于 ${range.min}，当前套餐允许区间 ${range.min}~${range.max ?? '不限'}`
    }
    if (range.max !== null && value > range.max) {
      return `${where} 不得高于 ${range.max}，当前套餐允许区间 ${range.min ?? '不限'}~${range.max}`
    }
  }
  return null
}

// ── 平台控制台读写 ──

export async function listPlanOverrides(planId: number): Promise<Array<{ configKey: string; min: number | null; max: number | null }>> {
  const [rows] = await getPlatformPool().query<Row[]>(
    'SELECT config_key, min_value, max_value FROM pf_plan_override WHERE plan_id = ? ORDER BY config_key',
    [planId],
  )
  return rows.filter((r) => isLimitKey(r.config_key)).map((r) => ({
    configKey: r.config_key,
    min: num(r.min_value),
    max: num(r.max_value),
  }))
}

export async function setPlanOverride(planId: number, key: LimitKey, min: number | null, max: number | null): Promise<void> {
  await getPlatformPool().query(
    `INSERT INTO pf_plan_override (plan_id, config_key, min_value, max_value) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE min_value = VALUES(min_value), max_value = VALUES(max_value)`,
    [planId, key, min, max],
  )
}

export async function deletePlanOverride(planId: number, key: LimitKey): Promise<void> {
  await getPlatformPool().query(
    'DELETE FROM pf_plan_override WHERE plan_id = ? AND config_key = ?', [planId, key])
}
