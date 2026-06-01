/**
 * Matrix 平台回调路由（无需用户鉴权，需验签）
 *
 * POST /api/v1/callback/matrix           — 充值/提现/地址变更通知
 * POST /api/v1/callback/matrix/withdraw-check — 提现反查（可选）
 */
import Router from '@koa/router'
import { parseNotify, buildWithdrawCheckResponse, type MatrixEnvelope } from '../utils/matrix-crypto.js'
import {
  handleDepositNotify,
  handleWithdrawNotify,
  updateDepositAddress,
  matrixNotifyKeysFromEnv,
  type MatrixDepositNotify,
  type MatrixWithdrawNotify,
} from '../services/matrix.service.js'
import { getMysqlPool } from '../clients/mysql.client.js'

const router = new Router()

// ── 通用通知回调 ──────────────────────────────────────────────────────────────

router.post('/callback/matrix', async (ctx) => {
  const env = ctx.state.env
  const rawBody = JSON.stringify(ctx.request.body)

  let bizData: { notifyType: number } & Record<string, unknown>
  try {
    const keys = matrixNotifyKeysFromEnv(env)
    bizData = parseNotify<{ notifyType: number } & Record<string, unknown>>(
      ctx.request.body as MatrixEnvelope,
      keys.platformNotifyPubKeyPem,
      keys.merchantNotifyPrivKeyPem,
    )
  } catch (err) {
    ctx.status = 400
    ctx.body = { code: 400, msg: 'decrypt or verify failed' }
    return
  }

  try {
    const { notifyType } = bizData

    if (notifyType === 1) {
      await handleDepositNotify(env, ctx.state.redis, bizData as unknown as MatrixDepositNotify, rawBody)
    } else if (notifyType === 2) {
      await handleWithdrawNotify(env, ctx.state.redis, bizData as unknown as MatrixWithdrawNotify, rawBody)
    } else if (notifyType === 3) {
      // 收款地址变更
      const pool = getMysqlPool(env)
      const n = bizData as unknown as {
        userId: string
        symbol: string
        chain: string
        newAddress: string
      }
      await updateDepositAddress(pool, n.userId, n.symbol, n.chain, n.newAddress)
    }
  } catch (err) {
    // 业务处理失败：返回非 0，平台会重试
    ctx.status = 200
    ctx.body = { code: 500, msg: 'internal error' }
    return
  }

  // 平台要求：code=0, msg="success"（小写）
  ctx.status = 200
  ctx.body = { code: 0, msg: 'success' }
})

// ── 提现反查 ──────────────────────────────────────────────────────────────────

router.post('/callback/matrix/withdraw-check', async (ctx) => {
  const env = ctx.state.env

  let req: {
    merchantOrderNo: string
    amount: number
    symbol: string
    chain: string
    toAddress: string
  }
  try {
    const keys = matrixNotifyKeysFromEnv(env)
    req = parseNotify(
      ctx.request.body as MatrixEnvelope,
      keys.platformNotifyPubKeyPem,
      keys.merchantNotifyPrivKeyPem,
    )
  } catch {
    ctx.status = 400
    ctx.body = { code: 400, msg: 'decrypt or verify failed' }
    return
  }

  // 校验：本地是否有这笔待处理的提现订单
  let approved = false
  try {
    const pool = getMysqlPool(env)
    const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT id FROM bg_matrix_withdraw_order
       WHERE merchant_order_no=? AND local_status='pending' LIMIT 1`,
      [req.merchantOrderNo],
    )
    approved = rows.length > 0
  } catch {
    // 查询失败拒绝，平台会重试
    approved = false
  }

  const respBiz = {
    merchantOrderNo: req.merchantOrderNo,
    amount: req.amount,
    symbol: req.symbol,
    chain: req.chain,
    toAddress: req.toAddress,
    approved,
  }

  const keys = matrixNotifyKeysFromEnv(env)
  const envelope = buildWithdrawCheckResponse(
    respBiz,
    keys.merchantNotifyPrivKeyPem,
    keys.platformNotifyPubKeyPem,
  )

  ctx.status = 200
  ctx.body = { code: 0, msg: 'success', ...envelope }
})

export default router
