/**
 * 内部服务接口（仅供 bff-node 调用，需 X-Internal-Token）
 */
import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'

const lgId = () => `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export async function internalRoutes(app: FastifyInstance) {
  // 所有 /internal/* 路由都验 token
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return
    if (env.INTERNAL_TOKEN) {
      const token = req.headers['x-internal-token']
      if (token !== env.INTERNAL_TOKEN) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    }
  })

  // POST /internal/payment/tg-wallet
  // BFF 收到 Telegram successful_payment 后转发到此处入账
  app.post<{
    Body: {
      orderId: string
      userId: string
      amount: number        // PHP 元
      creditedCents: number // 实际入账 PHP（可含折算）
      currency: string
      description?: string
    }
  }>('/internal/payment/tg-wallet', async (req, reply) => {
    const { orderId, userId, amount, creditedCents, description } = req.body

    if (!orderId || !userId || creditedCents <= 0) {
      return reply.status(400).send({ code: 400, message: 'invalid payload' })
    }

    const db = app.mysql
    const redis = app.redis as unknown as Redis

    // 幂等：同一订单只处理一次
    const idempotencyKey = `tgwallet:cb:${orderId}`
    const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
    if (!locked) {
      return reply.send({ code: 0, message: 'duplicate, skipped' })
    }

    // 检查订单是否已 paid（双重保险）
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT status FROM bg_order_deposit WHERE order_id = ? LIMIT 1`,
      [orderId],
    )
    if (rows[0]?.status === 'paid') {
      return reply.send({ code: 0, message: 'already paid' })
    }

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute(
        `UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?`,
        [creditedCents, userId],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ?`,
        [userId],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
        [lgId(), userId, creditedCents, balanceAfter, orderId,
          description ?? 'Telegram Wallet deposit'],
      )
      await conn.execute(
        `UPDATE bg_order_deposit SET status='paid', paid_at=NOW() WHERE order_id=?`,
        [orderId],
      )
      await conn.commit()
      app.log.info({ orderId, userId, creditedCents }, 'TG Wallet deposit settled')
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      app.log.error({ err, orderId }, 'TG Wallet deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })
}
