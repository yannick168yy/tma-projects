import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { providerVerifiers } from '../providers/verifiers.js'
import { parseNotify, buildWithdrawCheckResponse, normalizePem, type MatrixEnvelope } from '../utils/matrix-crypto.js'
import type { RowDataPacket } from 'mysql2/promise'
import { recordUnispayIssue } from '../handlers/unispay-callback.handler.js'

export async function callbackRoutes(app: FastifyInstance) {
  // ── 通用回调入口：验签 → NATS（YF Pay / Matrix 通知）────────────────────────
  app.post<{ Params: { provider: string } }>(
    '/callback/:provider',
    async (req, reply) => {
      const { provider } = req.params
      const payload = req.body as Record<string, unknown>

      const verify = providerVerifiers[provider]
      if (!verify) {
        app.log.warn({ provider }, 'Callback: unknown provider')
        return reply.status(400).send({ code: 1, message: 'unknown provider' })
      }

      if (!verify(req, env as unknown as Record<string, string>)) {
        app.log.warn({ provider }, 'Callback: invalid signature')
        if (provider === 'unispay') await recordUnispayIssue(app.mysql, 'invalid_signature', payload as never)
        return reply.status(401).send({ code: 1, message: 'invalid signature' })
      }

      if (provider === 'unispay') {
        const required = ['amount', 'mchNo', 'mchOrderId', 'orderNo', 'status'] as const
        const missing = required.filter((key) => payload[key] === undefined || payload[key] === null || String(payload[key]).trim() === '')
        if (missing.length > 0 || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0 || !['1', '2', '3', '4'].includes(String(payload.status))) {
          app.log.warn({ missing, orderNo: payload.orderNo }, 'UnisPay callback: invalid payload')
          await recordUnispayIssue(app.mysql, 'invalid_payload', payload as never, { missing })
          return reply.status(400).send({ code: 1, message: 'invalid payload' })
        }
      }

      app.log.info({ provider }, 'Callback received, publishing to NATS')

      await app.js.publish(
        env.NATS_CALLBACK_SUBJECT,
        JSON.stringify({ provider, payload, receivedAt: Date.now() }),
      )

      // YF Pay / BeePay 要求明文 'success'；UnisPay 要求大写 'SUCCESS'
      if (provider === 'unispay') {
        reply.type('text/plain')
        return reply.send('SUCCESS')
      }
      if (provider === 'yfpay' || provider === 'beepay') {
        reply.type('text/plain')
        return reply.send('success')
      }
      return reply.send({ code: 0, message: 'ok' })
    }
  )

  // ── Matrix 提现反查（需同步加密响应，不能走 NATS）──────────────────────────
  app.post('/callback/matrix/withdraw-check', async (req, reply) => {
    const merchantNotifyPrivKey = normalizePem(env.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY)
    const platformNotifyPubKey = normalizePem(env.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY)

    if (!merchantNotifyPrivKey || !platformNotifyPubKey) {
      return reply.status(503).send({ code: 503, msg: 'Matrix not configured' })
    }

    let reqBiz: {
      merchantOrderNo: string
      amount: number
      symbol: string
      chain: string
      toAddress: string
    }

    try {
      reqBiz = parseNotify(
        req.body as MatrixEnvelope,
        platformNotifyPubKey,
        merchantNotifyPrivKey,
      )
    } catch {
      return reply.status(400).send({ code: 400, msg: 'decrypt or verify failed' })
    }

    // 检查本地是否有该待处理提现订单
    let approved = false
    try {
      const [rows] = await app.mysql.query<RowDataPacket[]>(
        `SELECT order_id FROM bg_withdraw_order
         WHERE order_id = ? AND status = 'pending' LIMIT 1`,
        [reqBiz.merchantOrderNo],
      )
      approved = rows.length > 0
    } catch {
      approved = false
    }

    const respBiz = {
      merchantOrderNo: reqBiz.merchantOrderNo,
      amount: reqBiz.amount,
      symbol: reqBiz.symbol,
      chain: reqBiz.chain,
      toAddress: reqBiz.toAddress,
      approved,
    }

    const envelope = buildWithdrawCheckResponse(respBiz, merchantNotifyPrivKey, platformNotifyPubKey)
    return reply.send({ code: 0, msg: 'success', ...envelope })
  })
}
