import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getDefaultRedis, scanKeys } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('tenant-feature')

// 缓存固定走无前缀客户端：这是平台级数据，由平台控制台改、也由平台控制台失效。
// 走 ctx.state.redis（带租户前缀）会写成 `t9:platform:tenant-features:9`，
// 而平台控制台删的是 `platform:tenant-features:9` —— 失效静默失败，开关改了不生效。
// 因此本模块只收 env、自己取客户端，不让调用方传 Redis 进来。
const CACHE_PREFIX = 'platform:tenant-features:'
const CACHE_TTL_SECONDS = 300

/**
 * 功能开关清单。改这里要同步四处生效点：
 * 前台路由、底部导航、后台菜单、BFF 接口。只加常量不接线等于没做。
 */
export const FEATURE_KEYS = [
  'slots', 'live', 'sports', 'lottery', 'fishing',
  'task', 'checkin', 'spin', 'vip', 'rebate', 'loss_rebate',
  'team_commission', 'agent_center', 'community', 'tg_broadcast',
  'cs_ai', 'kyc', 'login_telegram', 'login_google', 'app_download',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureMap = Record<string, boolean>

const KEY_SET: ReadonlySet<string> = new Set(FEATURE_KEYS)

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && KEY_SET.has(value)
}

/**
 * 平台库不可用时的兜底：全开。
 *
 * 反过来（全关）会把一次平台库抖动放大成全站功能消失，比"某个该关的模块多开了几分钟"
 * 严重得多。真正需要硬关的场景（如某租户禁提现）不靠这里，靠租户状态机。
 */
function allEnabled(): FeatureMap {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]))
}

interface FeatureRow extends RowDataPacket {
  feature_key: string
  enabled: number
}

/**
 * 套餐默认值 + 租户级覆盖。租户覆盖优先 —— 真实运营一定会出现
 * "这家先别开提现" 这类需求，只有套餐粒度不够用。
 *
 * 未挂套餐的租户拿不到任何默认行，此时只有租户覆盖生效，其余按 FEATURE_KEYS 全开。
 */
async function queryFeatures(tenantId: number): Promise<FeatureMap> {
  const pool = getPlatformPool()
  const [rows] = await pool.query<FeatureRow[]>(
    `SELECT pf.feature_key, pf.enabled
       FROM pf_tenant_plan tp
       JOIN pf_plan_feature pf ON pf.plan_id = tp.plan_id
      WHERE tp.tenant_id = ? AND tp.ended_at IS NULL`,
    [tenantId],
  )
  const [overrides] = await pool.query<FeatureRow[]>(
    'SELECT feature_key, enabled FROM pf_tenant_feature WHERE tenant_id = ?',
    [tenantId],
  )

  const map = allEnabled()
  for (const row of rows) {
    if (KEY_SET.has(row.feature_key)) map[row.feature_key] = row.enabled === 1
  }
  for (const row of overrides) {
    if (KEY_SET.has(row.feature_key)) map[row.feature_key] = row.enabled === 1
  }
  return map
}

export async function getTenantFeatures(env: Env, tenantId: number): Promise<FeatureMap> {
  const redis = getDefaultRedis(env)
  const cacheKey = `${CACHE_PREFIX}${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try { return JSON.parse(cached) as FeatureMap } catch { /* 缓存脏了就回源 */ }
  }

  let features: FeatureMap
  try {
    features = await queryFeatures(tenantId)
  } catch (err) {
    // 与 resolveTenantByHost 同样的处理：平台库故障不写缓存，避免把故障态钉住 5 分钟
    log.error({ err, tenantId }, '读取租户功能开关失败，本次按全开处理')
    return allEnabled()
  }

  await redis.set(cacheKey, JSON.stringify(features), 'EX', CACHE_TTL_SECONDS)
  return features
}

/** 开关或套餐变更后调用，避免等 5 分钟缓存自然过期 */
export async function invalidateTenantFeatureCache(env: Env, tenantId?: number): Promise<void> {
  const redis = getDefaultRedis(env)
  if (tenantId !== undefined) {
    await redis.del(`${CACHE_PREFIX}${tenantId}`)
    return
  }
  const keys = await scanKeys(redis, `${CACHE_PREFIX}*`)
  if (keys.length > 0) await redis.del(...keys)
}

/**
 * 租户级覆盖的读写。`enabled=null` 表示删除覆盖、回落到套餐默认值 ——
 * 没有这个语义就只能靠"再写一个和套餐相同的值"来假装恢复，换套餐后会留下错误的钉死值。
 */
export async function listTenantOverrides(tenantId: number): Promise<FeatureMap> {
  const [rows] = await getPlatformPool().query<FeatureRow[]>(
    'SELECT feature_key, enabled FROM pf_tenant_feature WHERE tenant_id = ?',
    [tenantId],
  )
  return Object.fromEntries(rows.filter((r) => KEY_SET.has(r.feature_key)).map((r) => [r.feature_key, r.enabled === 1]))
}

export async function setTenantOverride(tenantId: number, key: FeatureKey, enabled: boolean | null): Promise<void> {
  const pool = getPlatformPool()
  if (enabled === null) {
    await pool.query('DELETE FROM pf_tenant_feature WHERE tenant_id = ? AND feature_key = ?', [tenantId, key])
    return
  }
  await pool.query(
    `INSERT INTO pf_tenant_feature (tenant_id, feature_key, enabled) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    [tenantId, key, enabled ? 1 : 0],
  )
}

/** 套餐默认值，供平台后台展示"改成什么会回到什么" */
export async function getPlanDefaults(tenantId: number): Promise<FeatureMap> {
  const [rows] = await getPlatformPool().query<FeatureRow[]>(
    `SELECT pf.feature_key, pf.enabled
       FROM pf_tenant_plan tp
       JOIN pf_plan_feature pf ON pf.plan_id = tp.plan_id
      WHERE tp.tenant_id = ? AND tp.ended_at IS NULL`,
    [tenantId],
  )
  const map = allEnabled()
  for (const row of rows) {
    if (KEY_SET.has(row.feature_key)) map[row.feature_key] = row.enabled === 1
  }
  return map
}
