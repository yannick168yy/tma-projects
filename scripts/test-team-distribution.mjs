/**
 * 三级分销测试脚本 v2 — 多币种 GGR 明细验证
 *
 * 用户树（固定结构）：
 *   BG-10001 (root/代理)
 *   ├── L1_1  PHP: bet=500, win=100  → GGR ₱400
 *   │   ├── L2_1  PHP+USDT 混合      → GGR ₱200 + 8USDT
 *   │   │   ├── L3_1  PHP+USDC       → GGR ₱150 + 4USDC
 *   │   │   └── L3_2  PHP only       → GGR ₱300
 *   │   └── L2_2  USDT only          → GGR 12USDT
 *   │       ├── L3_3  PHP+USDT+USDC  → GGR ₱100 + 5USDT + 3USDC
 *   │       └── L3_4  PHP only       → GGR ₱400
 *   └── L1_2  PHP only               → GGR ₱600
 *       ├── L2_3  PHP only           → GGR ₱350
 *       │   ├── L3_5  PHP only       → GGR ₱280
 *       │   └── L3_6  USDC only      → GGR 6USDC
 *       └── L2_4  PHP only (未激活)  → GGR ₱500（不贡献佣金，验证激活门槛）
 *
 * 运行方式（在 tma-bff-node 容器内）：
 *   node scripts/test-team-distribution.mjs
 */

import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'

// ── 配置 ──────────────────────────────────────────────────────────────────────
const DB = {
  host:     process.env.MYSQL_HOST     ?? 'tma-mysql',
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER     ?? 'tma',
  password: process.env.MYSQL_PASSWORD ?? 'tma_dev',
  database: process.env.MYSQL_DATABASE ?? 'betogo',
}
const CORE_URL  = process.env.CORE_NODE_URL  ?? 'http://tma-core-node:4000'
const INT_TOKEN = process.env.INTERNAL_TOKEN ?? ''

const TEST_PERIOD = process.env.TEST_PERIOD ?? (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

// ── 工具 ──────────────────────────────────────────────────────────────────────
function log(msg, data) {
  console.log(`\n[${new Date().toISOString()}] ${msg}`)
  if (data !== undefined) console.log(JSON.stringify(data, null, 2))
}

function ok(label, passed, detail) {
  const mark = passed ? '✓' : '✗'
  console.log(`  ${mark} ${label}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`)
  if (!passed) process.exitCode = 1
}

function genInviteCode() {
  return randomBytes(3).toString('hex').toUpperCase()
}

async function nextUserId(db) {
  const [[row]] = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 10000) + 1 AS n FROM bg_user`
  )
  return `BG-${row.n}`
}

async function createUser(db, { displayName, inviterId }) {
  const id = await nextUserId(db)
  let inviteCode = genInviteCode()
  const [[dup]] = await db.query(`SELECT id FROM bg_user WHERE invite_code = ? LIMIT 1`, [inviteCode])
  if (dup) inviteCode = genInviteCode()

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `INSERT INTO bg_user
         (id, display_name, invite_code, inviter_id, locale, status, label, registered_at)
       VALUES (?, ?, ?, ?, 'en', 'active', 'test', NOW(3))`,
      [id, displayName, inviteCode, inviterId ?? null]
    )
    await conn.execute(`INSERT IGNORE INTO bg_user_profile (user_id) VALUES (?)`, [id])
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, frozen)
       VALUES (?, 'PHP', 0, 0) ON DUPLICATE KEY UPDATE user_id=user_id`,
      [id]
    )
    // 写入三级归属树
    await conn.execute(
      `INSERT IGNORE INTO bg_team_node (user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id)
       SELECT ?, u.inviter_id, l1.inviter_id, l2.inviter_id
       FROM bg_user u
       LEFT JOIN bg_user l1 ON l1.id = u.inviter_id
       LEFT JOIN bg_user l2 ON l2.id = l1.inviter_id
       WHERE u.id = ?`,
      [id, id]
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { id, displayName, inviteCode, inviterId }
}

// activate=false → 仅开启代理但不激活（模拟激活门槛未达标）
async function enableAndActivate(db, userId, activate = true) {
  if (activate) {
    await db.execute(
      `UPDATE bg_team_node SET opted_in=1, opted_in_at=NOW(3),
         activated=1, activation_cents=10000, activated_at=NOW(3)
       WHERE user_id = ?`,
      [userId]
    )
  } else {
    await db.execute(
      `UPDATE bg_team_node SET opted_in=1, opted_in_at=NOW(3)
       WHERE user_id = ?`,
      [userId]
    )
  }
  // 注意：bg_team_wallet PK 是 (user_id, currency)，必须带 currency
  await db.execute(
    `INSERT IGNORE INTO bg_team_wallet (user_id, currency) VALUES (?, 'PHP')`,
    [userId]
  )
}

// 插入一对注单，currency 默认 'PHP'
// amount 单位：原币种（PHP 元、USDT 个 等），结算引擎会乘以 100 得到 cents
async function insertBetOrders(db, userId, betAmount, winAmount, currency = 'PHP') {
  const ts   = Date.now()
  const rand = randomBytes(3).toString('hex')
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id, currency_code,
        bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, ?, 'bet', ?, 'settled', NOW(3))`,
    [userId, `T${ts}${rand}_BET_${currency}`, currency, betAmount]
  )
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id, currency_code,
        bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, ?, 'win', ?, 'settled', NOW(3))`,
    [userId, `T${ts}${rand}_WIN_${currency}`, currency, winAmount]
  )
  return { currency, ggrCents: Math.round((betAmount - winAmount) * 100) }
}

async function cleanupPreviousRun(db) {
  log('清理上一轮测试数据（label=test 的用户）')
  const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM bg_user WHERE label='test'`)
  if (Number(cnt) === 0) { log('  无历史测试数据，跳过'); return }

  await db.execute('SET FOREIGN_KEY_CHECKS=0')
  try {
    await db.execute(`DELETE FROM bg_team_commission   WHERE from_user_id IN (SELECT id FROM bg_user WHERE label='test') OR beneficiary_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_ggr_monthly  WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_wallet       WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    // 重置 root(BG-10001) 团队钱包，避免多次运行累加
    await db.execute(`UPDATE bg_team_wallet SET available_cents=0, frozen_cents=0, lifetime_earned_cents=0, version=version+1 WHERE user_id='BG-10001' AND currency='PHP'`)
    await db.execute(`DELETE FROM bg_team_withdrawal   WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_node         WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_bet_order         WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_wallet_ledger     WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_wallet            WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_user_profile      WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_user              WHERE label='test'`)
  } finally {
    await db.execute('SET FOREIGN_KEY_CHECKS=1')
  }
  log(`  已清理 ${cnt} 个测试用户`)
}

async function triggerSettle(period) {
  const res = await fetch(`${CORE_URL}/internal/team/settle`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INT_TOKEN },
    body:    JSON.stringify({ period }),
  }).catch(e => { throw new Error(`core-node 不可达: ${e.message}`) })

  if (!res.ok) throw new Error(`结算接口返回 ${res.status}`)
  log('  结算请求已发送，等待 5s...')
  await new Promise(r => setTimeout(r, 5000))
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  log('连接数据库', DB)
  const db = await mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 5 })

  try {
    // ── 0. 清理 ──────────────────────────────────────────────────────────────
    await cleanupPreviousRun(db)

    // ── 1. 获取 root ──────────────────────────────────────────────────────────
    log('步骤 1：初始化 root(BG-10001)')
    const [[rootRow]] = await db.query(
      `SELECT id, display_name, invite_code FROM bg_user WHERE id='BG-10001' LIMIT 1`
    )
    if (!rootRow) throw new Error('BG-10001 不存在，请先创建该用户')
    const root = { id: rootRow.id, displayName: rootRow.display_name }

    await db.execute(`INSERT IGNORE INTO bg_team_node (user_id) VALUES (?)`, [root.id])
    await enableAndActivate(db, root.id)
    log(`  root = ${root.id} (${root.displayName})`)

    // ── 2. 创建固定用户树 ─────────────────────────────────────────────────────
    log('步骤 2：创建用户树')

    // L1
    const l1_1 = await createUser(db, { displayName: 'TEST_L1_1', inviterId: root.id })
    const l1_2 = await createUser(db, { displayName: 'TEST_L1_2', inviterId: root.id })

    // L2（挂在 L1_1 下）
    const l2_1 = await createUser(db, { displayName: 'TEST_L2_1', inviterId: l1_1.id })
    const l2_2 = await createUser(db, { displayName: 'TEST_L2_2', inviterId: l1_1.id })
    // L2（挂在 L1_2 下）
    const l2_3 = await createUser(db, { displayName: 'TEST_L2_3', inviterId: l1_2.id })
    const l2_4 = await createUser(db, { displayName: 'TEST_L2_4(未激活)', inviterId: l1_2.id })

    // L3（挂在 L2_1 下）
    const l3_1 = await createUser(db, { displayName: 'TEST_L3_1', inviterId: l2_1.id })
    const l3_2 = await createUser(db, { displayName: 'TEST_L3_2', inviterId: l2_1.id })
    // L3（挂在 L2_2 下）
    const l3_3 = await createUser(db, { displayName: 'TEST_L3_3', inviterId: l2_2.id })
    const l3_4 = await createUser(db, { displayName: 'TEST_L3_4', inviterId: l2_2.id })
    // L3（挂在 L2_3 下）
    const l3_5 = await createUser(db, { displayName: 'TEST_L3_5', inviterId: l2_3.id })
    const l3_6 = await createUser(db, { displayName: 'TEST_L3_6', inviterId: l2_3.id })

    const allUsers = [l1_1, l1_2, l2_1, l2_2, l2_3, l2_4, l3_1, l3_2, l3_3, l3_4, l3_5, l3_6]
    log(`  已创建 ${allUsers.length} 个测试用户`)

    // ── 3. 开启代理 & 激活（l2_4 不激活，验证激活门槛）────────────────────────
    log('步骤 3：开启代理 & 激活')
    for (const u of [l1_1, l1_2, l2_1, l2_2, l2_3, l3_1, l3_2, l3_3, l3_4, l3_5, l3_6]) {
      await enableAndActivate(db, u.id, true)
    }
    await enableAndActivate(db, l2_4.id, false)  // 仅开启不激活
    log(`  已激活 11 人，l2_4(${l2_4.id}) 仅开启未激活`)

    // ── 4. 插入多币种注单 ─────────────────────────────────────────────────────
    log('步骤 4：插入注单（多币种）')

    // L1
    await insertBetOrders(db, l1_1.id, 500, 100, 'PHP')    // GGR ₱400
    await insertBetOrders(db, l1_2.id, 800, 200, 'PHP')    // GGR ₱600

    // L2 — 混合币种
    await insertBetOrders(db, l2_1.id, 200, 0,   'PHP')    // GGR ₱200
    await insertBetOrders(db, l2_1.id, 10,  2,   'USDT')   // GGR 8USDT
    await insertBetOrders(db, l2_2.id, 20,  8,   'USDT')   // GGR 12USDT  (纯USDT)
    await insertBetOrders(db, l2_3.id, 350, 0,   'PHP')    // GGR ₱350
    await insertBetOrders(db, l2_4.id, 500, 0,   'PHP')    // GGR ₱500（未激活，不应产生上线佣金）

    // L3 — 多种组合
    await insertBetOrders(db, l3_1.id, 150, 0,   'PHP')    // GGR ₱150
    await insertBetOrders(db, l3_1.id, 5,   1,   'USDC')   // GGR 4USDC
    await insertBetOrders(db, l3_2.id, 300, 0,   'PHP')    // GGR ₱300
    await insertBetOrders(db, l3_3.id, 100, 0,   'PHP')    // GGR ₱100
    await insertBetOrders(db, l3_3.id, 6,   1,   'USDT')   // GGR 5USDT
    await insertBetOrders(db, l3_3.id, 4,   1,   'USDC')   // GGR 3USDC   (三币种)
    await insertBetOrders(db, l3_4.id, 400, 0,   'PHP')    // GGR ₱400
    await insertBetOrders(db, l3_5.id, 280, 0,   'PHP')    // GGR ₱280
    await insertBetOrders(db, l3_6.id, 7,   1,   'USDC')   // GGR 6USDC   (纯USDC)

    const [[{ betCnt }]] = await db.query(`SELECT COUNT(*) AS betCnt FROM bg_bet_order WHERE user_id IN (${allUsers.map(()=>'?').join(',')})`, allUsers.map(u => u.id))
    log(`  已插入 ${betCnt} 条注单`)

    // ── 5. 验证归属关系 ───────────────────────────────────────────────────────
    log('步骤 5：验证 bg_team_node 归属关系')

    async function checkNode(u, expect) {
      const [[n]] = await db.query(`SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id=?`, [u.id])
      ok(`${u.displayName}(${u.id}) l1=${expect.l1 ?? 'null'}`, n?.l1_referrer_id === (expect.l1 ?? null))
      ok(`${u.displayName}(${u.id}) l2=${expect.l2 ?? 'null'}`, n?.l2_referrer_id === (expect.l2 ?? null))
      ok(`${u.displayName}(${u.id}) l3=${expect.l3 ?? 'null'}`, n?.l3_referrer_id === (expect.l3 ?? null))
    }

    await checkNode(l1_1, { l1: root.id })
    await checkNode(l1_2, { l1: root.id })
    await checkNode(l2_1, { l1: l1_1.id, l2: root.id })
    await checkNode(l2_2, { l1: l1_1.id, l2: root.id })
    await checkNode(l2_3, { l1: l1_2.id, l2: root.id })
    await checkNode(l2_4, { l1: l1_2.id, l2: root.id })
    await checkNode(l3_1, { l1: l2_1.id, l2: l1_1.id, l3: root.id })
    await checkNode(l3_2, { l1: l2_1.id, l2: l1_1.id, l3: root.id })
    await checkNode(l3_3, { l1: l2_2.id, l2: l1_1.id, l3: root.id })
    await checkNode(l3_4, { l1: l2_2.id, l2: l1_1.id, l3: root.id })
    await checkNode(l3_5, { l1: l2_3.id, l2: l1_2.id, l3: root.id })
    await checkNode(l3_6, { l1: l2_3.id, l2: l1_2.id, l3: root.id })

    // ── 6. 触发结算 ───────────────────────────────────────────────────────────
    log(`步骤 6：触发 ${TEST_PERIOD} 月结算`)
    await triggerSettle(TEST_PERIOD)

    // ── 7. 验证佣金 ───────────────────────────────────────────────────────────
    log('步骤 7：验证佣金结果')

    const allIds = allUsers.map(u => u.id)
    const [commissions] = await db.query(
      `SELECT beneficiary_id, from_user_id, level, currency,
              ggr_cents, rate_pct, commission_cents, php_equivalent_cents, status
       FROM bg_team_commission
       WHERE period=? AND from_user_id IN (${allIds.map(()=>'?').join(',')})
       ORDER BY from_user_id, currency, level`,
      [TEST_PERIOD, ...allIds]
    )

    const [[{ cfgL1, cfgL2, cfgL3 }]] = await db.query(
      `SELECT l1_rate_pct AS cfgL1, l2_rate_pct AS cfgL2, l3_rate_pct AS cfgL3 FROM bg_team_config WHERE id=1`
    )
    log('  当前佣金费率', { L1: `${cfgL1}%`, L2: `${cfgL2}%`, L3: `${cfgL3}%` })

    // L2_4 未激活 → 不应产生任何佣金
    const fromL2_4 = commissions.filter(c => c.from_user_id === l2_4.id)
    ok(`l2_4(未激活) 不产生佣金`, fromL2_4.length === 0, fromL2_4.length)

    // l1_1: PHP only → root 收 level=1 佣金，1条
    const fromL1_1 = commissions.filter(c => c.from_user_id === l1_1.id)
    ok(`l1_1 产生 1 条佣金(PHP)`, fromL1_1.length === 1, fromL1_1.length)
    ok(`l1_1 受益人=root level=1`, fromL1_1[0]?.beneficiary_id === root.id && fromL1_1[0]?.level === 1)

    // l1_2: PHP only → root 收 level=1，1条
    const fromL1_2 = commissions.filter(c => c.from_user_id === l1_2.id)
    ok(`l1_2 产生 1 条佣金(PHP)`, fromL1_2.length === 1, fromL1_2.length)

    // l2_1: PHP+USDT → root(level=2)各1条 + l1_1(level=1)各1条 = 4条
    const fromL2_1 = commissions.filter(c => c.from_user_id === l2_1.id)
    ok(`l2_1(PHP+USDT) 产生 4 条佣金`, fromL2_1.length === 4, fromL2_1.length)
    const l2_1_rootPHP  = fromL2_1.find(c => c.beneficiary_id === root.id   && c.currency === 'PHP')
    const l2_1_rootUSDT = fromL2_1.find(c => c.beneficiary_id === root.id   && c.currency === 'USDT')
    ok(`l2_1 root 收到 PHP 佣金(level=2)`,  l2_1_rootPHP?.level  === 2)
    ok(`l2_1 root 收到 USDT 佣金(level=2)`, l2_1_rootUSDT?.level === 2)

    // l2_2: USDT only → root(level=2)1条 + l1_1(level=1)1条 = 2条
    const fromL2_2 = commissions.filter(c => c.from_user_id === l2_2.id)
    ok(`l2_2(USDT only) 产生 2 条佣金`, fromL2_2.length === 2, fromL2_2.length)
    ok(`l2_2 货币均为 USDT`, fromL2_2.every(c => c.currency === 'USDT'))

    // l3_1: PHP+USDC → l2_1(L1)+l1_1(L2)+root(L3) × 2币种 = 6条
    const fromL3_1 = commissions.filter(c => c.from_user_id === l3_1.id)
    ok(`l3_1(PHP+USDC) 产生 6 条佣金`, fromL3_1.length === 6, fromL3_1.length)
    const l3_1_rootUSDC = fromL3_1.find(c => c.beneficiary_id === root.id && c.currency === 'USDC' && c.level === 3)
    ok(`l3_1 root 收到 USDC 佣金(level=3)`, !!l3_1_rootUSDC)

    // l3_3: PHP+USDT+USDC (三币种) → 3层上线 × 3币种 = 9条
    const fromL3_3 = commissions.filter(c => c.from_user_id === l3_3.id)
    ok(`l3_3(PHP+USDT+USDC) 产生 9 条佣金`, fromL3_3.length === 9, fromL3_3.length)
    const l3_3_rootPHPL3  = fromL3_3.find(c => c.beneficiary_id === root.id && c.currency === 'PHP'  && c.level === 3)
    const l3_3_rootUSDTL3 = fromL3_3.find(c => c.beneficiary_id === root.id && c.currency === 'USDT' && c.level === 3)
    const l3_3_rootUSDCL3 = fromL3_3.find(c => c.beneficiary_id === root.id && c.currency === 'USDC' && c.level === 3)
    ok(`l3_3 root 收到 PHP 佣金(level=3)`,  !!l3_3_rootPHPL3)
    ok(`l3_3 root 收到 USDT 佣金(level=3)`, !!l3_3_rootUSDTL3)
    ok(`l3_3 root 收到 USDC 佣金(level=3)`, !!l3_3_rootUSDCL3)

    // php_equivalent_cents 应非零（汇率服务正常时）
    const nonPhpComms = commissions.filter(c => c.currency !== 'PHP')
    const phpEquivSet = nonPhpComms.filter(c => Number(c.php_equivalent_cents) !== 0)
    ok(`非PHP佣金的 php_equivalent_cents 已填充(${phpEquivSet.length}/${nonPhpComms.length})`,
       phpEquivSet.length === nonPhpComms.length, `${phpEquivSet.length}/${nonPhpComms.length}`)

    // ── 8. 汇总打印 ───────────────────────────────────────────────────────────
    log('── root(BG-10001) 收到的所有佣金 ──────────────────────')
    const rootComms = commissions.filter(c => c.beneficiary_id === root.id)
    console.table(
      rootComms.map(c => ({
        来源:     c.from_user_id,
        层级:     `L${c.level}`,
        货币:     c.currency,
        GGR分:    c.ggr_cents,
        PHP等价:  c.php_equivalent_cents,
        费率:     `${c.rate_pct}%`,
        佣金分:   c.commission_cents,
        状态:     c.status,
      }))
    )

    const rootTotalPhp = rootComms.reduce((s, c) => s + Number(c.php_equivalent_cents), 0)
    log(`root 本次共获佣金（PHP合计）`, {
      条数: rootComms.length,
      PHP合计分: rootTotalPhp,
      PHP合计: `₱${(rootTotalPhp/100).toFixed(2)}`,
    })

    // 打印预期在前端展示的 ggrBreakdown 格式
    log('── 前端 ggrBreakdown 预期展示格式（按 from_user 分组）──')
    const fromUserGroups = {}
    for (const c of rootComms) {
      const key = `${c.from_user_id}(L${c.level})`
      if (!fromUserGroups[key]) fromUserGroups[key] = []
      fromUserGroups[key].push(`${c.currency}:${c.ggr_cents}分`)
    }
    for (const [key, items] of Object.entries(fromUserGroups)) {
      console.log(`  ${key} → GGR currencies: [${items.join(', ')}]`)
    }

    // 检查 bg_team_wallet root 余额
    const [[wallet]] = await db.query(
      `SELECT available_cents, lifetime_earned_cents FROM bg_team_wallet WHERE user_id=? AND currency='PHP'`,
      [root.id]
    )
    log('root 团队钱包（PHP）', {
      available:        wallet ? `₱${(Number(wallet.available_cents)/100).toFixed(2)}`        : 'N/A',
      lifetimeEarned:   wallet ? `₱${(Number(wallet.lifetime_earned_cents)/100).toFixed(2)}`  : 'N/A',
    })

    log(process.exitCode ? '⚠ 完成（有失败项，见上方 ✗）' : '✓ 全部验证通过')

  } finally {
    await db.end()
  }
}

main().catch(e => {
  console.error('脚本异常:', e.message, e.stack)
  process.exit(1)
})
