import type { FastifyInstance } from 'fastify'
import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { handleYfPayCallback, type YfPayCallbackPayload } from '../handlers/yfpay-callback.handler.js'
import { handleMatrixCallback, type MatrixNotify } from '../handlers/matrix-callback.handler.js'
import { parseNotify, normalizePem, type MatrixEnvelope } from '../utils/matrix-crypto.js'

export async function startCallbackConsumer(app: FastifyInstance) {
  const jsm = app.jsm
  const js = app.js
  const db = app.mysql
  const redis = app.redis as unknown as Redis

  await jsm.consumers.add(env.NATS_STREAM, {
    durable_name: 'callback-worker',
    filter_subject: env.NATS_CALLBACK_SUBJECT,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    max_deliver: 5,
    ack_wait: 30 * 1e9,
  }).catch((err: Error) => {
    if (!err.message?.includes('consumer name already in use')) throw err
  })

  const consumer = await js.consumers.get(env.NATS_STREAM, 'callback-worker')
  const messages = await consumer.consume()

  app.log.info('Callback consumer started')

  ;(async () => {
    for await (const msg of messages) {
      let provider = 'unknown'
      try {
        const { provider: p, payload, rawBody } = JSON.parse(msg.string()) as {
          provider: string
          payload: Record<string, unknown>
          rawBody?: string
        }
        provider = p

        if (provider === 'yfpay') {
          await handleYfPayCallback(payload as YfPayCallbackPayload, db, redis)

        } else if (provider === 'matrix') {
          // Matrix payload 是加密外层报文，在 callback.routes 已验签，
          // 这里解密得到业务数据再处理
          const merchantNotifyPrivKey = normalizePem(env.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY)
          const platformNotifyPubKey = normalizePem(env.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY)

          if (!merchantNotifyPrivKey || !platformNotifyPubKey) {
            app.log.warn('Matrix notify keys not configured, skipping')
            msg.ack()
            continue
          }

          const bizData = parseNotify<MatrixNotify>(
            payload as unknown as MatrixEnvelope,
            platformNotifyPubKey,
            merchantNotifyPrivKey,
          )
          await handleMatrixCallback(bizData, rawBody ?? JSON.stringify(payload), db, redis, env.USDT_TO_PHP_RATE)

        } else {
          app.log.warn({ provider }, 'Callback consumer: unknown provider, acking')
        }

        msg.ack()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        app.log.error({ provider, err: message }, 'Callback consumer processing failed, will retry')
        msg.nak()
      }
    }
  })()
}
