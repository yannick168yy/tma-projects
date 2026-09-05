import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getDefaultRedis } from '../../clients/redis.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'

const log = childLogger('settlement-mode')

// 平台级配置：由平台控制台改、也由平台控制台失效，固定走无前缀客户端
const CACHE_PREFIX = 'platform:tenant-channels:'
const CACHE_TTL_SECONDS = 300

export type SettlementMode = 'platform' | 'tenant'

export interface ChannelOwnership {
  channelCode: string
  owner: SettlementMode
  merchantNo: string | null
  feeRatePct: number
  feeFixed: number
  hasCredential: boolean
  enabled: boolean
}

/**
 * 租户的通道归属表。
 *
 * 🔴 未登记通道默认按 `platform` 处理，理由是部署事实：支付商凭据来自平台部署的
 * 环境变量，钱进的是平台的商户号。默认成 `tenant` 会让平台在账单上少收自己垫付的
 * 通道手续费，并把平台代收的充值算成客户自收 —— 差异直接体现在客户该付多少钱上。
 *
 * 要走模式 B（客户自己的通道、钱不进平台），必须在平台控制台显式登记 owner=tenant
 * 并配好该通道的凭据。这是「不登记就不算」的反面：这里是「不登记就算平台的」，
 * 因为钱的实际去向由凭据决定，而凭据默认是平台的。
 */
export async function channelOwnership(env: Env, tenantId: number): Promise<Map<string, ChannelOwnership>> {
  const redis = getDefaultRedis(env)
  const key = `${CACHE_PREFIX}${tenantId}`
  try {
    const cached = await redis.get(key)
    if (cached) return new Map(Object.entries(JSON.parse(cached) as Record<string, ChannelOwnership>))
  } catch (err) {
    log.warn({ err, tenantId }, '通道归属缓存读取失败，回落查库')
  }

  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT channel_code, owner, merchant_no, fee_rate_pct, fee_fixed, credential_cipher, enabled
       FROM pf_tenant_channel WHERE tenant_id = ?`, [tenantId])
  const map = new Map<string, ChannelOwnership>()
  for (const r of rows) {
    map.set(String(r.channel_code), {
      channelCode: String(r.channel_code),
      owner: r.owner === 'tenant' ? 'tenant' : 'platform',
      merchantNo: r.merchant_no ?? null,
      feeRatePct: Number(r.fee_rate_pct ?? 0),
      feeFixed: Number(r.fee_fixed ?? 0),
      hasCredential: Boolean(r.credential_cipher),
      enabled: r.enabled === 1,
    })
  }
  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(Object.fromEntries(map)))
    .catch((err: unknown) => log.warn({ err, tenantId }, '通道归属缓存写入失败'))
  return map
}

export async function invalidateChannelOwnershipCache(env: Env, tenantId: number): Promise<void> {
  await getDefaultRedis(env).del(`${CACHE_PREFIX}${tenantId}`)
    .catch((err: unknown) => log.warn({ err, tenantId }, '通道归属缓存失效失败'))
}

/** 单个通道的资金模式。未登记 → platform（见上方说明） */
export async function resolveSettlementMode(
  env: Env, tenantId: number, channelCode: string,
): Promise<SettlementMode> {
  const map = await channelOwnership(env, tenantId)
  return map.get(channelCode)?.owner ?? 'platform'
}

/**
 * 模式 B 的前置检查：登记成租户自带通道，却没配凭据，就不能建单。
 *
 * 静默回落平台凭据是这里最坏的失败方式 —— 客户的玩家充的钱会进平台的商户号，
 * 而账单又按「租户自收」算，两边都错，且要等对账时才发现。
 */
export async function assertChannelUsable(
  env: Env, tenantId: number, channelCode: string,
): Promise<{ ok: true; mode: SettlementMode } | { ok: false; reason: string }> {
  const meta = (await channelOwnership(env, tenantId)).get(channelCode)
  if (!meta) return { ok: true, mode: 'platform' }
  if (!meta.enabled) return { ok: false, reason: `通道 ${channelCode} 已被平台停用` }
  if (meta.owner === 'tenant' && !meta.hasCredential) {
    return { ok: false, reason: `通道 ${channelCode} 登记为租户自带但未配置凭据，请联系平台` }
  }
  return { ok: true, mode: meta.owner }
}
