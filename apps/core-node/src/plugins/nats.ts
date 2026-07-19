import fp from 'fastify-plugin'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager, RetentionPolicy, StorageType, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream'
import { type NatsConnection } from '@nats-io/nats-core'
import { env } from '../config/env.js'

declare module 'fastify' {
  interface FastifyInstance {
    nats: NatsConnection
    jsm: JetStreamManager
    js: JetStreamClient
  }
}

export default fp(async (app) => {
  const nc = await connect({ servers: env.NATS_URL })
  const jsm = await jetstreamManager(nc)
  const js = jetstream(nc)

  // 确保 stream 存在
  await jsm.streams.add({
    name: env.NATS_STREAM,
    subjects: ['betogo.>'],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    max_age: 7 * 24 * 60 * 60 * 1e9, // 7 天（纳秒）
  }).catch((err: Error) => {
    if (!err.message?.includes('stream name already in use')) throw err
  })

  app.decorate('nats', nc)
  app.decorate('jsm', jsm)
  app.decorate('js', js)

  app.addHook('onClose', async () => {
    await nc.drain()
  })
}, { name: 'nats' })
