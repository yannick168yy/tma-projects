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
// 先删所有对 bg_user 有外键的子表，否则 DELETE bg_user 触发 FK 报错。
//   bg_spin_chance：claim/签到测试发的转盘次数；bg_user_vip_state：迁移151 累计列 + 任务成长值 + 等级状态。
//   （二者均由压测流程副产，收尾时若不先删会挡住 bg_user 删除——实测踩过。）
const [sc] = await pool.query("DELETE FROM bg_spin_chance WHERE user_id LIKE 'LT-%'").catch(() => [{ affectedRows: 'skip' }])
const [vs] = await pool.query("DELETE FROM bg_user_vip_state WHERE user_id LIKE 'LT-%'").catch(() => [{ affectedRows: 'skip' }])
const [tn] = await pool.query("DELETE FROM bg_team_node WHERE user_id LIKE 'LT-%'").catch(() => [{ affectedRows: 'skip' }])
const [w] = await pool.query("DELETE FROM bg_wallet WHERE user_id LIKE 'LT-%'").catch(() => [{ affectedRows: 'skip' }])
const [ps] = await pool.query("DELETE FROM bg_user_promo_state WHERE user_id LIKE 'LT-%'")
const [u] = await pool.query("DELETE FROM bg_user WHERE id LIKE 'LT-%'")
process.stderr.write(`redis session 删 ${delSess}；mysql spin_chance=${sc.affectedRows} vip_state=${vs.affectedRows} team_node=${tn.affectedRows} bg_wallet=${w.affectedRows} promo_state=${ps.affectedRows} bg_user=${u.affectedRows}\n`)
await redis.quit()
process.exit(0)
