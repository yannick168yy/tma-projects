// P4a 下注+结算写压测（对账版）—— 复刻 win568-wallet deduct/settle 完整写入集直压 DB(不走core HTTP,不碰SW凭证),
// 压后强制对账：每用户 钱包余额变化 == 本轮 ledger 净流水之和，验证高并发下不丢账不重账。
// 在 tma-bff-node 容器内跑:
//   压测:  podman exec -i -e CONC=10 -e DUR=20 -e POOLMAX=10 tma-bff-node node --input-type=module < p4-bet-settle-bench.mjs
//   清理:  podman exec -i -e MODE=cleanup tma-bff-node node --input-type=module < p4-bet-settle-bench.mjs
import mysql from 'mysql2/promise'

const MODE = process.env.MODE || 'bench'
const CONC = Number(process.env.CONC || 10)
const DUR = Number(process.env.DUR || 20) * 1000
const POOLMAX = Number(process.env.POOLMAX || 10)
const USERS = Number(process.env.USERS || 200)
const SAME_USER = process.env.SAME_USER === '1' // 单用户行锁热点模式

const RUN = String(Date.now() % 1000000) // 本轮标签:对账只汇总本轮 ledger,避免混入上轮残留
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: POOLMAX, waitForConnections: true, queueLimit: 0,
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

if (MODE === 'cleanup') {
  // 全部小批次删(教训:无LIMIT大删在64M buffer pool小机上会跑几分钟持锁)
  const batch = async (label, sql) => {
    let total = 0
    for (;;) { const [r] = await pool.query(`${sql} LIMIT 1000`); total += r.affectedRows; if (r.affectedRows < 1000) break; await sleep(80) }
    process.stderr.write(`  cleanup ${label}: ${total}\n`)
  }
  { // join删不支持LIMIT:先选id再按主键删
    let total = 0
    for (;;) {
      const [ids] = await pool.query(`SELECT tl.id FROM bg_turnover_logs tl JOIN bg_bet_order b ON b.id = tl.bet_order_id WHERE b.provider_txn_id LIKE 'p4%' LIMIT 1000`)
      if (!ids.length) break
      const [r] = await pool.query(`DELETE FROM bg_turnover_logs WHERE id IN (?)`, [ids.map(x => x.id)])
      total += r.affectedRows; await sleep(80)
    }
    process.stderr.write(`  cleanup turnover: ${total}\n`)
  }
  await batch('ledger', `DELETE FROM bg_wallet_ledger WHERE id LIKE 'lg-p4%'`)
  await batch('bet_order(win)', `DELETE FROM bg_bet_order WHERE provider_txn_id LIKE 'settle:p4%'`)
  await batch('bet_order(bet)', `DELETE FROM bg_bet_order WHERE provider_txn_id LIKE 'p4%'`)
  await batch('wallet_txn', `DELETE FROM bg_568win_wallet_txn WHERE transfer_code LIKE 'p4%'`)
  const [r] = await pool.query(`UPDATE bg_wallet SET available = 1000000 WHERE user_id LIKE 'LT-%' AND currency = 'PHP'`)
  // 迁移151：betCycle 曾把 p4 下注累加进 turnover_total；删 p4 turnover 后从残留 logs 重算，
  // 让累计列与 bg_turnover_logs 复归一致（保留 seed-history 灌入的历史总额）。
  const [vs] = await pool.query(
    `UPDATE bg_user_vip_state vs SET turnover_total = COALESCE(
       (SELECT SUM(effective_amount) FROM bg_turnover_logs tl
        WHERE tl.user_id = vs.user_id AND tl.currency = vs.currency AND tl.is_reversed = 0), 0)
     WHERE vs.user_id LIKE 'LT-%'`)
  process.stderr.write(`  恢复钱包: ${r.affectedRows}；重算累计列: ${vs.affectedRows}\ncleanup done\n`)
  await pool.end(); process.exit(0)
}

// ── 压前快照 ──
const snap = async () => {
  const [rows] = await pool.query(`SELECT user_id, available FROM bg_wallet WHERE user_id LIKE 'LT-%' AND currency='PHP'`)
  return new Map(rows.map(r => [r.user_id, Number(r.available)]))
}
const before = await snap()

// ── 完整下注周期(照 win568-wallet.service 写入集) ──
async function betCycle(uid, tc) {
  const amt = 10, win = 9
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
    // 迁移151：真实 allocateBetTurnover 现同事务增量维护 turnover_total，复刻进来保持写入集完整
    // （写事务从 5→6 写；与 pre-151 的 266下注/s 基线对比时留意这一项）
    await c.query(`INSERT INTO bg_user_vip_state (user_id,currency,turnover_total) VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE turnover_total = turnover_total + VALUES(turnover_total)`, [uid, 'PHP', amt])
    await c.query(`INSERT INTO bg_wallet_ledger (id,user_id,currency,type,amount,balance_after,ref_type,ref_id,description)
      VALUES (?,?,?,'bet',?,?,'game',?,'P4 deduct')`, ['lg-' + tc + '-d', uid, 'PHP', -amt, bal - amt, tc])
    await c.query('UPDATE bg_wallet SET available=ROUND(available-?,2), version=version+1 WHERE user_id=? AND currency=?', [amt, uid, 'PHP'])
    await c.commit()
  } catch (e) { await c.rollback().catch(() => {}); throw e } finally { c.release() }
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
      VALUES (?,?,?,'win',?,?,'game',?,'P4 settle')`, ['lg-' + tc + '-s', uid, 'PHP', win, bal + win, tc])
    await c.query('UPDATE bg_wallet SET available=ROUND(available+?,2), version=version+1 WHERE user_id=? AND currency=?', [win, uid, 'PHP'])
    await c.commit()
  } catch (e) { await c.rollback().catch(() => {}); throw e } finally { c.release() }
}

const lat = []; let bets = 0, errs = 0; const deadline = Date.now() + DUR
async function worker(id) {
  let i = 0
  while (Date.now() < deadline) {
    const uid = SAME_USER ? 'LT-1' : `LT-${((id * 7 + i) % USERS) + 1}`
    const tc = `p4${RUN}-${id}-${i}`
    i++
    const t = process.hrtime.bigint()
    try { await betCycle(uid, tc); bets++ } catch (e) { errs++ }
    lat.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))

// ── 对账：余额变化 == 本轮 ledger 净流水 ──
await sleep(500)
const after = await snap()
const [led] = await pool.query(
  `SELECT user_id, SUM(amount) AS net, COUNT(*) AS n FROM bg_wallet_ledger WHERE id LIKE ? GROUP BY user_id`, [`lg-p4${RUN}-%`])
let checked = 0, mismatch = 0
for (const r of led) {
  checked++
  const expect = (before.get(r.user_id) ?? 0) + Number(r.net)
  const actual = after.get(r.user_id) ?? 0
  if (Math.abs(expect - actual) > 0.001) {
    mismatch++
    process.stderr.write(`MISMATCH ${r.user_id}: before=${before.get(r.user_id)} net=${r.net} expect=${expect} actual=${actual}\n`)
  }
}
lat.sort((a, b) => a - b)
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))].toFixed(1) : 'NA'
console.log(JSON.stringify({
  MODE: SAME_USER ? 'same-user' : 'spread', CONC, POOLMAX, bets_ok: bets, errs,
  bets_per_s: (bets / (DUR / 1000)).toFixed(1), p50_ms: pct(50), p95_ms: pct(95), p99_ms: pct(99),
  reconcile: { users_checked: checked, mismatch },
}))
await pool.end(); process.exit(mismatch === 0 ? 0 : 1)
