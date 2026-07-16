// P4b claim 并发防重测试 —— 同用户并发 N 请求打 4 个领取接口，验证恰好成功 1 次 + DB 恰好 1 条记录。
// 在 tma-bff-node 容器内跑（HTTP 打容器内 127.0.0.1:3000，绕 nginx 但走完整 Koa 中间件链含风控）:
//   测试:  podman exec -i tma-bff-node node --input-type=module < p4-claim-bench.mjs
//   清理:  podman exec -i -e MODE=cleanup tma-bff-node node --input-type=module < p4-claim-bench.mjs
// 用户分配: checkin=LT-201(无今日注单,走base轨) tasks=LT-102(今日注单来自CONC12/15残留,daily_bets达标) rebate=LT-203 vip=LT-204
import mysql from 'mysql2/promise'

const MODE = process.env.MODE || 'bench'
const N = Number(process.env.N || 10)
const BASE = 'http://127.0.0.1:3000/api/v1'
const U = { checkin: 'LT-201', tasks: 'LT-102', rebate: 'LT-203', vip: 'LT-204' }

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: 5,
})
const q = async (sql, args) => (await pool.query(sql, args))[0]

async function wipe() {
  await q(`DELETE FROM bg_checkin_log WHERE user_id = ?`, [U.checkin])
  await q(`DELETE FROM bg_spin_chance WHERE user_id IN (?) AND source_order_id LIKE 'checkin:%'`, [[U.checkin]])
  await q(`DELETE FROM bg_spin_chance WHERE user_id = ? AND source_order_id LIKE 'daily_bets:%'`, [U.tasks])
  await q(`DELETE FROM bg_task_claim WHERE user_id = ? AND task_id = 'daily_bets'`, [U.tasks])
  const recs = await q(`SELECT id FROM bg_rebate_record WHERE user_id = ?`, [U.rebate])
  if (recs.length) await q(`DELETE FROM bg_wallet_ledger WHERE user_id = ? AND ref_type = 'rebate' AND ref_id IN (?)`, [U.rebate, recs.map(r => String(r.id))])
  await q(`DELETE FROM bg_rebate_record WHERE user_id = ?`, [U.rebate])
  const vrecs = await q(`SELECT id FROM bg_vip_reward_log WHERE user_id = ?`, [U.vip])
  if (vrecs.length) await q(`DELETE FROM bg_wallet_ledger WHERE user_id = ? AND ref_type = 'vip_bonus' AND ref_id IN (?)`, [U.vip, vrecs.map(r => String(r.id))])
  await q(`DELETE FROM bg_vip_reward_log WHERE user_id = ?`, [U.vip])
  await q(`UPDATE bg_wallet SET available = 1000000 WHERE user_id IN (?) AND currency = 'PHP'`, [[U.rebate, U.vip]])
}

if (MODE === 'cleanup') {
  await wipe()
  process.stderr.write('cleanup done\n')
  await pool.end(); process.exit(0)
}

// ── setup: 清残留 + 造可领取状态 ──
await wipe()
await q(`INSERT INTO bg_rebate_record (user_id, date, game_category, currency_code, bet_amount, rebate_amount, rate_pct, status)
  VALUES (?, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'slots', 'PHP', 1000, 8, 0.8, 'pending')`, [U.rebate])
await q(`INSERT INTO bg_vip_reward_log (user_id, level, type, amount, currency_code, period_key, status)
  VALUES (?, 2, 'promotion', 8.88, 'PHP', 'L2', 'pending')`, [U.vip])
const balBefore = new Map((await q(`SELECT user_id, available FROM bg_wallet WHERE user_id IN (?) AND currency='PHP'`, [[U.rebate, U.vip]])).map(r => [r.user_id, Number(r.available)]))

// ── 并发发射：同用户 N 个请求同时打同一接口 ──
async function volley(name, uid, path, body) {
  const token = 'LTK-' + uid.slice(3)
  const shots = await Promise.all(Array.from({ length: N }, () =>
    fetch(BASE + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': `lt-${uid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).then(async (r) => ({ code: r.status, body: (await r.text()).slice(0, 120) })).catch((e) => ({ code: 0, body: String(e).slice(0, 120) }))
  ))
  const byCode = {}
  for (const s of shots) byCode[s.code] = (byCode[s.code] || 0) + 1
  const sample = shots.find((s) => s.code !== 200)
  return { name, uid, byCode, ok: byCode[200] || 0, sampleNon200: sample ? `${sample.code} ${sample.body}` : null }
}

const results = []
results.push(await volley('checkin', U.checkin, '/promotions/checkin/claim'))
results.push(await volley('task:daily_bets', U.tasks, '/tasks/daily_bets/claim', { currency: 'PHP' }))
results.push(await volley('rebate', U.rebate, '/rebate/claim', { currency: 'PHP' }))
results.push(await volley('vip', U.vip, '/vip/claim', { currency: 'PHP' }))

// ── DB 复核：每场景恰 1 条落库 ──
const [checkinRows] = await q(`SELECT COUNT(*) n FROM bg_checkin_log WHERE user_id = ?`, [U.checkin])
const [taskRows] = await q(`SELECT COUNT(*) n FROM bg_task_claim WHERE user_id = ? AND task_id='daily_bets'`, [U.tasks])
const [rebatePaid] = await q(`SELECT COUNT(*) n FROM bg_rebate_record WHERE user_id = ? AND status='paid'`, [U.rebate])
const [rebateLedger] = await q(`SELECT COUNT(*) n FROM bg_wallet_ledger WHERE user_id = ? AND ref_type='rebate'`, [U.rebate])
const [vipPaid] = await q(`SELECT COUNT(*) n FROM bg_vip_reward_log WHERE user_id = ? AND status='paid'`, [U.vip])
const [vipLedger] = await q(`SELECT COUNT(*) n FROM bg_wallet_ledger WHERE user_id = ? AND ref_type='vip_bonus'`, [U.vip])
const balAfter = new Map((await q(`SELECT user_id, available FROM bg_wallet WHERE user_id IN (?) AND currency='PHP'`, [[U.rebate, U.vip]])).map(r => [r.user_id, Number(r.available)]))

const db = {
  checkin_log_rows: checkinRows.n,
  task_claim_rows: taskRows.n,
  rebate: { paid_rows: rebatePaid.n, ledger_rows: rebateLedger.n, wallet_delta: +(balAfter.get(U.rebate) - balBefore.get(U.rebate)).toFixed(2) },
  vip: { paid_rows: vipPaid.n, ledger_rows: vipLedger.n, wallet_delta: +(balAfter.get(U.vip) - balBefore.get(U.vip)).toFixed(2) },
}
const pass =
  results.every((r) => r.ok === 1) &&
  db.checkin_log_rows === 1 && db.task_claim_rows === 1 &&
  db.rebate.paid_rows === 1 && db.rebate.ledger_rows === 1 && db.rebate.wallet_delta === 8 &&
  db.vip.paid_rows === 1 && db.vip.ledger_rows === 1 && db.vip.wallet_delta === 8.88

console.log(JSON.stringify({ N, results, db, PASS: pass }, null, 1))
await pool.end(); process.exit(pass ? 0 : 1)
