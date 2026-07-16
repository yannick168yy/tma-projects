// P4c 注册/登录写压测 —— 走完整 HTTP 链路（容器内 127.0.0.1:3000，含风控/scrypt/建号事务）。
// 前置：服务器 .env 临时置空 TURNSTILE_SECRET_KEY + recreate-bff-node.sh（压完必须恢复）。
// 在 tma-bff-node 容器内跑:
//   注册吞吐:  podman exec -i -e MODE=register -e CONC=5 -e DUR=20 tma-bff-node node --input-type=module < p4-auth-bench.mjs
//   同名并发:  podman exec -i -e MODE=dup tma-bff-node node --input-type=module < p4-auth-bench.mjs
//   登录吞吐:  podman exec -i -e MODE=login -e CONC=5 -e DUR=20 tma-bff-node node --input-type=module < p4-auth-bench.mjs
//   清理:      podman exec -i -e MODE=cleanup tma-bff-node node --input-type=module < p4-auth-bench.mjs
import mysql from 'mysql2/promise'

const MODE = process.env.MODE || 'register'
const CONC = Number(process.env.CONC || 5)
const DUR = Number(process.env.DUR || 20) * 1000
const BASE = 'http://127.0.0.1:3000/api/v1'
const PASSWORD = 'LoadTest#123'
const RUN = String(Date.now() % 100000)

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
  connectionLimit: 5,
})
const q = async (sql, args) => (await pool.query(sql, args))[0]

const post = (path, body) => fetch(BASE + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'lt-auth-bench' },
  body: JSON.stringify(body),
}).then(async (r) => ({ code: r.status, body: (await r.text()).slice(0, 800) })).catch((e) => ({ code: 0, body: String(e).slice(0, 150) }))

if (MODE === 'cleanup') {
  const ids = await q(`SELECT user_id FROM bg_user_identity WHERE provider='account' AND identifier REGEXP '^lr[0-9]+x[0-9]+x[0-9]+$'`)
  const uids = ids.map((r) => r.user_id)
  if (uids.length) {
    await q(`DELETE FROM bg_user_identity WHERE user_id IN (?)`, [uids])
    await q(`DELETE FROM bg_wallet WHERE user_id IN (?)`, [uids])
    await q(`DELETE FROM bg_user_promo_state WHERE user_id IN (?)`, [uids])
    await q(`DELETE FROM bg_team_node WHERE user_id IN (?)`, [uids])
    await q(`DELETE FROM bg_user WHERE id IN (?)`, [uids])
  }
  process.stderr.write(`cleanup: 删除 ${uids.length} 个压测注册用户\n`)
  await pool.end(); process.exit(0)
}

if (MODE === 'dup') {
  // 同名并发唯一键冲突：10 个并发注册同一 username，应恰 1 成功
  const name = `lr${RUN}x99x99`
  const shots = await Promise.all(Array.from({ length: 10 }, () => post('/auth/register', { method: 'account', identifier: name, password: PASSWORD })))
  const byCode = {}
  for (const s of shots) byCode[s.code] = (byCode[s.code] || 0) + 1
  const [row] = await q(`SELECT COUNT(*) n FROM bg_user_identity WHERE provider='account' AND identifier = ?`, [name])
  const detail = shots.map((s) => s.code === 200 ? `200 uid=${(s.body.match(/BG-[0-9]+/) || ['?'])[0]}` : `${s.code} ${s.body.slice(0, 80)}`)
  const pass = (byCode[200] || 0) === 1 && row.n === 1
  console.log(JSON.stringify({ MODE, byCode, identity_rows: row.n, detail, PASS: pass }, null, 1))
  await pool.end(); process.exit(pass ? 0 : 1)
}

// register / login 吞吐
const lat = []; let ok = 0; const errs = {}
const deadline = Date.now() + DUR

let loginPool = []
if (MODE === 'login') {
  loginPool = (await q(`SELECT identifier FROM bg_user_identity WHERE provider='account' AND identifier REGEXP '^lr[0-9]+x[0-9]+x[0-9]+$' LIMIT 500`)).map((r) => r.identifier)
  if (!loginPool.length) { process.stderr.write('无压测注册用户，先跑 MODE=register\n'); process.exit(1) }
}

async function worker(id) {
  let i = 0
  while (Date.now() < deadline) {
    const body = MODE === 'register'
      ? { method: 'account', identifier: `lr${RUN}x${id}x${i}`, password: PASSWORD }
      : { method: 'account', identifier: loginPool[(id * 31 + i) % loginPool.length], password: PASSWORD }
    i++
    const t = process.hrtime.bigint()
    const r = await post(MODE === 'register' ? '/auth/register' : '/auth/login', body)
    lat.push(Number(process.hrtime.bigint() - t) / 1e6)
    if (r.code === 200) ok++
    else errs[`${r.code} ${r.body.slice(0, 60)}`] = (errs[`${r.code} ${r.body.slice(0, 60)}`] || 0) + 1
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))

lat.sort((a, b) => a - b)
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))].toFixed(1) : 'NA'
console.log(JSON.stringify({
  MODE, CONC, ok, tps: (ok / (DUR / 1000)).toFixed(1),
  p50_ms: pct(50), p95_ms: pct(95), p99_ms: pct(99), errs,
}))
await pool.end(); process.exit(0)
