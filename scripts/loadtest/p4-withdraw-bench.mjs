// P4d 提现并发防重测试 —— 同用户 10 并发提现，验证 Redis NX 锁恰放行 1 单 + 钱包恰扣 1 次。
// 前置由脚本自造：给测试用户插 bg_kyc approved（KYC 硬闸门）；打码无 pending 天然通过。
// 从 core 容器跑（勿在 bff 容器内，会挤爆其 256MB cgroup）:
//   测试:  podman exec -i -e BASE_URL=http://tma-bff-node:3000/api/v1 tma-core-node node --input-type=module < p4-withdraw-bench.mjs
//   清理:  podman exec -i -e MODE=cleanup tma-core-node node --input-type=module < p4-withdraw-bench.mjs
import mysql from 'mysql2/promise'

const MODE = process.env.MODE || 'bench'
const N = Number(process.env.N || 10)
const BASE = process.env.BASE_URL || 'http://tma-bff-node:3000/api/v1'
const UID = 'LT-210'
const AMT = 100

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: 3,
})
const q = async (sql, args) => (await pool.query(sql, args))[0]

async function wipe() {
  const orders = await q(`SELECT order_id FROM bg_withdraw_order WHERE user_id = ?`, [UID])
  if (orders.length) {
    await q(`DELETE FROM bg_withdraw_review_log WHERE order_id IN (?)`, [orders.map(o => o.order_id)])
    await q(`DELETE FROM bg_withdraw_order WHERE user_id = ?`, [UID])
  }
  await q(`DELETE FROM bg_wallet_ledger WHERE user_id = ? AND type = 'withdraw'`, [UID])
  await q(`DELETE FROM bg_kyc WHERE user_id = ?`, [UID])
  await q(`UPDATE bg_wallet SET available = 1000000 WHERE user_id = ? AND currency = 'PHP'`, [UID])
}

if (MODE === 'cleanup') {
  await wipe()
  process.stderr.write('cleanup done\n')
  await pool.end(); process.exit(0)
}

// ── setup ──
await wipe()
await q(`INSERT INTO bg_kyc (user_id, status, phone, phone_verified, doc_verified, face_verified)
  VALUES (?, 'approved', '+639000000210', 1, 1, 1)`, [UID])
const [[wBefore]] = [await q(`SELECT available FROM bg_wallet WHERE user_id = ? AND currency='PHP'`, [UID])]

// ── 同用户 N 并发提现 ──
const shots = await Promise.all(Array.from({ length: N }, () =>
  fetch(BASE + '/withdrawals', {
    method: 'POST',
    headers: { Authorization: `Bearer LTK-210`, 'X-Device-Id': `lt-${UID}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: 'tg_wallet', currency: 'PHP', amount: AMT }),
  }).then(async (r) => ({ code: r.status, body: (await r.text()).slice(0, 200), ms: 0 })).catch((e) => ({ code: 0, body: String(e).slice(0, 120) }))
))
const byCode = {}
for (const s of shots) byCode[s.code] = (byCode[s.code] || 0) + 1

// ── DB 复核 ──
await new Promise(r => setTimeout(r, 500))
const [[wAfter]] = [await q(`SELECT available FROM bg_wallet WHERE user_id = ? AND currency='PHP'`, [UID])]
const [ordCnt] = [await q(`SELECT order_id, status FROM bg_withdraw_order WHERE user_id = ?`, [UID])]
const [[ledCnt]] = [await q(`SELECT COUNT(*) n FROM bg_wallet_ledger WHERE user_id = ? AND type='withdraw'`, [UID])]
const [[rvCnt]] = [await q(`SELECT COUNT(*) n FROM bg_withdraw_review_log WHERE user_id = ?`, [UID])]

const delta = +(Number(wAfter.available) - Number(wBefore.available)).toFixed(2)
const pass = (byCode[200] || 0) === 1 && ordCnt.length === 1 && ledCnt.n === 1 && delta === -AMT
console.log(JSON.stringify({
  N, byCode,
  sample: shots.find((s) => s.code !== 200)?.body ?? null,
  db: { orders: ordCnt, ledger_rows: ledCnt.n, wallet_delta: delta, review_log_rows: rvCnt.n },
  PASS: pass,
}, null, 1))
await pool.end(); process.exit(pass ? 0 : 1)
