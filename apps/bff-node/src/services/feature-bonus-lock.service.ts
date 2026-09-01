import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getAdminSetting } from './admin-store.js'

// 老虎机 feature 彩金薅羊毛闸的阈值：后台「系统参数」可改，落 bg_admin_settings（持久）
// 并镜像到 Redis，供 core-node 派彩回调即时读取（跨服务热配置，改完不用重部署）。
export const FEATURE_BONUS_LOCK_ENABLED_KEY = 'feature_bonus_lock_enabled'
export const FEATURE_BONUS_LOCK_MIN_AMOUNT_KEY = 'feature_bonus_lock_min_amount'
export const FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR_KEY = 'feature_bonus_lock_min_amount_idr'
export const FEATURE_BONUS_LOCK_MIN_MULTIPLE_KEY = 'feature_bonus_lock_min_multiple'
export const FEATURE_BONUS_LOCK_WAGER_MULT_KEY = 'feature_bonus_lock_wager_mult'

export const DEFAULT_FEATURE_BONUS_LOCK_ENABLED = true
export const DEFAULT_FEATURE_BONUS_LOCK_MIN_AMOUNT = 50
// 印尼盾按站内既有惯例换算：ROUND(50 * 287 / 100) * 100（见迁移 206）。
// 共用 PHP 的 50 会让这道闸对 IDR 形同虚设——Rp 50 约合 ₱0.18。
export const DEFAULT_FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR = 14400
export const DEFAULT_FEATURE_BONUS_LOCK_MIN_MULTIPLE = 20
export const DEFAULT_FEATURE_BONUS_LOCK_WAGER_MULT = 2

// core-node 读取的 Redis 键（JSON）
export const FEATURE_BONUS_LOCK_REDIS_KEY = 'settings:feature_bonus_lock'

export interface FeatureBonusLockConfig {
  enabled: boolean
  minAmount: number
  minAmountIdr: number
  minMultiple: number
  wagerMult: number
}

function numOr(raw: string | null, def: number): number {
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : def
}

export async function getFeatureBonusLockConfig(env: Env): Promise<FeatureBonusLockConfig> {
  const [enabled, minAmount, minAmountIdr, minMultiple, wagerMult] = await Promise.all([
    getAdminSetting(env, FEATURE_BONUS_LOCK_ENABLED_KEY),
    getAdminSetting(env, FEATURE_BONUS_LOCK_MIN_AMOUNT_KEY),
    getAdminSetting(env, FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR_KEY),
    getAdminSetting(env, FEATURE_BONUS_LOCK_MIN_MULTIPLE_KEY),
    getAdminSetting(env, FEATURE_BONUS_LOCK_WAGER_MULT_KEY),
  ])
  return {
    enabled: enabled == null ? DEFAULT_FEATURE_BONUS_LOCK_ENABLED : enabled === '1',
    minAmount: numOr(minAmount, DEFAULT_FEATURE_BONUS_LOCK_MIN_AMOUNT),
    minAmountIdr: numOr(minAmountIdr, DEFAULT_FEATURE_BONUS_LOCK_MIN_AMOUNT_IDR),
    minMultiple: numOr(minMultiple, DEFAULT_FEATURE_BONUS_LOCK_MIN_MULTIPLE),
    wagerMult: numOr(wagerMult, DEFAULT_FEATURE_BONUS_LOCK_WAGER_MULT),
  }
}

// 把当前配置写进 Redis 供 core-node 读；PUT 保存后与 bff 启动时各调一次。
export async function syncFeatureBonusLockToRedis(env: Env, redis: Redis): Promise<void> {
  const cfg = await getFeatureBonusLockConfig(env)
  await redis.set(FEATURE_BONUS_LOCK_REDIS_KEY, JSON.stringify(cfg))
}
