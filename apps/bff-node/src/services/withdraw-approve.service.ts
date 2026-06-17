import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import type { OrderWithdraw } from '../types/domain.js'
import { saveWithdraw, creditWallet } from './store/index.js'
import { executeMatrixWithdrawOrder } from './matrix.service.js'
import { createWithdrawal as yfpayCreateWithdrawal, YfPayError } from './yfpay.service.js'
import { createWithdrawal as beepayCreateWithdrawal, BeepayError } from './beepay.service.js'
import { nowIso } from '../utils/format.js'
import { providerFromChannel } from '../utils/payment-provider.js'

export interface ApproveResult {
  status: OrderWithdraw['status']
  matrixOrderNo?: string
}

const isYfpay = (o: OrderWithdraw) =>
  o.provider === 'yfpay' || providerFromChannel(o.channelId) === 'yfpay'
const isBeepay = (o: OrderWithdraw) =>
  o.provider === 'beepay' || providerFromChannel(o.channelId) === 'beepay'

/**
 * 批准提款并出款。管理员人工批准与自动审核共用此路径，避免两份逻辑漂移。
 * 各渠道出款均延迟到此处（审核通过 / 人工批准）才真正发生：
 * - matrix：调 Matrix API 链上出款；失败时内部已退款并置 failed，会抛错。
 * - yfpay：调 YF Pay API 出款；失败时退款 + 置 failed，会抛错。
 * - beepay：调 BeePay API 出款（TODO: 文档到手后实现）；失败同上。
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
        targetOwner: String(ex.targetOwner ?? ''),
        targetAccount: String(ex.targetAccount ?? ''),
        optionCode: optionCode ? String(optionCode) : undefined,
        notifyUrl: env.YFPAY_NOTIFY_URL,
      }, env)
      order.status = 'processing'
      order.extraData = { ...ex, platformId: r.platformId }
      await saveWithdraw(redis, order)
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

  if (isBeepay(order)) {
    const ex = (order.extraData ?? {}) as Record<string, unknown>
    try {
      const r = await beepayCreateWithdrawal({
        merchantSerial: order.orderId,
        amount: order.amount,
        targetOwner: String(ex.targetOwner ?? ''),
        targetAccount: String(ex.targetAccount ?? ''),
        channelCode: String(ex.channelCode ?? ''),
        notifyUrl: env.BEEPAY_NOTIFY_URL,
      }, env)
      order.status = 'processing'
      order.extraData = { ...ex, platformId: r.platformId }
      await saveWithdraw(redis, order)
      return { status: 'processing' }
    } catch (err) {
      await creditWallet(redis, order.userId, order.amount, {
        type: 'bonus',
        refId: `REFUND_${order.orderId}`,
        description: `BeePay 提现出款失败退款 #${order.orderId}`,
        createdAt: nowIso(),
        currency: order.currency ?? 'PHP',
      })
      order.status = 'failed'
      await saveWithdraw(redis, order)
      throw new Error(err instanceof BeepayError ? err.message : 'BeePay 提现出款失败')
    }
  }

  order.status = 'completed'
  order.completedAt = nowIso()
  await saveWithdraw(redis, order)
  return { status: order.status }
}
