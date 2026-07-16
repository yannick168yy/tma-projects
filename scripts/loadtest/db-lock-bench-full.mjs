// B+：复刻 568win deduct+settle 的完整写入集(比纯B多5-6个INSERT/UPDATE)，量真实下注DB成本。
// 略去:turnover-requirements FIFO(bg_turnover_requirements) + 品类查询(用固定rate=1/slots)。其余照 win568-wallet.service 原样。
// 在 tma-bff-node 容器内跑:  podman exec -i -e CONC=10 -e DUR=20 -e POOLMAX=10 tma-bff-node node --input-type=module < db-lock-bench-full.mjs
import mysql from 'mysql2/promise'

const CONC = Number(process.env.CONC || 10)
const DUR = Number(process.env.DUR || 20) * 1000
const POOLMAX = Number(process.env.POOLMAX || 10)
const USERS = Number(process.env.USERS || 200)
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: POOLMAX, waitForConnections: true, queueLimit: 0,
})

// 一次完整下注: deduct 事务 + settle 事务
async function betCycle(uid, tc) {
  const amt = 10, win = 9
  // ---- deduct ----
  let c = await pool.getConnection()
  try {
    await c.beginTransaction()
    const [[w]] = await c.query('SELECT available FROM bg_wallet WHERE user_id=? AND currency=? FOR UPDATE', [uid, 'PHP'])
    const bal = Number(w?.available ?? 0)
    await c.query(`INSERT INTO bg_568win_wallet_txn (user_id,external_username,currency,transfer_code,transaction_id,product_type,game_type,gpid,provider_id,round_id,txn_type,amount,status,raw_request)
      VALUES (?,?,?,?,?,?,?,?,?,?,'bet',?,'running','{}')`, [uid, uid, 'PHP', tc, tc, 1, 1, 1, '101', tc, amt])
    const [r] = await c.query(`INSERT INTO bg_bet_order (user_id,aggregator_id,provider_id,provider_txn_id,round_id,bet_type,amount,currency_code,original_amount,exchange_rate,status)
      VALUES (?,'568win','101',?,?,'bet',?,'PHP',?,1,'pending')`, [uid, tc, tc, amt, amt])
    await c.query(`INSERT INTO bg_turnover_logs (user_id,currency,bet_order_id,bet_amount,rate,effective_amount,sort_category)
      VALUES (?,?,?,?,1,?,'slots')`, [uid, 'PHP', r.insertId, amt, amt])
    await c.query(`INSERT INTO bg_wallet_ledger (id,user_id,currency,type,amount,balance_after,ref_type,ref_id,description)
      VALUES (?,?,?,'bet',?,?,'game',?,'B+ deduct')`, ['lg-' + tc + '-d', uid, 'PHP', -amt, bal - amt, tc])
    await c.query('UPDATE bg_wallet SET available=ROUND(available-?,2), version=version+1 WHERE user_id=? AND currency=?', [amt, uid, 'PHP'])
    await c.commit()
  } catch (e) { await c.rollback().catch(() => {}); throw e } finally { c.release() }
  // ---- settle ----
  c = await pool.getConnection()
  try {
    await c.beginTransaction()
    const [[w]] = await c.query('SELECT available FROM bg_wallet WHERE user_id=? AND currency=? FOR UPDATE', [uid, 'PHP'])
    const bal = Number(w?.available ?? 0)
    await c.query("UPDATE bg_568win_wallet_txn SET status='settled', win_loss=?, settled_at=NOW(3) WHERE transfer_code=?", [win, tc])
    await c.query("UPDATE bg_bet_order SET status='settled', settled_at=NOW(3) WHERE aggregator_id='568win' AND provider_txn_id=? AND bet_type='bet'", [tc])
    await c.query(`INSERT IGNORE INTO bg_bet_order (user_id,aggregator_id,provider_id,provider_txn_id,round_id,bet_type,amount,currency_code,original_amount,exchange_rate,status,settled_at)
      VALUES (?,'568win','101',?,?,'win',?,'PHP',?,1,'settled',NOW(3))`, [uid, 'settle:' + tc, tc, win, win])
    await c.query(`INSERT INTO bg_wallet_ledger (id,user_id,currency,type,amount,balance_after,ref_type,ref_id,description)
      VALUES (?,?,?,'win',?,?,'game',?,'B+ settle')`, ['lg-' + tc + '-s', uid, 'PHP', win, bal + win, tc])
    await c.query('UPDATE bg_wallet SET available=ROUND(available+?,2), version=version+1 WHERE user_id=? AND currency=?', [win, uid, 'PHP'])
    await c.commit()
  } catch (e) { await c.rollback().catch(() => {}); throw e } finally { c.release() }
}

const lat = []; let bets = 0, errs = 0; const deadline = Date.now() + DUR
async function worker(id) {
  let i = 0
  while (Date.now() < deadline) {
    const uid = `LT-${((id * 7 + i) % USERS) + 1}`
    const tc = `bpf-${id}-${i}-${Date.now()}`
    i++
    const t = process.hrtime.bigint()
    try { await betCycle(uid, tc); bets++ } catch (e) { errs++ }
    lat.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))
lat.sort((a, b) => a - b)
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))].toFixed(1) : 'NA'
console.log(JSON.stringify({ CONC, POOLMAX, bets_ok: bets, errs, bets_per_s: (bets / (DUR / 1000)).toFixed(1), bet_p50_ms: pct(50), bet_p95_ms: pct(95), bet_p99_ms: pct(99) }))
await pool.end(); process.exit(0)
