import type { FastifyInstance } from 'fastify'
import { AckPolicy, DeliverPolicy, type JsMsg } from '@nats-io/jetstream'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { handleYfPayCallback, type YfPayCallbackPayload } from '../handlers/yfpay-callback.handler.js'
import { handleUnispayCallback, type UnispayCallbackPayload } from '../handlers/unispay-callback.handler.js'
import { handleMatrixCallback, type MatrixNotify } from '../handlers/matrix-callback.handler.js'
import { parseNotify, normalizePem, type MatrixEnvelope } from '../utils/matrix-crypto.js'
import { runWithTenant } from '../lib/tenant-context.js'
import { selfOperatedTenant, tenantByCode } from '../clients/platform-mysql.js'

export async function startCallbackConsumer(app: FastifyInstance) {
  const jsm = app.jsm
  const js = app.js
  // 注意：db / redis 必须在租户上下文内取，不能在这里提前捕获 —— 
  // 消费者启动时没有租户上下文，捕获到的是自营站的池和无前缀客户端

  // 两个 durable 并存：
  //   callback-worker    —— 旧的无租户段 subject，只用于排空切换瞬间的在途消息，
  //                         下个发布周期可删。durable 的 filter_subject 改不了，
  //                         直接改会因为这里只吞 "already in use" 而静默沿用旧过滤器，
  //                         结果是回调再也收不到 —— 必须用新名字。
  //   callback-worker-v2 —— 按租户拆分后的 betogo.callback.<tenantCode>
  // Workqueue 保留策略要求消费者过滤不重叠，这两个 subject 不重叠，可以并存。
  const consumerDefs = [
    { durable: 'callback-worker', filter: env.NATS_CALLBACK_SUBJECT },
    { durable: 'callback-worker-v2', filter: `${env.NATS_CALLBACK_SUBJECT}.>` },
  ]
  for (const def of consumerDefs) {
    await jsm.consumers.add(env.NATS_STREAM, {
      durable_name: def.durable,
      filter_subject: def.filter,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: 5,
      ack_wait: 30 * 1e9,
    }).catch((err: Error) => {
      if (!err.message?.includes('consumer name already in use')) throw err
    })
  }

  app.log.info({ consumers: consumerDefs.map((d) => d.durable) }, 'Callback consumer started')

  async function processMessage(msg: JsMsg) {
    let provider = 'unknown'
    try {
      const { provider: p, payload, tenantCode } = JSON.parse(msg.string()) as {
        provider: string
        payload: Record<string, unknown>
        tenantCode?: string
      }
      provider = p

      // 老消息没有 tenantCode（部署切换瞬间可能还有在途消息），按自营站处理
      const tenant = tenantCode ? await tenantByCode(tenantCode) : await selfOperatedTenant()
      if (!tenant) {
        app.log.error({ provider, tenantCode }, '回调消息的租户不存在，nak 等待重投')
        msg.nak()
        return
      }
      await runWithTenant(tenant, async () => {
        const db = app.mysql
        const redis = app.redis as unknown as Redis

        if (provider === 'yfpay') {
          await handleYfPayCallback(payload as YfPayCallbackPayload, db, redis)

        } else if (provider === 'unispay') {
          await handleUnispayCallback(payload as UnispayCallbackPayload, db, redis)

        } else if (provider === 'matrix') {
          // Matrix payload 是加密外层报文，在 callback.routes 已验签，
          // 这里解密得到业务数据再处理
          const merchantNotifyPrivKey = normalizePem(env.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY)
          const platformNotifyPubKey = normalizePem(env.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY)

          if (!merchantNotifyPrivKey || !platformNotifyPubKey) {
            app.log.warn('Matrix notify keys not configured, skipping')
            return
          }

          const bizData = parseNotify<MatrixNotify>(
            payload as unknown as MatrixEnvelope,
            platformNotifyPubKey,
            merchantNotifyPrivKey,
          )
          await handleMatrixCallback(bizData, JSON.stringify(payload), db, redis, env.USDT_TO_PHP_RATE)

        } else {
          app.log.warn({ provider }, 'Callback consumer: unknown provider, acking')
        }
      })

      msg.ack()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      app.log.error({ provider, err: message }, 'Callback consumer processing failed, will retry')
      msg.nak()
    }
  }

  for (const def of consumerDefs) {
    void (async () => {
      for (;;) {
        try {
          const consumer = await js.consumers.get(env.NATS_STREAM, def.durable)
          const messages = await consumer.consume()
          for await (const msg of messages) {
            await processMessage(msg)
          }
          app.log.warn({ durable: def.durable }, 'Callback consumer stream ended, restarting...')
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          app.log.error({ durable: def.durable, err: message }, 'Callback consumer crashed, restarting in 3s')
        }
        await new Promise<void>(r => setTimeout(r, 3000))
      }
    })()
  }
}
