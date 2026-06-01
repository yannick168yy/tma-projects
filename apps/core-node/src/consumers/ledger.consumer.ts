import type { FastifyInstance } from 'fastify'
import { AckPolicy, DeliverPolicy, type JsMsg } from '@nats-io/jetstream'
import { WalletService } from '../services/wallet.service.js'
import { env } from '../config/env.js'

export async function startLedgerConsumer(app: FastifyInstance) {
  const jsm = app.jsm
  const js = app.js
  const walletService = new WalletService(app)

  await jsm.consumers.add(env.NATS_STREAM, {
    durable_name: 'ledger-worker',
    filter_subject: env.NATS_LEDGER_SUBJECT,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    max_deliver: 5,
    ack_wait: 30 * 1e9,
  }).catch((err: Error) => {
    if (!err.message?.includes('consumer name already in use')) throw err
  })

  app.log.info('Ledger consumer started')

  async function processMessage(msg: JsMsg) {
    try {
      const entry = JSON.parse(msg.string())
      const result = await walletService.applyLedger(entry)
      app.log.info({ refId: entry.refId, newBalance: result.newBalance }, 'Ledger applied')
      msg.ack()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('DUPLICATE_REF_ID')) {
        app.log.warn({ msg: message }, 'Duplicate ledger entry, skipping')
        msg.ack()
      } else {
        app.log.error({ err: message }, 'Ledger processing failed, will retry')
        msg.nak()
      }
    }
  }

  ;(async () => {
    for (;;) {
      try {
        const consumer = await js.consumers.get(env.NATS_STREAM, 'ledger-worker')
        const messages = await consumer.consume()
        for await (const msg of messages) {
          await processMessage(msg)
        }
        app.log.warn('Ledger consumer stream ended, restarting...')
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        app.log.error({ err: message }, 'Ledger consumer crashed, restarting in 3s')
      }
      await new Promise<void>(r => setTimeout(r, 3000))
    }
  })()
}
