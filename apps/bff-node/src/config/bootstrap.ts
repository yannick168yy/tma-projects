import {
  applyConfigToProcessEnv,
  getNacosConnectionFromEnv,
  loadNacosConfig,
  subscribeNacosConfig,
} from './nacos.config.js'
import { loadEnv, type Env } from './env.js'

export async function bootstrapEnv(): Promise<Env> {
  const conn = getNacosConnectionFromEnv()
  if (conn) {
    try {
      const config = await loadNacosConfig(conn)
      applyConfigToProcessEnv(config)
      void subscribeNacosConfig(conn, () => {
        /* hot reload: next requests use updated process.env; loadEnv not re-run */
      }).catch((err) => {
        console.warn('[bff-node] Nacos subscribe failed:', err)
      })
    } catch (err) {
      console.error('[bff-node] Nacos load failed, falling back to process.env only:', err)
    }
  } else {
    console.info('[bff-node] NACOS_SERVER_ADDR not set, using process.env / .env only')
  }
  return loadEnv()
}
