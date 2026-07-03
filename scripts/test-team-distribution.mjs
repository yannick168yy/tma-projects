/**
 * 三级分销测试脚本 v4 — 全员多币种投注 + 流水制结算验证
 *
 * 系统模型：流水制（turnover-based）
 *   - 只统计 bet_type='bet' 投注额，不减 win
 *   - 多币种通过汇率折算 PHP，出单条 PHP 佣金
 *   - currency_breakdown JSON 保留原始多币种明细
 *
 * 用户树（全员 PHP+USDT+USDC 三币种投注）：
 *   BG-10001 (root/代理)
 *   ├── L1_1  PHP+USDT+USDC  bet=(500,10,5)  win=(100,2,1)
 *   │   ├── L2_1  PHP+USDT+USDC  bet=(200,1,3)   win=(0,10,0)   → PHP正+USDT负(流水仍正)
 *   │   │   ├── L3_1  PHP+USDT+USDC  bet=(150,4,5)  win=(0,1,1)
 *   │   │   └── L3_2  PHP+USDT+USDC  bet=(100,3,2)  win=(400,0,0) → PHP派彩高于投注，流水正
 *   │   └── L2_2  PHP+USDT+USDC  bet=(50,20,8)  win=(0,8,0)
 *   │       ├── L3_3  PHP+USDT+USDC  bet=(100,6,4)  win=(0,1,1)
 *   │       └── L3_4  PHP+USDT+USDC  bet=(100,5,3)  win=(300,0,0) → PHP派彩高于投注，流水正
 *   └── L1_2  PHP+USDT+USDC  bet=(200,5,3)  win=(400,0,0) → PHP派彩高于投注，流水正
 *       ├── L2_3  PHP+USDT+USDC  bet=(350,8,4)  win=(0,0,0)
 *       │   ├── L3_5  PHP+USDT+USDC  bet=(280,6,4)  win=(0,0,0)
 *       │   └── L3_6  PHP+USDT+USDC  bet=(50,5,7)   win=(0,1,1)
 *       └── L2_4  PHP+USDT+USDC  bet=(500,10,5) win=(0,0,0)  (未激活，不产生佣金)
 *
 * 验证点：
 *   - 结算只按投注流水计算佣金，不按派彩回撤
 *   - 多币种通过汇率折算 PHP，出单条 PHP 佣金
 *   - 未激活用户不产生上线佣金
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
  user:     process.env.MYSQL_USER     ?? 'betogo',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE ?? 'betogo',
}
const CORE_URL  = process.env.CORE_NODE_URL  ?? 'http://tma-core-node:4000'
const INT_TOKEN = process.env.INTERNAL_TOKEN ?? ''

const TEST_PERIOD = process.env.TEST_PERIOD ?? (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    await db.execute(`DELETE FROM bg_team_turnover_daily WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_ggr_monthly  WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_wallet       WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    // 重置 root(BG-10001) 团队钱包，避免多次运行累加
    await db.execute(`UPDATE bg_team_wallet SET available_cents=0, frozen_cents=0, lifetime_earned_cents=0, version=version+1 WHERE user_id='BG-10001' AND currency='PHP'`)
    await db.execute(`DELETE FROM bg_team_withdrawal   WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_team_node         WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_bet_order         WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_wallet_ledger     WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
    await db.execute(`DELETE FROM bg_wallet            WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`)
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
    body:    JSON.stringify({ date: period }),
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

    // L1 — 全员三币种
    await insertBetOrders(db, l1_1.id, 500, 100, 'PHP')
    await insertBetOrders(db, l1_1.id, 10,  2,   'USDT')
    await insertBetOrders(db, l1_1.id, 5,   1,   'USDC')
    await insertBetOrders(db, l1_2.id, 200, 400, 'PHP')    // PHP派彩高于投注，流水仍产生正佣金
    await insertBetOrders(db, l1_2.id, 5,   0,   'USDT')
    await insertBetOrders(db, l1_2.id, 3,   0,   'USDC')

    // L2 — 全员三币种
    await insertBetOrders(db, l2_1.id, 200, 0,   'PHP')
    await insertBetOrders(db, l2_1.id, 1,   10,  'USDT')   // USDT派彩高于投注，流水仍为正
    await insertBetOrders(db, l2_1.id, 3,   0,   'USDC')
    await insertBetOrders(db, l2_2.id, 50,  0,   'PHP')
    await insertBetOrders(db, l2_2.id, 20,  8,   'USDT')
    await insertBetOrders(db, l2_2.id, 8,   0,   'USDC')
    await insertBetOrders(db, l2_3.id, 350, 0,   'PHP')
    await insertBetOrders(db, l2_3.id, 8,   0,   'USDT')
    await insertBetOrders(db, l2_3.id, 4,   0,   'USDC')
    await insertBetOrders(db, l2_4.id, 500, 0,   'PHP')    // 未激活，不产生上线佣金
    await insertBetOrders(db, l2_4.id, 10,  0,   'USDT')
    await insertBetOrders(db, l2_4.id, 5,   0,   'USDC')

    // L3 — 全员三币种
    await insertBetOrders(db, l3_1.id, 150, 0,   'PHP')
    await insertBetOrders(db, l3_1.id, 4,   1,   'USDT')
    await insertBetOrders(db, l3_1.id, 5,   1,   'USDC')
    await insertBetOrders(db, l3_2.id, 100, 400, 'PHP')    // PHP派彩高于投注，流水正
    await insertBetOrders(db, l3_2.id, 3,   0,   'USDT')
    await insertBetOrders(db, l3_2.id, 2,   0,   'USDC')
    await insertBetOrders(db, l3_3.id, 100, 0,   'PHP')
    await insertBetOrders(db, l3_3.id, 6,   1,   'USDT')
    await insertBetOrders(db, l3_3.id, 4,   1,   'USDC')
    await insertBetOrders(db, l3_4.id, 100, 300, 'PHP')    // PHP派彩高于投注，流水正
    await insertBetOrders(db, l3_4.id, 5,   0,   'USDT')
    await insertBetOrders(db, l3_4.id, 3,   0,   'USDC')
    await insertBetOrders(db, l3_5.id, 280, 0,   'PHP')
    await insertBetOrders(db, l3_5.id, 6,   0,   'USDT')
    await insertBetOrders(db, l3_5.id, 4,   0,   'USDC')
    await insertBetOrders(db, l3_6.id, 50,  0,   'PHP')
    await insertBetOrders(db, l3_6.id, 5,   1,   'USDT')
    await insertBetOrders(db, l3_6.id, 7,   1,   'USDC')

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
              ggr_cents, rate_pct, commission_cents, php_equivalent_cents, currency_breakdown, status
       FROM bg_team_commission
       WHERE period=? AND from_user_id IN (${allIds.map(()=>'?').join(',')})
       ORDER BY from_user_id, currency, level`,
      [TEST_PERIOD, ...allIds]
    )

    const [[rates]] = await db.query(
      `SELECT l1_rate_pct AS cfgL1, l2_rate_pct AS cfgL2, l3_rate_pct AS cfgL3, name AS planName
       FROM bg_team_rate_plan WHERE is_default = 1 LIMIT 1`,
    )
    log('  当前默认套餐费率', {
      套餐: rates?.planName ?? '默认',
      L1: `${rates?.cfgL1 ?? '?'}%`,
      L2: `${rates?.cfgL2 ?? '?'}%`,
      L3: `${rates?.cfgL3 ?? '?'}%`,
    })

    // ── 系统为流水制（turnover-based）说明 ─────────────────────────
    // 1. 只统计 bet_type='bet' 的投注额，不减 win
    // 2. 多币种通过汇率折算为 PHP，全部以 PHP 出佣金
    // 3. 每个 from_user 对其上线最多产生 3 条佣金（L1/L2/L3 各一条），不按币种拆分
    // 4. bg_team_ggr_monthly 不由 daily settle 写入

    // ── 未激活验证 ────────────────────────────────────────────────
    const fromL2_4 = commissions.filter(c => c.from_user_id === l2_4.id)
    ok(`l2_4(未激活) 不产生佣金`, fromL2_4.length === 0, fromL2_4.length)

    // ── 派彩高于投注的用户依然产生正佣金（流水制只看投注额）──
    const fromL1_2 = commissions.filter(c => c.from_user_id === l1_2.id)
    ok(`l1_2(PHP派彩高于投注+三币种) 产生 1 条佣金(L1→root)`, fromL1_2.length === 1, fromL1_2.length)
    ok(`l1_2 commission_cents 为正（流水制）`, Number(fromL1_2[0]?.commission_cents) > 0, fromL1_2[0]?.commission_cents)
    ok(`l1_2 currency=PHP`, fromL1_2[0]?.currency === 'PHP')

    const fromL3_2 = commissions.filter(c => c.from_user_id === l3_2.id)
    ok(`l3_2(PHP派彩高于投注+三币种) 产生 3 条佣金`, fromL3_2.length === 3, fromL3_2.length)
    ok(`l3_2 全部 commission_cents 为正`, fromL3_2.every(c => Number(c.commission_cents) > 0))

    const fromL3_4 = commissions.filter(c => c.from_user_id === l3_4.id)
    ok(`l3_4(PHP派彩高于投注+三币种) 产生 3 条佣金`, fromL3_4.length === 3, fromL3_4.length)
    ok(`l3_4 全部 commission_cents 为正`, fromL3_4.every(c => Number(c.commission_cents) > 0))

    // ── 正常投注验证 ──────────────────────────────────────────────
    const fromL1_1 = commissions.filter(c => c.from_user_id === l1_1.id)
    ok(`l1_1(三币种) 产生 1 条佣金(L1→root)`, fromL1_1.length === 1, fromL1_1.length)
    ok(`l1_1 受益人=root level=1 currency=PHP`, fromL1_1[0]?.beneficiary_id === root.id && fromL1_1[0]?.level === 1 && fromL1_1[0]?.currency === 'PHP')
    ok(`l1_1 commission_cents 为正`, Number(fromL1_1[0]?.commission_cents) > 0)

    // l2_1: PHP+USDT+USDC → 2层上线各 1 条 PHP 佣金（三币种折算合并）
    const fromL2_1 = commissions.filter(c => c.from_user_id === l2_1.id)
    ok(`l2_1(三币种) 产生 2 条佣金(L1=l1_1, L2=root)`, fromL2_1.length === 2, fromL2_1.length)
    ok(`l2_1 全部 currency=PHP`, fromL2_1.every(c => c.currency === 'PHP'))
    ok(`l2_1 root 收到 PHP 佣金(level=2)`, !!fromL2_1.find(c => c.beneficiary_id === root.id && c.level === 2))

    // l2_2: PHP+USDT+USDC → 折算 PHP → 2层上线各 1 条 PHP 佣金
    const fromL2_2 = commissions.filter(c => c.from_user_id === l2_2.id)
    ok(`l2_2(三币种) 产生 2 条佣金`, fromL2_2.length === 2, fromL2_2.length)
    ok(`l2_2 全部 currency=PHP（多币种折算）`, fromL2_2.every(c => c.currency === 'PHP'))

    // l3_1: PHP+USDC → 3层上线各 1 条 PHP 佣金，共 3 条
    const fromL3_1 = commissions.filter(c => c.from_user_id === l3_1.id)
    ok(`l3_1(三币种) 产生 3 条佣金`, fromL3_1.length === 3, fromL3_1.length)
    ok(`l3_1 root 收到 PHP 佣金(level=3)`, !!fromL3_1.find(c => c.beneficiary_id === root.id && c.level === 3 && c.currency === 'PHP'))

    // l3_3: PHP+USDT+USDC (三币种) → 折算 PHP → 3层各 1 条，共 3 条
    const fromL3_3 = commissions.filter(c => c.from_user_id === l3_3.id)
    ok(`l3_3(PHP+USDT+USDC) 产生 3 条佣金`, fromL3_3.length === 3, fromL3_3.length)
    ok(`l3_3 root 收到 PHP 佣金(level=3)`, !!fromL3_3.find(c => c.beneficiary_id === root.id && c.currency === 'PHP' && c.level === 3))

    // currency_breakdown 应记录多币种明细
    const l3_3Root = fromL3_3.find(c => c.beneficiary_id === root.id && c.level === 3)
    const rawBk = l3_3Root?.currency_breakdown
    const breakdown = !rawBk ? [] : (Array.isArray(rawBk) ? rawBk : JSON.parse(rawBk))
    const bkCurrencies = [...new Set(breakdown.map((b) => b.currency))]
    ok(`l3_3 root commission breakdown 含3种币种明细`, bkCurrencies.length === 3, bkCurrencies.join(','))

    // php_equivalent_cents 应非零（所有佣金已折算）
    ok(`所有佣金 php_equivalent_cents 非零`, commissions.every(c => Number(c.php_equivalent_cents) > 0))

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
