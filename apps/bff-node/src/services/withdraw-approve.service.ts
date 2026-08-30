import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { saveWithdraw, creditWallet } from './store/index.js'
import { executeMatrixWithdrawOrder } from './matrix.service.js'
import { createWithdrawal as yfpayCreateWithdrawal, YfPayError } from './yfpay.service.js'
import { createWithdrawal as unispayCreateWithdrawal, UnispayError } from './unispay.service.js'
import { refreshAndCheckProviderBalance } from './payment-accounting.service.js'
import { nowIso } from '../utils/format.js'
import { providerFromChannel } from '../utils/payment-provider.js'

export interface ApproveResult {
  status: OrderWithdraw['status']
  matrixOrderNo?: string
}

const isYfpay = (o: OrderWithdraw) =>
  o.provider === 'yfpay' || providerFromChannel(o.channelId) === 'yfpay'
const isUnispay = (o: OrderWithdraw) =>
  o.provider === 'unispay' || providerFromChannel(o.channelId) === 'unispay'

/**
 * 批准提款并出款。管理员人工批准与自动审核共用此路径，避免两份逻辑漂移。
 * 各渠道出款均延迟到此处（审核通过 / 人工批准）才真正发生：
 * - matrix：调 Matrix API 链上出款；失败时内部已退款并置 failed，会抛错。
 * - yfpay：调 YF Pay API 出款；失败时退款 + 置 failed，会抛错。
 * - 其他渠道（tg_wallet 等）：直接标记完成。
 * 调用方需自行保证 order.status === 'pending'。
 */
export async function approveWithdraw(
  env: Env,
  redis: Redis,
  order: OrderWithdraw,
): Promise<ApproveResult> {
  if (order.channelId === 'matrix') {
    const matrixOrderNo = await executeMatrixWithdrawOrder(env, redis, order.orderId)
    return { status: 'processing', matrixOrderNo }
  }

  if (isYfpay(order)) {
    const ex = (order.extraData ?? {}) as Record<string, unknown>
    const optionCode = ex.optionCode || ex.channelCode
    try {
      const r = await yfpayCreateWithdrawal({
        merchantSerial: order.orderId,
        amount: order.amount,
        // 收款人不外泄用户真实姓名，改传去横杠的用户编号（BG-10001 → BG10001）
        targetOwner: order.userId.replace(/-/g, ''),
        targetAccount: String(ex.targetAccount ?? ''),
        optionCode: optionCode ? String(optionCode) : undefined,
        notifyUrl: env.YFPAY_NOTIFY_URL,
      }, env)
      order.status = 'processing'
      order.extraData = { ...ex, platformId: r.platformId }
      await saveWithdraw(redis, order)
      // 出款后即时刷新余额并检查低额告警，不阻塞审批响应
      void refreshAndCheckProviderBalance(env, 'yfpay').catch(() => {})
      return { status: 'processing' }
    } catch (err) {
      console.error('[bff] yfpay withdrawal/create failed', {
        orderId: order.orderId,
        code: err instanceof YfPayError ? err.code : undefined,
        message: err instanceof Error ? err.message : String(err),
      })
      await creditWallet(redis, order.userId, order.amount, {
        type: 'bonus',
        refId: `REFUND_${order.orderId}`,
        description: `YF Pay 提现出款失败退款 #${order.orderId}`,
        createdAt: nowIso(),
        currency: order.currency ?? 'PHP',
      })
      order.status = 'failed'
      await saveWithdraw(redis, order)
      throw new Error(err instanceof YfPayError ? err.message : 'YF Pay 提现出款失败')
    }
  }

  if (isUnispay(order)) {
    const ex = (order.extraData ?? {}) as Record<string, unknown>
    try {
      const r = await unispayCreateWithdrawal({
        merchantSerial: order.orderId,
        amount: order.amount,
        channelName: String(ex.channelCode ?? '').toLowerCase(),
        targetOwner: String(ex.targetOwner ?? ''),
        targetAccount: String(ex.targetAccount ?? ''),
        notifyUrl: env.UNISPAY_NOTIFY_URL,
      }, env)
      order.status = 'processing'
      order.extraData = { ...ex, platformId: r.platformId }
      await saveWithdraw(redis, order)
      return { status: 'processing' }
    } catch (err) {
      await creditWallet(redis, order.userId, order.amount, {
        type: 'bonus',
        refId: `REFUND_${order.orderId}`,
        description: `UnisPay 提现出款失败退款 #${order.orderId}`,
        createdAt: nowIso(),
        currency: order.currency ?? 'IDR',
      })
      order.status = 'failed'
      await saveWithdraw(redis, order)
      throw new Error(err instanceof UnispayError ? err.message : 'UnisPay 提现出款失败')
    }
  }

  order.status = 'completed'
  order.completedAt = nowIso()
  await saveWithdraw(redis, order)
  return { status: order.status }
}
