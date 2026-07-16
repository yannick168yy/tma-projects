// 清除压测种子数据 —— 删除 seed-users.mjs 记录在 SET `tma:loadtest:keys` 里的全部 key
//   ssh ... 'podman exec -i tma-bff-node node --input-type=module' < cleanup.mjs
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const INDEX_KEY = 'tma:loadtest:keys'
const redis = new Redis(REDIS_URL)

const keys = await redis.smembers(INDEX_KEY)
if (keys.length === 0) {
  process.stderr.write('no loadtest keys found\n')
} else {
  const pipe = redis.pipeline()
  for (const k of keys) pipe.del(k)
  pipe.del(INDEX_KEY)
  await pipe.exec()
  process.stderr.write(`deleted ${keys.length} keys + index\n`)
}
await redis.quit()
