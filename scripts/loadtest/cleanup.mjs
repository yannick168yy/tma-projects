// 清除压测种子 —— 删 MySQL 的 LT-* 用户行 + Redis 的 LTK-* session
//   ssh ... 'podman exec -i tma-bff-node node --input-type=module' < cleanup.mjs
const { loadEnv } = await import('/app/dist/config/env.js')
const { getRedis } = await import('/app/dist/clients/redis.client.js')
const { getMysqlPool } = await import('/app/dist/clients/mysql.client.js')

const env = loadEnv()
const redis = getRedis(env)

// Redis: 删所有 LTK-* session
let cursor = '0', delSess = 0
do {
  const [next, keys] = await redis.scan(cursor, 'MATCH', 'tma:session:LTK-*', 'COUNT', 500)
  cursor = next
  if (keys.length) { await redis.del(...keys); delSess += keys.length }
} while (cursor !== '0')

// MySQL: 删 LT-* 用户相关行
const pool = getMysqlPool(env)
const [w] = await pool.query("DELETE FROM bg_wallet WHERE user_id LIKE 'LT-%'").catch(() => [{ affectedRows: 'skip' }])
const [ps] = await pool.query("DELETE FROM bg_user_promo_state WHERE user_id LIKE 'LT-%'")
const [u] = await pool.query("DELETE FROM bg_user WHERE id LIKE 'LT-%'")
process.stderr.write(`redis session 删 ${delSess}；mysql bg_wallet=${w.affectedRows} promo_state=${ps.affectedRows} bg_user=${u.affectedRows}\n`)
await redis.quit()
process.exit(0)
