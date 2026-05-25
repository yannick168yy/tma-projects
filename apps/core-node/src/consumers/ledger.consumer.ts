import type { FastifyInstance } from 'fastify'
import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream'
import { WalletService } from '../services/wallet.service.js'
import { env } from '../config/env.js'

export async function startLedgerConsumer(app: FastifyInstance) {
  const jsm = app.jsm
  const js = app.js
  const walletService = new WalletService(app)

  // 创建持久化消费者
  await jsm.consumers.add(env.NATS_STREAM, {
    durable_name: 'ledger-worker',
    filter_subject: env.NATS_LEDGER_SUBJECT,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    max_deliver: 5,
    ack_wait: 30 * 1e9, // 30秒（纳秒）
  }).catch((err: Error) => {
    if (!err.message?.includes('consumer name already in use')) throw err
  })

  const consumer = await js.consumers.get(env.NATS_STREAM, 'ledger-worker')
  const messages = await consumer.consume()

  app.log.info('Ledger consumer started')

  ;(async () => {
    for await (const msg of messages) {
      try {
        const entry = JSON.parse(msg.string())
        const result = await walletService.applyLedger(entry)
        app.log.info({ refId: entry.refId, newBalance: result.newBalance }, 'Ledger applied')
        msg.ack()
      } catch (err: any) {
        if (err.message?.startsWith('DUPLICATE_REF_ID')) {
          app.log.warn({ msg: err.message }, 'Duplicate ledger entry, skipping')
          msg.ack()
        } else {
          app.log.error({ err }, 'Ledger processing failed, will retry')
          msg.nak()
        }
      }
    }
  })()
}
