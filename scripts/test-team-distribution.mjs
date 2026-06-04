/**
 * 三级分销功能测试脚本（含 L4 层，各层均产生注单）
 *
 * 用户树（每层可配置人数）：
 *   root (BG-10001)
 *   ├─ L1_1, L1_2
 *   │    └─ L2_x (每 L1 下 L2_PER_L1 名)
 *   │         └─ L3_x (每 L2 下 L3_PER_L2 名)
 *   │              └─ L4_x (每 L3 下 L4_PER_L3 名)
 *
 * L4 的 bg_team_node: l1=L3, l2=L2, l3=L1, root 拿不到 L4 的佣金
 *
 * 运行方式：
 *   node scripts/test-team-distribution.mjs
 * （在 tma-bff-node 容器内运行，env 已由容器注入）
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
const CORE_URL  = process.env.CORE_NODE_URL   ?? 'http://tma-core-node:4000'
const INT_TOKEN = process.env.INTERNAL_TOKEN  ?? ''

const TEST_PERIOD = process.env.TEST_PERIOD ?? (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

// 每层人数
const L1_COUNT   = 2
const L2_PER_L1  = 2
const L3_PER_L2  = 2
const L4_PER_L3  = 2

// 各层下注金额（PHP 元）/ 赢出金额
const BETS = {
  l1: { bet: 500,  win: 100  },  // GGR ₱400
  l2: { bet: 800,  win: 300  },  // GGR ₱500
  l3: { bet: 1000, win: 200  },  // GGR ₱800
  l4: { bet: 600,  win: 50   },  // GGR ₱550
}

// ── 工具 ──────────────────────────────────────────────────────────────────────
function log(msg, data) {
  console.log(`\n[${new Date().toISOString()}] ${msg}`)
  if (data !== undefined) console.log(JSON.stringify(data, null, 2))
}

function ok(label, passed, detail) {
  const mark = passed ? '✓' : '✗'
  console.log(`  ${mark} ${label}${detail !== undefined ? ': ' + detail : ''}`)
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
    // 写入三级归属树（与 mysql-store.createUser 相同逻辑）
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

async function enableAndActivate(db, userId) {
  await db.execute(
    `UPDATE bg_team_node SET opted_in=1, opted_in_at=NOW(3),
       activated=1, activation_cents=10000, activated_at=NOW(3)
     WHERE user_id = ?`,
    [userId]
  )
  await db.execute(`INSERT IGNORE INTO bg_team_wallet (user_id) VALUES (?)`, [userId])
}

async function insertBetOrders(db, userId, betAmount, winAmount) {
  const ts   = Date.now()
  const rand = randomBytes(3).toString('hex')
  // bg_bet_order.amount 是 PHP 元（DECIMAL），迁移 016 已从 amount_cents 改为 amount
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id, bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, 'bet', ?, 'settled', NOW(3))`,
    [userId, `T${ts}${rand}_BET`, betAmount]
  )
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id, bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, 'win', ?, 'settled', NOW(3))`,
    [userId, `T${ts}${rand}_WIN`, winAmount]
  )
  return { ggrCents: Math.round((betAmount - winAmount) * 100) }
}

async function cleanupPreviousRun(db) {
  log('清理上一轮测试数据（label=test 的用户及其关联数据）')

  const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM bg_user WHERE label='test'`)
  if (Number(cnt) === 0) { log('  无历史测试数据，跳过清理'); return }

  // 关闭外键检查，批量删除
  await db.execute('SET FOREIGN_KEY_CHECKS=0')
  try {
    // beneficiary 或 from_user 是测试用户的佣金记录
    await db.execute(
      `DELETE FROM bg_team_commission
       WHERE from_user_id IN (SELECT id FROM bg_user WHERE label='test')
          OR beneficiary_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_team_ggr_monthly WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_team_wallet WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_team_withdrawal WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_team_node WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_bet_order WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_wallet_ledger WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_wallet WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(
      `DELETE FROM bg_user_profile WHERE user_id IN (SELECT id FROM bg_user WHERE label='test')`
    )
    await db.execute(`DELETE FROM bg_user WHERE label='test'`)
  } finally {
    await db.execute('SET FOREIGN_KEY_CHECKS=1')
  }
  log(`  已清理 ${cnt} 个测试用户及其所有关联数据`)
}

async function triggerSettle(period) {
  const res = await fetch(`${CORE_URL}/internal/team/settle`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INT_TOKEN },
    body:    JSON.stringify({ period }),
  }).catch(e => { throw new Error(`core-node 不可达: ${e.message}`) })

  if (!res.ok) throw new Error(`结算接口返回 ${res.status}`)
  log('  结算请求已发送，等待 4s...')
  await new Promise(r => setTimeout(r, 4000))
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  log('连接数据库', { host: DB.host, database: DB.database })
  const db = await mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 5 })

  try {
    // ── 0. 清理 ────────────────────────────────────────────────────────────────
    await cleanupPreviousRun(db)

    // ── 1. 创建用户树 ──────────────────────────────────────────────────────────
    log('步骤 1：创建测试用户树')

    const ROOT_ID = 'BG-10001'
    const [[rootRow]] = await db.query(
      `SELECT id, display_name, invite_code FROM bg_user WHERE id = ? LIMIT 1`, [ROOT_ID]
    )
    if (!rootRow) throw new Error(`root 用户 ${ROOT_ID} 不存在`)
    const root = { id: rootRow.id, displayName: rootRow.display_name }
    log(`  root = ${root.id}`)

    // 确保 root 的 team_node 存在
    await db.execute(`INSERT IGNORE INTO bg_team_node (user_id) VALUES (?)`, [root.id])

    const l1Users = []
    for (let i = 0; i < L1_COUNT; i++) {
      const u = await createUser(db, { displayName: `TEST_L1_${i+1}`, inviterId: root.id })
      l1Users.push(u)
    }

    const l2Users = []
    for (const l1 of l1Users) {
      for (let i = 0; i < L2_PER_L1; i++) {
        const u = await createUser(db, { displayName: `TEST_L2_${l1.id}_${i+1}`, inviterId: l1.id })
        l2Users.push({ ...u, parent: l1 })
      }
    }

    const l3Users = []
    for (const l2 of l2Users) {
      for (let i = 0; i < L3_PER_L2; i++) {
        const u = await createUser(db, { displayName: `TEST_L3_${l2.id}_${i+1}`, inviterId: l2.id })
        l3Users.push({ ...u, parent: l2 })
      }
    }

    const l4Users = []
    for (const l3 of l3Users) {
      for (let i = 0; i < L4_PER_L3; i++) {
        const u = await createUser(db, { displayName: `TEST_L4_${l3.id}_${i+1}`, inviterId: l3.id })
        l4Users.push({ ...u, parent: l3 })
      }
    }

    log(`用户树创建完成`, {
      root: 1,
      l1: l1Users.length,
      l2: l2Users.length,
      l3: l3Users.length,
      l4: l4Users.length,
      total: 1 + l1Users.length + l2Users.length + l3Users.length + l4Users.length,
    })

    // ── 2. 验证归属关系 ────────────────────────────────────────────────────────
    log('步骤 2：验证 bg_team_node 归属关系')

    for (const u of l1Users) {
      const [[n]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id=?`, [u.id]
      )
      ok(`L1(${u.id}) l1_ref=root`, n?.l1_referrer_id === root.id)
      ok(`L1(${u.id}) l2_ref=null`, n?.l2_referrer_id == null)
    }

    for (const u of l2Users) {
      const [[n]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id=?`, [u.id]
      )
      ok(`L2(${u.id}) l1_ref=${u.parent.id}`, n?.l1_referrer_id === u.parent.id)
      ok(`L2(${u.id}) l2_ref=root`, n?.l2_referrer_id === root.id)
      ok(`L2(${u.id}) l3_ref=null`, n?.l3_referrer_id == null)
    }

    for (const u of l3Users) {
      const [[n]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id=?`, [u.id]
      )
      ok(`L3(${u.id}) l1_ref=${u.parent.id}`, n?.l1_referrer_id === u.parent.id)
      ok(`L3(${u.id}) l3_ref=root`, n?.l3_referrer_id === root.id)
    }

    for (const u of l4Users) {
      const [[n]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id=?`, [u.id]
      )
      // L4 的 l1_referrer = L3 parent，root 不在链上
      ok(`L4(${u.id}) l1_ref=${u.parent.id}`, n?.l1_referrer_id === u.parent.id)
      ok(`L4(${u.id}) l3_ref=L1(非root)`, n?.l3_referrer_id !== root.id)
    }

    // ── 3. 开启代理 & 激活 ────────────────────────────────────────────────────
    log('步骤 3：开启代理 & 激活所有测试用户')
    const allNew = [...l1Users, ...l2Users, ...l3Users, ...l4Users]
    for (const u of allNew) await enableAndActivate(db, u.id)
    // root 也激活（确保能作为佣金受益人）
    await enableAndActivate(db, root.id)
    log(`  已激活 ${allNew.length + 1} 个用户`)

    // ── 4. 各层用户产生注单 ───────────────────────────────────────────────────
    log('步骤 4：各层用户插入注单')
    const ggrMap = {}

    for (const u of l1Users) {
      const { ggrCents } = await insertBetOrders(db, u.id, BETS.l1.bet, BETS.l1.win)
      ggrMap[u.id] = ggrCents
    }
    for (const u of l2Users) {
      const { ggrCents } = await insertBetOrders(db, u.id, BETS.l2.bet, BETS.l2.win)
      ggrMap[u.id] = ggrCents
    }
    for (const u of l3Users) {
      const { ggrCents } = await insertBetOrders(db, u.id, BETS.l3.bet, BETS.l3.win)
      ggrMap[u.id] = ggrCents
    }
    for (const u of l4Users) {
      const { ggrCents } = await insertBetOrders(db, u.id, BETS.l4.bet, BETS.l4.win)
      ggrMap[u.id] = ggrCents
    }

    const totalOrders = allNew.length * 2
    const [[{ betCnt }]] = await db.query(
      `SELECT COUNT(*) AS betCnt FROM bg_bet_order WHERE user_id IN (${allNew.map(()=>'?').join(',')})`,
      allNew.map(u => u.id)
    )
    ok(`bg_bet_order 共 ${totalOrders} 条`, Number(betCnt) === totalOrders, betCnt)

    log('  各层 GGR 预期', {
      L1每人: `₱${(BETS.l1.bet-BETS.l1.win).toFixed(0)} → ${(BETS.l1.bet-BETS.l1.win)*100}分`,
      L2每人: `₱${(BETS.l2.bet-BETS.l2.win).toFixed(0)} → ${(BETS.l2.bet-BETS.l2.win)*100}分`,
      L3每人: `₱${(BETS.l3.bet-BETS.l3.win).toFixed(0)} → ${(BETS.l3.bet-BETS.l3.win)*100}分`,
      L4每人: `₱${(BETS.l4.bet-BETS.l4.win).toFixed(0)} → ${(BETS.l4.bet-BETS.l4.win)*100}分`,
    })

    // ── 5. 触发结算 ───────────────────────────────────────────────────────────
    log(`步骤 5：触发 ${TEST_PERIOD} 月结算`)
    await triggerSettle(TEST_PERIOD)

    // ── 6. 验证佣金 ───────────────────────────────────────────────────────────
    log('步骤 6：验证佣金')

    const allBettors = allNew  // L1~L4 都下注了
    const [commissions] = await db.query(
      `SELECT beneficiary_id, from_user_id, level, ggr_cents, rate_pct, commission_cents, status
       FROM bg_team_commission
       WHERE period=? AND from_user_id IN (${allBettors.map(()=>'?').join(',')})
       ORDER BY from_user_id, level`,
      [TEST_PERIOD, ...allBettors.map(u => u.id)]
    )

    // 每个下注用户最多 3 条佣金（有几层上线就有几条）
    const [[{ cfgL1, cfgL2, cfgL3 }]] = await db.query(
      `SELECT l1_rate_pct AS cfgL1, l2_rate_pct AS cfgL2, l3_rate_pct AS cfgL3
       FROM bg_team_config WHERE id=1`
    )
    log('  当前费率', { L1: `${cfgL1}%`, L2: `${cfgL2}%`, L3: `${cfgL3}%` })

    // 验证 L4 用户：root 不应收到来自 L4 的佣金
    const rootFromL4 = commissions.filter(
      c => c.beneficiary_id === root.id && l4Users.some(u => u.id === c.from_user_id)
    )
    ok(`root 不收 L4 的佣金（超出3层）`, rootFromL4.length === 0, `找到 ${rootFromL4.length} 条`)

    // 验证 L1 用户：应有 1 条佣金（beneficiary = root，level=1）
    for (const u of l1Users) {
      const rows = commissions.filter(c => c.from_user_id === u.id)
      ok(`L1(${u.id}) 产生 1 条佣金`, rows.length === 1, rows.length)
      if (rows[0]) {
        ok(`L1(${u.id}) 受益人=root`, rows[0].beneficiary_id === root.id)
        const expected = Math.floor(ggrMap[u.id] * Number(cfgL1) / 100)
        ok(`L1(${u.id}) 佣金金额正确`, Number(rows[0].commission_cents) === expected,
          `${rows[0].commission_cents} (期望 ${expected})`)
      }
    }

    // 验证 L2 用户：应有 2 条佣金（level1=L1上线, level2=root）
    for (const u of l2Users) {
      const rows = commissions.filter(c => c.from_user_id === u.id)
      ok(`L2(${u.id}) 产生 2 条佣金`, rows.length === 2, rows.length)
      const rootRow = rows.find(c => c.beneficiary_id === root.id)
      ok(`L2(${u.id}) root 收到 level=2 佣金`, rootRow?.level === 2)
    }

    // 验证 L3 用户：应有 3 条佣金（level1=L2, level2=L1, level3=root）
    for (const u of l3Users) {
      const rows = commissions.filter(c => c.from_user_id === u.id)
      ok(`L3(${u.id}) 产生 3 条佣金`, rows.length === 3, rows.length)
      const rootRow = rows.find(c => c.beneficiary_id === root.id)
      ok(`L3(${u.id}) root 收到 level=3 佣金`, rootRow?.level === 3)
    }

    // 验证 L4 用户：应有 3 条佣金（level1=L3, level2=L2, level3=L1），root 不在其中
    for (const u of l4Users) {
      const rows = commissions.filter(c => c.from_user_id === u.id)
      ok(`L4(${u.id}) 产生 3 条佣金`, rows.length === 3, rows.length)
      const rootRow = rows.find(c => c.beneficiary_id === root.id)
      ok(`L4(${u.id}) root 不在佣金链中`, !rootRow)
    }

    // ── 7. 汇总打印 ───────────────────────────────────────────────────────────
    log('── 佣金汇总表 ─────────────────────────────────────────')
    console.table(
      commissions.map(c => ({
        来源用户: c.from_user_id,
        受益人:   c.beneficiary_id,
        层级:     c.level,
        GGR分:    c.ggr_cents,
        费率:     `${c.rate_pct}%`,
        佣金分:   c.commission_cents,
        状态:     c.status,
      }))
    )

    // root 总收益
    const rootCommissions = commissions.filter(c => c.beneficiary_id === root.id)
    const rootTotal = rootCommissions.reduce((s, c) => s + Number(c.commission_cents), 0)
    log(`root(${root.id}) 本次共获佣金`, {
      条数: rootCommissions.length,
      合计分: rootTotal,
      合计PHP: `₱${(rootTotal/100).toFixed(2)}`,
    })

    log(process.exitCode ? '⚠ 测试完成（有失败项，见上方 ✗）' : '✓ 全部测试通过')

  } finally {
    await db.end()
  }
}

main().catch(e => {
  console.error('脚本异常:', e.message)
  process.exit(1)
})
