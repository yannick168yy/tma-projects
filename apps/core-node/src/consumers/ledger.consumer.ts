import type { FastifyInstance } from 'fastify'
import { AckPolicy, DeliverPolicy, type JsMsg } from '@nats-io/jetstream'
import { WalletService, type LedgerEntry } from '../services/wallet.service.js'
import { env } from '../config/env.js'
import { runWithTenant } from '../lib/tenant-context.js'
import { selfOperatedTenant, tenantByCode } from '../clients/platform-mysql.js'

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
      const entry = JSON.parse(msg.string()) as LedgerEntry & { tenantCode?: string }
      // 账变消息同样要带租户；老消息按自营站处理
      const tenant = entry.tenantCode ? await tenantByCode(entry.tenantCode) : await selfOperatedTenant()
      if (!tenant) {
        app.log.error({ tenantCode: entry.tenantCode }, '账变消息的租户不存在，nak 等待重投')
        msg.nak()
        return
      }
      // WalletService 在调用时才读 app.mysql / app.redis，所以包在这里即可生效
      const result = await runWithTenant(tenant, () => walletService.applyLedger(entry))
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
