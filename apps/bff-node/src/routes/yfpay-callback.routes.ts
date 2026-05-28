import Router from '@koa/router'
import { verifySign } from '../services/yfpay.service.js'
import { creditWallet } from '../services/store/index.js'
import {
  getOrderDeposit,
  getOrderWithdraw,
  updateOrderDepositStatus,
  updateOrderWithdrawStatus,
} from '../services/store/mysql-store.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'
import { nowIso } from '../utils/format.js'

const router = new Router({ prefix: '/callback' })

// POST https://www.188facai.com/api/v1/callback/yfpay
// YF Pay 代收/代付统一回调
router.post('/yfpay', async (ctx) => {
  const body = ctx.request.body as Record<string, unknown>
  const env = ctx.state.env
  const redis = ctx.state.redis

  // 验签
  if (!verifySign(body, env.YFPAY_API_KEY)) {
    ctx.status = 400
    ctx.body = 'sign error'
    return
  }

  const merchantSerial = String(body['merchantSerial'] ?? '')
  const platformId = String(body['platformId'] ?? '')
  const state = Number(body['state'])
  const amount = Number(body['amount'])

  // 幂等：同一平台订单号只处理一次
  const idempotencyKey = `yfpay:cb:${platformId}`
  const locked = await redis.set(idempotencyKey, '1', 'EX', 7 * 24 * 3600, 'NX')
  if (!locked) {
    ctx.body = 'success'
    return
  }

  try {
    if (!isMysqlEnabled(env)) {
      ctx.log?.warn('YfPay callback: MySQL not enabled, skipping order update')
      ctx.body = 'success'
      return
    }

    // merchantSerial 前缀：YFD_ = 代收，YFW_ = 代付
    const isDeposit = merchantSerial.startsWith('YFD')

    if (isDeposit) {
      const order = await getOrderDeposit(env, merchantSerial)
      if (!order) {
        ctx.log?.warn({ merchantSerial }, 'YfPay callback: deposit order not found')
        ctx.body = 'success'
        return
      }
      // state=2 完成 → 入账；state=3 失败 → 仅更新状态
      if (state === 2) {
        if (Math.abs(amount - order.amount) > 0.01) {
          ctx.log?.warn({ merchantSerial, orderAmount: order.amount, callbackAmount: amount }, 'YfPay callback: amount mismatch')
        }
        await creditWallet(redis, order.userId, Math.round(order.amount * 100), {
          type: 'deposit',
          refId: merchantSerial,
          description: `YF Pay 充值 #${merchantSerial}`,
          traceId: ctx.state.traceId,
          createdAt: nowIso(),
        })
        await updateOrderDepositStatus(env, merchantSerial, 'paid', platformId, { state })
      } else if (state === 3) {
        await updateOrderDepositStatus(env, merchantSerial, 'rejected', platformId, { state })
      }

    } else {
      const order = await getOrderWithdraw(env, merchantSerial)
      if (!order) {
        ctx.log?.warn({ merchantSerial }, 'YfPay callback: withdrawal order not found')
        ctx.body = 'success'
        return
      }
      // state=1 完成（已扣款，无需操作）；state=2/3 驳回 → 退款
      if (state === 1) {
        await updateOrderWithdrawStatus(env, merchantSerial, 'completed', { providerRef: platformId })
      } else if (state === 2 || state === 3) {
        await creditWallet(redis, order.userId, order.amount, {
          type: 'bonus',
          refId: `REFUND_${merchantSerial}`,
          description: `YF Pay 提现退款 #${merchantSerial}`,
          traceId: ctx.state.traceId,
          createdAt: nowIso(),
        })
        await updateOrderWithdrawStatus(env, merchantSerial, 'rejected', { providerRef: platformId })
      }
    }
  } catch (err) {
    ctx.log?.error({ err, merchantSerial }, 'YfPay callback processing error')
    // 即使内部出错也返回 success，避免 YF Pay 重试（已加幂等锁）
    // 错误需通过日志告警处理
  }

  ctx.body = 'success'
})

export default router
