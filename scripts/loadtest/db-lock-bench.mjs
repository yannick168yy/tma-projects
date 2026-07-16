// 方案B：直压 bg_wallet 行锁 —— 复刻 core-node deduct/settle 的核心事务(SELECT..FOR UPDATE + UPDATE)
// 不走 core HTTP、不碰 CompanyKey/IP白名单。在 tma-bff-node 容器内运行(有 mysql2 + MYSQL_* env)：
//   podman exec -i -e CONC=10 -e DUR=25 -e MODE=spread -e POOLMAX=10 tma-bff-node node --input-type=module < db-lock-bench.mjs
// 每次"下注"=两个锁事务(deduct -amount, settle +amount, 净零不排干余额)。
import mysql from 'mysql2/promise'

const CONC = Number(process.env.CONC || 10)
const DUR = Number(process.env.DUR || 25) * 1000
const MODE = process.env.MODE || 'spread' // spread=各worker打不同用户(比池/DB吞吐) | same=全打LT-1(比单行锁串行)
const POOLMAX = Number(process.env.POOLMAX || 10) // 与 core mysql.client connectionLimit 一致
const USERS = Number(process.env.USERS || 200)

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: POOLMAX, waitForConnections: true, queueLimit: 0,
})

async function lockTxn(userId, delta) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('SELECT available FROM bg_wallet WHERE user_id=? AND currency=? FOR UPDATE', [userId, 'PHP'])
    await conn.query('UPDATE bg_wallet SET available=ROUND(available+?,2), version=version+1 WHERE user_id=? AND currency=?', [delta, userId, 'PHP'])
    await conn.commit()
  } catch (e) { await conn.rollback().catch(() => {}); throw e } finally { conn.release() }
}

const lat = []
let txnOk = 0, errs = 0
const deadline = Date.now() + DUR

async function worker(id) {
  let i = 0
  while (Date.now() < deadline) {
    const uid = MODE === 'same' ? 'LT-1' : `LT-${((id * 7 + i) % USERS) + 1}`
    i++
    const t = process.hrtime.bigint()
    try { await lockTxn(uid, -0.01); await lockTxn(uid, 0.01); txnOk += 2 } catch (e) { errs++ }
    lat.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
}

await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))
lat.sort((a, b) => a - b)
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))].toFixed(1) : 'NA'
console.log(JSON.stringify({
  CONC, MODE, POOLMAX, bets: lat.length, txn_ok: txnOk, errs,
  txn_per_s: (txnOk / (DUR / 1000)).toFixed(1),
  bet_p50_ms: pct(50), bet_p95_ms: pct(95), bet_p99_ms: pct(99),
}))
await pool.end()
process.exit(0)
