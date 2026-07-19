// P0 历史数据灌注 —— 给压测种子用户造真实体量的业务数据（列结构已按线上实查核对）。
// 三组画像：重历史组(LT-1..HEAVY,每人ROUNDS局注单+2×ROUNDS条ledger+存提单)、
//           团队组(LT-(HEAVY+1)..(HEAVY+AGENTS),每人3级下线50/20/10+流水+佣金)、
//           全池钱包(LT-1..POOL 保证 bg_wallet 有行,供写压测)。
// 在 tma-bff-node 容器内跑（有 mysql2 + DB env）：
//   seed:    podman exec -i tma-bff-node node --input-type=module < seed-history.mjs
//   cleanup: podman exec -i -e MODE=cleanup tma-bff-node node --input-type=module < seed-history.mjs
// 教训内置：cleanup 全部走索引列等值/前缀 + DELETE LIMIT 小批次 + sleep，单进程串行，绝不并发大删。
import mysql from 'mysql2/promise'

const MODE = process.env.MODE || 'seed'
const HEAVY = Number(process.env.HEAVY || 50)
const ROUNDS = Number(process.env.ROUNDS || 3000)
const AGENTS = Number(process.env.AGENTS || 30)
const POOL = Number(process.env.POOL || 500)
const SPREAD_DAYS = Number(process.env.SPREAD_DAYS || 60)
const BATCH = 500

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => process.stderr.write(s + '\n')

// 确定性伪随机（可重跑出同样数据）
let rngState = 42
const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const NOW = Date.now()
const mysqlTs = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ')
// 第 n/total 份数据落在过去 SPREAD_DAYS 天内，越大越新
const spreadTs = (n, total) => mysqlTs(NOW - (total - n) * (SPREAD_DAYS * 86400_000 / total))

async function batchInsert(table, cols, rows, ignore = false) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const placeholders = chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',')
    await conn.query(
      `INSERT ${ignore ? 'IGNORE ' : ''}INTO ${table} (${cols.join(',')}) VALUES ${placeholders}`,
      chunk.flat(),
    )
    await sleep(30)
  }
}

// ─────────────────────────── cleanup ───────────────────────────
async function batchDelete(label, sql, params = []) {
  let total = 0
  for (;;) {
    const [r] = await conn.query(`${sql} LIMIT 2000`, params)
    total += r.affectedRows
    if (r.affectedRows < 2000) break
    await sleep(100)
  }
  log(`  cleanup ${label}: ${total} rows`)
}

if (MODE === 'cleanup') {
  log('== cleanup 开始（小批次串行）==')
  // 依赖顺序：turnover_logs(FK bet_order) → bet 系 → ledger/存提 → 团队(commission/turnover/node→user) → wallet
  for (let i = 1; i <= HEAVY; i++) {
    await batchDelete(`turnover LT-${i}`, 'DELETE FROM bg_turnover_logs WHERE user_id = ?', [`LT-${i}`])
  }
  await batchDelete('bet_round', "DELETE FROM bg_bet_round WHERE user_id LIKE 'LT-%'")
  for (let i = 1; i <= HEAVY; i++) {
    await batchDelete(`bet_order LT-${i}`, 'DELETE FROM bg_bet_order WHERE user_id = ?', [`LT-${i}`])
  }
  await batchDelete('wallet_txn', "DELETE FROM bg_568win_wallet_txn WHERE transfer_code LIKE 'LTH-%'")
  await batchDelete('ledger', "DELETE FROM bg_wallet_ledger WHERE id LIKE 'lth-%'")
  await batchDelete('deposit', "DELETE FROM bg_deposit_order WHERE order_id LIKE 'LTH-%'")
  await batchDelete('withdraw', "DELETE FROM bg_withdraw_order WHERE order_id LIKE 'LTH-%'")
  await batchDelete('commission', "DELETE FROM bg_team_commission WHERE from_user_id LIKE 'LTD-%'")
  await batchDelete('team_turnover', "DELETE FROM bg_team_turnover_daily WHERE user_id LIKE 'LTD-%'")
  await batchDelete('team_node(downline)', "DELETE FROM bg_team_node WHERE user_id LIKE 'LTD-%'")
  await batchDelete('team_node(agent)', "DELETE FROM bg_team_node WHERE user_id LIKE 'LT-%'")
  await batchDelete('team_wallet', "DELETE FROM bg_team_wallet WHERE user_id LIKE 'LT-%'")
  await batchDelete('ledger(LTD)', "DELETE FROM bg_wallet_ledger WHERE user_id LIKE 'LTD-%'")
  await batchDelete('wallet(LTD)', "DELETE FROM bg_wallet WHERE user_id LIKE 'LTD-%'")
  await batchDelete('user(LTD)', "DELETE FROM bg_user WHERE id LIKE 'LTD-%'")
  // 迁移151：seed 回填过 bg_user_vip_state.turnover_total，清理时一并删（LT 用户行由 cleanup.mjs 删）
  await batchDelete('vip_state(LT)', "DELETE FROM bg_user_vip_state WHERE user_id LIKE 'LT-%'")
  await batchDelete('wallet(LT)', "DELETE FROM bg_wallet WHERE user_id LIKE 'LT-%'")
  log('== cleanup 完成 ==')
  await conn.end(); process.exit(0)
}

// ─────────────────────────── seed ───────────────────────────
const t0 = Date.now()
log(`== seed 开始: HEAVY=${HEAVY}×${ROUNDS}局, AGENTS=${AGENTS}, POOL=${POOL} ==`)

// 0) 全池钱包（写压测/余额读都要）
{
  const rows = []
  for (let i = 1; i <= POOL; i++) rows.push([`LT-${i}`, 'PHP', 1_000_000])
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    await conn.query(
      `INSERT INTO bg_wallet (user_id,currency,available) VALUES ${chunk.map(() => '(?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE available = VALUES(available)`, chunk.flat())
  }
  log(`wallet 就绪 ×${POOL}`)
}

// 1) 重历史组：注单 + 局汇总 + ledger + turnover + 存提单
const CATS = ['slots', 'slots', 'slots', 'live', 'fishing', 'table']
for (let u = 1; u <= HEAVY; u++) {
  const uid = `LT-${u}`
  const [[{ n: existing }]] = await conn.query('SELECT COUNT(*) AS n FROM bg_bet_round WHERE user_id = ?', [uid])
  if (Number(existing) >= ROUNDS) { log(`${uid} 已有 ${existing} 局，跳过`); continue }
  // 增量补灌（P5 数据量敏感性用）：从已有局数+1 续灌到 ROUNDS，避开旧局的 PK/UK
  const startN = Number(existing) + 1

  const orders = [], txns = [], ledgers = []
  let bal = 1_000_000
  for (let n = startN; n <= ROUNDS; n++) {
    const rid = `LTH-${u}-${n}`
    const ts = spreadTs(n, ROUNDS)
    const amt = Math.round((5 + rnd() * 495) * 100) / 100
    const win = Math.round(amt * rnd() * 2 * 100) / 100
    // bet + win 两行注单（照 win568-wallet.service 真实写法）
    orders.push([uid, '568win', '101', rid, rid, 'bet', amt, 'PHP', amt, 1, 'settled', ts, ts])
    orders.push([uid, '568win', '101', `settle:${rid}`, rid, 'win', win, 'PHP', win, 1, 'settled', ts, ts])
    txns.push([uid, uid, 'PHP', rid, rid, 1, 1, 1, '101', rid, 'bet', amt, win - amt, 'settled', '{}', ts, ts])
    bal = Math.round((bal - amt + win) * 100) / 100
    ledgers.push([`lth-${u}-${n}-b`, uid, 'PHP', 'bet', -amt, bal, 'game', rid, 'LTH seed', ts])
    ledgers.push([`lth-${u}-${n}-w`, uid, 'PHP', 'win', win, bal, 'game', rid, 'LTH seed', ts])
  }
  await batchInsert('bg_bet_order',
    ['user_id', 'aggregator_id', 'provider_id', 'provider_txn_id', 'round_id', 'bet_type', 'amount', 'currency_code', 'original_amount', 'exchange_rate', 'status', 'created_at', 'settled_at'], orders)
  await batchInsert('bg_568win_wallet_txn',
    ['user_id', 'external_username', 'currency', 'transfer_code', 'transaction_id', 'product_type', 'game_type', 'gpid', 'provider_id', 'round_id', 'txn_type', 'amount', 'win_loss', 'status', 'raw_request', 'created_at', 'settled_at'], txns)
  await batchInsert('bg_wallet_ledger',
    ['id', 'user_id', 'currency', 'type', 'amount', 'balance_after', 'ref_type', 'ref_id', 'description', 'created_at'], ledgers)

  // 局汇总：从 bet_order 聚合派生（与 core refreshBetRound 同口径）
  await conn.query(
    `INSERT IGNORE INTO bg_bet_round (user_id, round_id, aggregator_id, provider_txn_id, bet_amount, win_amount, currency_code, first_at, last_id)
     SELECT user_id, round_id, '568win',
            MIN(CASE WHEN bet_type='bet' THEN provider_txn_id END),
            SUM(CASE WHEN bet_type='bet' THEN amount ELSE 0 END),
            SUM(CASE WHEN bet_type IN ('win','refund') THEN amount ELSE 0 END),
            'PHP', MIN(created_at), MAX(id)
     FROM bg_bet_order WHERE user_id = ? AND bet_type IN ('bet','win','refund') GROUP BY user_id, round_id`, [uid])

  // turnover：每笔 bet 一条（rebate/vip 聚合的数据源），bet_order_id 从库里取保证 FK/UK 对齐
  await conn.query(
    `INSERT IGNORE INTO bg_turnover_logs (user_id, currency, bet_order_id, bet_amount, rate, effective_amount, sort_category, created_at)
     SELECT user_id, 'PHP', id, amount, 1, amount,
            ELT(1 + (id MOD ${CATS.length}), ${CATS.map(c => `'${c}'`).join(',')}), created_at
     FROM bg_bet_order WHERE user_id = ? AND bet_type = 'bet'`, [uid])

  // 总流水累计（迁移151）：线上 getUserTotalTurnover 已改读 bg_user_vip_state.turnover_total 单行，
  // 不再 SUM bg_turnover_logs。seed 必须同步回填此列，否则灌完的用户 rebate/vip 等级全读 0→LV1（测空路径）。
  // 从 turnover_logs 重算，幂等（增量补灌后也得到正确的全量总额）。
  await conn.query(
    `INSERT INTO bg_user_vip_state (user_id, currency, turnover_total)
     SELECT user_id, currency, SUM(effective_amount) FROM bg_turnover_logs
     WHERE user_id = ? AND is_reversed = 0 GROUP BY user_id, currency
     ON DUPLICATE KEY UPDATE turnover_total = VALUES(turnover_total)`, [uid])

  // 存提单历史
  const deps = [], wds = []
  for (let n = 1; n <= 100; n++) {
    deps.push([`LTH-DEP-${u}-${n}`, uid, 'loadtest', 'PHP', Math.round((100 + rnd() * 4900) * 100) / 100, 'paid', 1, spreadTs(n, 100)])
  }
  for (let n = 1; n <= 30; n++) {
    wds.push([`LTH-WD-${u}-${n}`, uid, 'loadtest', 'PHP', Math.round((100 + rnd() * 1900) * 100) / 100, 'completed', spreadTs(n, 30)])
  }
  await batchInsert('bg_deposit_order', ['order_id', 'user_id', 'channel', 'currency', 'amount', 'status', 'credited', 'created_at'], deps, true)
  await batchInsert('bg_withdraw_order', ['order_id', 'user_id', 'channel', 'currency', 'amount', 'status', 'created_at'], wds, true)

  log(`重历史 ${uid} 完成 (${u}/${HEAVY})`)
  await sleep(100)
}

// 2) 团队组：LT-(HEAVY+1)..(HEAVY+AGENTS)，每人 L1=50 / L2=20 / L3=10
const period = mysqlTs(NOW).slice(0, 7)
const prevPeriod = mysqlTs(NOW - 32 * 86400_000).slice(0, 7)
for (let a = 1; a <= AGENTS; a++) {
  const agent = `LT-${HEAVY + a}`
  const users = [], nodes = [], tds = [], comms = []
  const mk = (tag, n) => `LTD-${HEAVY + a}-${tag}${n}`
  const invite = (tag, n) => `D${String(HEAVY + a).padStart(2, '0')}${tag}${String(n).padStart(3, '0')}`
  const regTs = () => spreadTs(Math.ceil(rnd() * 100), 100)

  const l1s = [], l2s = []
  for (let n = 1; n <= 50; n++) { // L1：agent 直推
    const id = mk('A', n); l1s.push(id)
    users.push([id, `Downline A${n}`, invite('A', n), agent, 'en', 'active', regTs()])
    nodes.push([id, agent, null, null, 1, rnd() > 0.4 ? 1 : 0])
  }
  for (let n = 1; n <= 20; n++) { // L2：挂在前 5 个 L1 下
    const id = mk('B', n), p = l1s[n % 5]; l2s.push(id)
    users.push([id, `Downline B${n}`, invite('B', n), p, 'en', 'active', regTs()])
    nodes.push([id, p, agent, null, 1, rnd() > 0.5 ? 1 : 0])
  }
  for (let n = 1; n <= 10; n++) { // L3：挂在前 5 个 L2 下（gp=该 L2 的真实父节点，保持链一致）
    const id = mk('C', n), p = l2s[n % 5], gp = l1s[((n % 5) + 1) % 5]
    users.push([id, `Downline C${n}`, invite('C', n), p, 'en', 'active', regTs()])
    nodes.push([id, p, gp, agent, 1, rnd() > 0.6 ? 1 : 0])
  }
  await batchInsert('bg_user', ['id', 'display_name', 'invite_code', 'inviter_id', 'locale', 'status', 'registered_at'], users, true)
  await batchInsert('bg_team_node', ['user_id', 'l1_referrer_id', 'l2_referrer_id', 'l3_referrer_id', 'opted_in', 'activated'], nodes, true)

  // 当月每下线 10 天流水 + 当月/上月各一条佣金（level 按其相对 agent 的层级）
  const all = [[l1s, 1, 0.6], [l2s, 2, 0.3], [[...Array(10)].map((_, i) => mk('C', i + 1)), 3, 0.2]]
  for (const [ids, level, rate] of all) {
    for (const id of ids) {
      for (let d = 1; d <= 10; d++) {
        tds.push([id, `${period}-${String(d * 2 + 1).padStart(2, '0')}`, 'PHP', Math.round(10_000 + rnd() * 490_000)])
      }
      for (const p of [period, prevPeriod]) {
        const turn = Math.round(50_000 + rnd() * 950_000)
        const ggr = Math.round(turn * 0.1)
        comms.push([agent, id, level, p, 'PHP', ggr, rate, Math.round(turn * rate / 100), p === prevPeriod ? 'paid' : 'pending', 1, Math.round(turn * rate / 100), turn])
      }
    }
  }
  await batchInsert('bg_team_turnover_daily', ['user_id', 'date', 'currency_code', 'bet_cents'], tds, true)
  await batchInsert('bg_team_commission',
    ['beneficiary_id', 'from_user_id', 'level', 'period', 'currency', 'ggr_cents', 'rate_pct', 'commission_cents', 'status', 'fx_rate', 'php_equivalent_cents', 'turnover_cents'], comms, true)
  // agent 自身节点 + 佣金钱包
  await conn.query(
    `INSERT INTO bg_team_node (user_id, opted_in, activated, opted_in_at) VALUES (?,1,1,NOW(3))
     ON DUPLICATE KEY UPDATE opted_in=1, activated=1`, [agent])
  await conn.query(
    `INSERT IGNORE INTO bg_team_wallet (user_id, currency, available_cents, lifetime_earned_cents) VALUES (?, 'PHP', 500000, 1200000)`, [agent])
  log(`团队 ${agent} 完成 (${a}/${AGENTS})`)
  await sleep(100)
}

// 汇总自检
const [[chk]] = await conn.query(`SELECT
  (SELECT COUNT(*) FROM bg_bet_round  WHERE user_id LIKE 'LT-%') AS rounds,
  (SELECT COUNT(*) FROM bg_bet_order  WHERE user_id LIKE 'LT-%') AS orders,
  (SELECT COUNT(*) FROM bg_turnover_logs WHERE user_id LIKE 'LT-%') AS turnovers,
  (SELECT COUNT(*) FROM bg_wallet_ledger WHERE id LIKE 'lth-%') AS ledgers,
  (SELECT COUNT(*) FROM bg_deposit_order WHERE order_id LIKE 'LTH-%') AS deps,
  (SELECT COUNT(*) FROM bg_team_node WHERE user_id LIKE 'LTD-%') AS downlines,
  (SELECT COUNT(*) FROM bg_team_commission WHERE from_user_id LIKE 'LTD-%') AS comms`)
console.log(JSON.stringify({ ...chk, seconds: Math.round((Date.now() - t0) / 1000) }))
await conn.end(); process.exit(0)
