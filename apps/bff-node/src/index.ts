import { bootstrapEnv } from './config/bootstrap.js'
import { createApp } from './app.js'
import { logger } from './lib/logger.js'
import { closeRedis, getRedis } from './clients/redis.client.js'
import { closeMysql, getStorageMode, warmupMysql, isMysqlEnabled } from './clients/mysql.client.js'
import { warmupPlatformMysql } from './clients/platform-mysql.client.js'
import { syncFeatureBonusLockToRedis } from './services/feature-bonus-lock.service.js'
import { forEachTenant } from './services/tenant-jobs.js'

const env = await bootstrapEnv()

process.on('beforeExit', (code) => {
  logger.warn({ code }, 'process beforeExit')
})

process.on('exit', (code) => {
  logger.warn({ code }, 'process exit')
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection')
})

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception')
  process.exit(1)
})

if (isMysqlEnabled(env)) {
  try {
    await warmupMysql(env)
  } catch (err) {
    logger.error({ err }, 'mysql warmup failed, starting server anyway')
  }
  // 不阻塞启动：预热失败要重试 18 秒，期间服务器不监听就是 nginx 502。
  // 租户中间件自带重试与兜底，冷启动这几秒不需要平台库就绪。
  void warmupPlatformMysql().catch((err: unknown) => {
    logger.error({ err }, 'platform mysql warmup failed, tenant resolution will retry on demand')
  })
}

const app = createApp(env)

if (isMysqlEnabled(env)) {
  // 把 feature 彩金闸阈值从 bg_admin_settings 播到 Redis 供 core-node 读。
  // 重试兜住启动瞬间偶发的 tma-mysql DNS 未就绪（reference_deploy_dns）。
  // 每个租户各播一份：阈值存在各自的 bg_admin_settings，Redis 键也带各自前缀。
  // 重试必须放在租户回调内 —— forEachTenant 会吞掉单租户异常以隔离故障，
  // 放外面的话第一次 DNS 抖动就被当成"成功"，重试永远不触发。
  void forEachTenant('feature-bonus-lock-seed', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await syncFeatureBonusLockToRedis(env, getRedis(env))
        return
      } catch (err) {
        if (attempt === 5) throw err
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
  })
}

const server = app.listen(env.BFF_PORT, () => {
  const nacos = Boolean(process.env.NACOS_SERVER_ADDR?.trim())
  logger.info({ port: env.BFF_PORT, storage: getStorageMode(), nacos }, 'listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close()
  await closeRedis()
  await closeMysql()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
