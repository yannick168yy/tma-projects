import type { Redis } from 'ioredis'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import type { Env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'
import { currentTenantOrNull } from '../../lib/tenant-context.js'
import { getRate } from '../exchange-rate.service.js'
import { round4 } from './billing-engine.js'
import { enqueueManual, ensureAccount, postLedger, SETTLE_CURRENCY } from './tenant-account.service.js'
import { resolveSettlementMode } from './settlement-mode.service.js'

const log = childLogger('payout-quota')

export class PayoutQuotaError extends Error {
  constructor(message: string, readonly available: number, readonly needed: number) {
    super(message)
    this.name = 'PayoutQuotaError'
  }
}

/**
 * 模式 A 代付放款前的额度门禁（P2-7）。
 *
 * 只约束「已配额度的客户站」：`pf_tenant_account` 里配过押金或授信的非自营租户。
 * 自营站与未开额度的租户完全不受影响 —— 否则一上线所有提现会立刻全部转人工
 * （自营站的额度账户里根本没有对应真实资金的余额），这是会打断线上业务的改动。
 *
 * 代价明确写在这里：**忘记给客户配额度就等于这家没有门禁**。宁可漏一家，
 * 也不能让一个配置遗漏把所有站点的提现卡住。
 */
export async function assertPayoutQuota(
  env: Env,
  redis: Redis,
  order: { orderId: string; channelId: string; amount: number; currency?: string },
): Promise<void> {
  const tenant = currentTenantOrNull()
  if (!tenant || tenant.selfOperated) return

  const mode = await resolveSettlementMode(env, tenant.id, order.channelId)
  // 模式 B 的钱从客户自己的通道出，平台不碰，不该占平台额度
  if (mode !== 'platform') return

  const account = await ensureAccount(tenant.id)
  if (account.depositAmount <= 0 && account.creditLimit <= 0) return

  const currency = order.currency ?? 'PHP'
  const needed = await toSettleCurrency(redis, env, order.amount, currency)
  if (account.available >= needed) return

  await enqueueManual({
    tenantId: tenant.id,
    kind: 'payout_insufficient',
    refType: 'withdraw_order',
    refId: order.orderId,
    amount: needed,
    reason: `代付 ${order.amount} ${currency}（折 ${needed} ${SETTLE_CURRENCY}）超出可动用额度 ${account.available}`,
  })
  log.warn({ tenant: tenant.code, order: order.orderId, needed, available: account.available },
    '额度不足，代付转人工')
  // 抛错让审批接口返回失败：订单留在 pending，既不自动拒绝玩家、也不由平台垫付
  throw new PayoutQuotaError(
    `租户可动用额度不足（需 ${needed} ${SETTLE_CURRENCY}，可用 ${account.available}），已转人工处理`,
    account.available, needed)
}

/**
 * 放款成功后扣划额度（P2-7）。
 * ref 用订单号，靠流水唯一键幂等 —— 审批重试、回调重放都不会重复扣。
 */
export async function chargePayout(
  env: Env,
  redis: Redis,
  order: { orderId: string; channelId: string; amount: number; currency?: string },
): Promise<void> {
  const tenant = currentTenantOrNull()
  if (!tenant || tenant.selfOperated) return
  if (await resolveSettlementMode(env, tenant.id, order.channelId) !== 'platform') return
  const account = await ensureAccount(tenant.id)
  if (account.depositAmount <= 0 && account.creditLimit <= 0) return

  const currency = order.currency ?? 'PHP'
  const amount = await toSettleCurrency(redis, env, order.amount, currency)
  const res = await postLedger({
    tenantId: tenant.id,
    bizType: 'payout',
    amount: -amount,
    refType: 'withdraw_order',
    refId: order.orderId,
    remark: `平台代付 ${order.amount} ${currency}`,
  })
  if (!res.duplicated) {
    log.info({ tenant: tenant.code, order: order.orderId, amount, balanceAfter: res.balanceAfter }, '代付已扣额度')
  }
}

async function toSettleCurrency(redis: Redis, env: Env, amount: number, currency: string): Promise<number> {
  if (currency === SETTLE_CURRENCY) return round4(amount)
  const { rate } = await getRate(redis, currency, SETTLE_CURRENCY, env)
  // 汇率取不到时按 0 折算会让门禁形同放行，这里宁可报错：放款金额算不准就不该放
  if (!(rate > 0)) throw new Error(`取不到 ${currency} → ${SETTLE_CURRENCY} 汇率，无法核算代付额度`)
  return round4(amount * rate)
}

/**
 * 冲回失败代付占用的额度（P2-7）。
 *
 * 出款是「提交即扣额度」，但代付可能在支付商侧最终失败并退款给玩家。
 * 那种情况下平台其实没垫出这笔钱，额度必须还回去 —— 否则客户的可动用额度
 * 会被一笔没发生的代付长期占着，最后表现为「莫名其妙被停提现」。
 *
 * 幂等靠流水唯一键：ref 用 `payout_reversal:<订单号>`，重复跑不会多冲。
 */
export async function reverseFailedPayouts(env: Env, days = 7): Promise<number> {
  const tenant = currentTenantOrNull()
  if (!tenant || tenant.selfOperated) return 0

  const [ledgerRows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT ref_id, amount FROM pf_tenant_ledger
      WHERE tenant_id = ? AND biz_type = 'payout' AND ref_type = 'withdraw_order'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [tenant.id, days])
  if (ledgerRows.length === 0) return 0

  const byOrder = new Map(ledgerRows.map((r) => [String(r.ref_id), Number(r.amount)]))
  const [orders] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT order_id, status FROM bg_withdraw_order WHERE order_id IN (?)`, [[...byOrder.keys()]])

  let reversed = 0
  for (const o of orders) {
    if (!['failed', 'rejected', 'admin_rejected'].includes(String(o.status))) continue
    const charged = byOrder.get(String(o.order_id)) ?? 0
    if (charged >= 0) continue
    const res = await postLedger({
      tenantId: tenant.id,
      bizType: 'manual_adjust',
      amount: -charged,
      refType: 'payout_reversal',
      refId: String(o.order_id),
      remark: `代付失败冲回 #${o.order_id}`,
    })
    if (!res.duplicated) {
      reversed += 1
      log.info({ tenant: tenant.code, order: o.order_id, amount: -charged }, '代付失败，额度已冲回')
    }
  }
  return reversed
}
