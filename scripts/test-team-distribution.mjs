/**
 * 三级分销功能测试脚本
 *
 * 树形结构（可配置每层人数）：
 *   root（根代理）
 *   ├─ l1_a → l2_a → l3_a, l3_b
 *   │         l2_b → l3_c
 *   └─ l1_b → l2_c → l3_d, l3_e
 *
 * 使用方式：
 *   MYSQL_HOST=47.84.34.139 MYSQL_PORT=3307 MYSQL_USER=betogo \
 *   MYSQL_PASSWORD=xxx MYSQL_DATABASE=betogo \
 *   BFF_BASE_URL=http://47.84.34.139:3000 \
 *   ADMIN_TOKEN=xxx \
 *   CORE_NODE_URL=http://47.84.34.139:4000 \
 *   INTERNAL_TOKEN=xxx \
 *   node scripts/test-team-distribution.mjs
 *
 * 或本地：
 *   MYSQL_HOST=127.0.0.1 MYSQL_PASSWORD=betogo_dev node scripts/test-team-distribution.mjs
 */

import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'

// ── 配置 ──────────────────────────────────────────────────────────────────────
const DB = {
  host:     process.env.MYSQL_HOST     ?? '127.0.0.1',
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER     ?? 'betogo',
  password: process.env.MYSQL_PASSWORD ?? 'betogo_dev',
  database: process.env.MYSQL_DATABASE ?? 'betogo',
}
const BFF_BASE   = process.env.BFF_BASE_URL    ?? 'http://127.0.0.1:3000'
const CORE_URL   = process.env.CORE_NODE_URL   ?? 'http://127.0.0.1:4000'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN    ?? ''
const INT_TOKEN   = process.env.INTERNAL_TOKEN ?? ''

// 当前测试月份（可覆盖）
const TEST_PERIOD = process.env.TEST_PERIOD ?? (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

// 每层用户数量（可调整）
const L1_COUNT = 2
const L2_PER_L1 = 2
const L3_PER_L2 = 2

// 每个 L3 用户的模拟下注金额（PHP 元），bg_bet_order.amount 列为 DECIMAL(18,4)
const BET_AMOUNT = 1000   // ₱1000
const WIN_AMOUNT = 200    // ₱200  → GGR = ₱800 = 80000 分

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
  const [rows] = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 10000) + 1 AS n FROM bg_user`
  )
  return `BG-${rows[0].n}`
}

async function createUser(db, { displayName, inviterId }) {
  const id = await nextUserId(db)
  let inviteCode = genInviteCode()
  // 碰撞极小，简单重试一次
  const [[dup]] = await db.query(`SELECT id FROM bg_user WHERE invite_code = ? LIMIT 1`, [inviteCode])
  if (dup) inviteCode = genInviteCode()

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    await conn.execute(
      `INSERT INTO bg_user
         (id, telegram_user_id, display_name, invite_code, inviter_id,
          locale, status, label, registered_at)
       VALUES (?, ?, ?, ?, ?, 'en', 'active', 'normal', NOW(3))`,
      [id, null, displayName, inviteCode, inviterId ?? null]
    )

    await conn.execute(
      `INSERT IGNORE INTO bg_user_profile (user_id) VALUES (?)`, [id]
    )

    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, frozen)
       VALUES (?, 'PHP', 0, 0)
       ON DUPLICATE KEY UPDATE user_id=user_id`,
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

async function enableAgent(db, userId) {
  // 直接 UPDATE opted_in（等价于 POST /promotions/team/enable，跳过 HTTP session 依赖）
  await db.execute(
    `UPDATE bg_team_node SET opted_in=1, opted_in_at=NOW(3) WHERE user_id = ?`,
    [userId]
  )
  await db.execute(
    `INSERT IGNORE INTO bg_team_wallet (user_id) VALUES (?)`,
    [userId]
  )
}

async function activateUser(db, userId) {
  await db.execute(
    `UPDATE bg_team_node
     SET activated=1, activation_cents=10000, activated_at=NOW(3)
     WHERE user_id = ?`,
    [userId]
  )
}

async function insertBetOrders(db, userId, betAmount, winAmount) {
  const base = `TEST_${Date.now()}_${userId}`
  // bg_bet_order.amount 是 PHP 元（DECIMAL），迁移 016 已从 amount_cents 改为 amount
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id,
        bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, 'bet', ?, 'settled', NOW(3))`,
    [userId, base + '_BET', betAmount]
  )
  await db.execute(
    `INSERT INTO bg_bet_order
       (user_id, aggregator_id, provider_id, provider_txn_id,
        bet_type, amount, status, settled_at)
     VALUES (?, 'test', 'test-provider', ?, 'win', ?, 'settled', NOW(3))`,
    [userId, base + '_WIN', winAmount]
  )
  return { ggrCents: Math.round((betAmount - winAmount) * 100) }
}

async function triggerSettle(period) {
  // 优先调用 core-node 内部接口（更直接）
  const url = `${CORE_URL}/internal/team/settle`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': INT_TOKEN,
    },
    body: JSON.stringify({ period }),
  }).catch(() => null)

  if (!res || !res.ok) {
    // fallback: 通过 admin API 触发
    if (!ADMIN_TOKEN) throw new Error('结算失败：core-node 不可达且未配置 ADMIN_TOKEN')
    const r2 = await fetch(`${BFF_BASE}/api/v1/admin/team/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ period }),
    })
    if (!r2.ok) throw new Error(`admin settle failed: ${r2.status}`)
  }

  // 结算是异步的，等待 3 秒
  log(`等待结算完成（3s）...`)
  await new Promise(r => setTimeout(r, 3000))
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  log('连接数据库', { host: DB.host, port: DB.port, database: DB.database })
  const db = await mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 5 })

  try {
    // ── 1. 创建用户树 ──────────────────────────────────────────────────────────
    log('步骤 1：创建测试用户树')

    // root 固定使用 BG-10001（已存在的用户，不新建）
    const ROOT_ID = 'BG-10001'
    const [[rootRow]] = await db.query(
      `SELECT id, display_name, invite_code FROM bg_user WHERE id = ? LIMIT 1`, [ROOT_ID]
    )
    if (!rootRow) throw new Error(`root 用户 ${ROOT_ID} 不存在，请先确认数据库中有此用户`)
    const root = { id: rootRow.id, displayName: rootRow.display_name, inviteCode: rootRow.invite_code }
    log('  root 使用已有用户', { id: root.id, inviteCode: root.inviteCode })

    const l1Users = []
    for (let i = 0; i < L1_COUNT; i++) {
      const u = await createUser(db, { displayName: `TEST_L1_${i + 1}`, inviterId: root.id })
      l1Users.push(u)
      log(`  L1_${i + 1} 创建`, { id: u.id })
    }

    const l2Users = []
    for (const l1 of l1Users) {
      for (let i = 0; i < L2_PER_L1; i++) {
        const u = await createUser(db, { displayName: `TEST_L2_${l1.displayName}_${i + 1}`, inviterId: l1.id })
        l2Users.push({ ...u, parentId: l1.id })
        log(`  L2 创建`, { id: u.id, parent: l1.id })
      }
    }

    const l3Users = []
    for (const l2 of l2Users) {
      for (let i = 0; i < L3_PER_L2; i++) {
        const u = await createUser(db, { displayName: `TEST_L3_${l2.id}_${i + 1}`, inviterId: l2.id })
        l3Users.push({ ...u, parentId: l2.id })
        log(`  L3 创建`, { id: u.id, parent: l2.id })
      }
    }

    const allUsers = [root, ...l1Users, ...l2Users, ...l3Users]
    // 确保 root 的 bg_team_node 行存在（用于 enableAgent/activateUser）
    await db.execute(
      `INSERT IGNORE INTO bg_team_node (user_id) VALUES (?)`, [root.id]
    )

    log(`共涉及 ${allUsers.length} 个用户（root 已存在，新建 ${allUsers.length - 1} 个）`, {
      root: 1, l1: l1Users.length, l2: l2Users.length, l3: l3Users.length
    })

    // ── 2. 验证 bg_team_node 关系树 ────────────────────────────────────────────
    log('步骤 2：验证 bg_team_node 归属关系')

    for (const u of l1Users) {
      const [[node]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id = ?`, [u.id]
      )
      ok(`L1 ${u.id} 的 l1_referrer = root`, node?.l1_referrer_id === root.id, node?.l1_referrer_id)
      ok(`L1 ${u.id} 的 l2_referrer = null`, node?.l2_referrer_id == null)
    }

    for (const u of l2Users) {
      const [[node]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id FROM bg_team_node WHERE user_id = ?`, [u.id]
      )
      ok(`L2 ${u.id} 的 l1_referrer = parent(${u.parentId})`, node?.l1_referrer_id === u.parentId, node?.l1_referrer_id)
      ok(`L2 ${u.id} 的 l2_referrer = root`, node?.l2_referrer_id === root.id, node?.l2_referrer_id)
    }

    for (const u of l3Users) {
      const [[node]] = await db.query(
        `SELECT l1_referrer_id, l2_referrer_id, l3_referrer_id FROM bg_team_node WHERE user_id = ?`, [u.id]
      )
      ok(`L3 ${u.id} 的 l3_referrer = root`, node?.l3_referrer_id === root.id, node?.l3_referrer_id)
    }

    // ── 3. 开启代理 + 激活 ────────────────────────────────────────────────────
    log('步骤 3：开启代理 & 激活所有用户')
    for (const u of allUsers) {
      await enableAgent(db, u.id)
      await activateUser(db, u.id)
    }
    log(`  已激活 ${allUsers.length} 个用户`)

    // ── 4. 模拟注单（仅 L3 下注） ──────────────────────────────────────────────
    log('步骤 4：为每个 L3 用户插入注单')
    const l3GgrMap = {}
    for (const u of l3Users) {
      const { ggrCents } = await insertBetOrders(db, u.id, BET_AMOUNT, WIN_AMOUNT)
      l3GgrMap[u.id] = ggrCents
      log(`  ${u.id} 下注 ₱${BET_AMOUNT}, 赢 ₱${WIN_AMOUNT}, GGR ₱${ggrCents/100}`)
    }

    // 验证注单写入
    const [betRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM bg_bet_order WHERE user_id IN (${l3Users.map(() => '?').join(',')})`,
      l3Users.map(u => u.id)
    )
    ok(`bg_bet_order 有 ${l3Users.length * 2} 条注单`, Number(betRows[0].cnt) === l3Users.length * 2, betRows[0].cnt)

    // ── 5. 触发结算 ───────────────────────────────────────────────────────────
    log(`步骤 5：触发 ${TEST_PERIOD} 月结算`)
    try {
      await triggerSettle(TEST_PERIOD)
      log('  结算完成')
    } catch (e) {
      log('  结算触发失败（跳过，手动验证）', e.message)
    }

    // ── 6. 验证佣金 ───────────────────────────────────────────────────────────
    log('步骤 6：验证佣金计算')

    const [[cfg]] = await db.query(
      `SELECT l1_rate_pct, l2_rate_pct, l3_rate_pct FROM bg_team_config WHERE id = 1`
    )
    log('  当前费率配置', cfg)

    const [commissions] = await db.query(
      `SELECT beneficiary_id, from_user_id, level, ggr_cents, rate_pct, commission_cents, status
       FROM bg_team_commission
       WHERE from_user_id IN (${l3Users.map(() => '?').join(',')}) AND period = ?`,
      [...l3Users.map(u => u.id), TEST_PERIOD]
    )

    log(`  找到 ${commissions.length} 条佣金记录（期望 ${l3Users.length * 3} 条）`)
    ok(`佣金记录数量正确`, commissions.length === l3Users.length * 3, `${commissions.length}/${l3Users.length * 3}`)

    // 验证每个 L3 用户产生的 3 条佣金
    for (const l3 of l3Users) {
      const ggrCents = l3GgrMap[l3.id]
      const rows = commissions.filter(c => c.from_user_id === l3.id)

      const l1Row = rows.find(c => c.level === 1)  // L3 的 l1_referrer（即 L2 上线）
      const l2Row = rows.find(c => c.level === 2)  // L3 的 l2_referrer（即 L1 上线）
      const l3Row = rows.find(c => c.level === 3)  // L3 的 l3_referrer（即 root）

      ok(`L3(${l3.id}) 有 level=1 佣金记录`, !!l1Row)
      ok(`L3(${l3.id}) 有 level=2 佣金记录`, !!l2Row)
      ok(`L3(${l3.id}) 有 level=3 佣金记录`, !!l3Row)

      if (l1Row) {
        const expected = Math.floor(ggrCents * Number(l1Row.rate_pct) / 100)
        ok(`L3(${l3.id}) L1佣金金额正确`, Number(l1Row.commission_cents) === expected,
          `₱${Number(l1Row.commission_cents)/100} (期望 ₱${expected/100})`)
      }
    }

    // 汇总：root 收到的 L3 佣金总额
    const rootL3Commissions = commissions.filter(c => c.beneficiary_id === root.id && c.level === 3)
    const rootTotal = rootL3Commissions.reduce((s, c) => s + Number(c.commission_cents), 0)
    log(`  root(${root.id}) 作为 L3 推荐人收到佣金`, {
      count: rootL3Commissions.length,
      totalPhp: rootTotal / 100,
    })
    ok(`root 收到 ${l3Users.length} 条 L3 佣金`, rootL3Commissions.length === l3Users.length, rootL3Commissions.length)

    // ── 7. 打印汇总表 ─────────────────────────────────────────────────────────
    log('── 测试用户汇总 ───────────────────────────────────────')
    console.table([
      { 层级: 'root', 用户ID: root.id, 邀请码: root.inviteCode },
      ...l1Users.map(u => ({ 层级: 'L1', 用户ID: u.id, 邀请码: u.inviteCode, 上线: root.id })),
      ...l2Users.map(u => ({ 层级: 'L2', 用户ID: u.id, 邀请码: u.inviteCode, 上线: u.parentId })),
      ...l3Users.map(u => ({ 层级: 'L3', 用户ID: u.id, 邀请码: u.inviteCode, 上线: u.parentId })),
    ])

    log('── 佣金汇总 ───────────────────────────────────────────')
    console.table(
      commissions.map(c => ({
        受益人: c.beneficiary_id,
        来源L3: c.from_user_id,
        层级: c.level,
        GGR分: c.ggr_cents,
        费率: `${c.rate_pct}%`,
        佣金分: c.commission_cents,
        状态: c.status,
      }))
    )

    log(process.exitCode ? '测试完成（有失败项，见上方 ✗）' : '测试全部通过 ✓')

  } finally {
    await db.end()
  }
}

main().catch(e => {
  console.error('脚本异常', e)
  process.exit(1)
})
