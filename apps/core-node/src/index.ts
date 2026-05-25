import { buildApp } from './app.js'
import { env } from './config/env.js'

const app = await buildApp()

try {
  await app.listen({ port: env.CORE_PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
