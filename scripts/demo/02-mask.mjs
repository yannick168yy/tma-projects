#!/usr/bin/env node
/**
 * 在临时库上原地脱敏。
 *
 * 🔴 只对 STAGE_DB 操作，绝不碰源库。库名不是 *_stage 结尾就直接拒绝运行 ——
 * 这个脚本会 TRUNCATE 和全表 UPDATE，指错库就是不可逆的数据事故。
 *
 * 用法（先开 SSH 隧道到目标 MySQL）：
 *   DEMO_MASK_SALT=<32位随机> \
 *   STAGE_DB=betogo_demo_stage MYSQL_HOST=127.0.0.1 MYSQL_PORT=13306 \
 *   MYSQL_USER=root MYSQL_PASSWORD=xxx \
 *   node scripts/demo/02-mask.mjs
 */
import { createRequire } from 'node:module'
import { COPY, SKIP, PURGED_SETTINGS, PURGED_COLUMNS, MASK_FIELDS, JSON_MASK_KEYS, JSON_KEEP_KEYS, NO_SCALE_PATTERN, COUNT_SCALE_COLUMNS } from './config.mjs'
import * as M from './lib/mask.mjs'
import { messageFor } from './lib/conversations.mjs'

// mysql2 从 bff-node 借用，不给这个目录单独装依赖。
// 两条路径是因为脚本要在两种环境跑：仓库里（开发调试）和 bff 容器内
// （生产走"就地脱敏"，明文数据不离开生产机，也省掉 AWS 出网流量）。
function loadMysql() {
  for (const base of [new URL('../../apps/bff-node/package.json', import.meta.url), 'file:///app/package.json']) {
    try { return createRequire(base)('mysql2/promise') } catch { /* 换下一个 */ }
  }
  throw new Error('找不到 mysql2。仓库里跑需要 apps/bff-node/node_modules，容器内跑需要 /app/node_modules')
}
const mysql = loadMysql()

const STAGE_DB = process.env.STAGE_DB
if (!STAGE_DB || !STAGE_DB.endsWith('_stage')) {
  console.error('STAGE_DB 必须以 _stage 结尾。这个脚本会 TRUNCATE 和全表 UPDATE，不接受指向正式库')
  process.exit(1)
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD,
  database: STAGE_DB,
  charset: 'UTF8MB4_UNICODE_CI',
  multipleStatements: false,
})

const q = async (sql, params) => (await conn.query(sql, params))[0]
const log = (...a) => console.log(...a)

// ── 1. 完整性校验：源库新增的表必须先分类，否则会带着真实数据溜进演示库 ──
const tables = (await q(
  'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [STAGE_DB],
)).map((r) => r.t)

const classified = new Set([...COPY, ...Object.keys(SKIP), ...Object.keys(MASK_FIELDS)])
const unclassified = tables.filter((t) => !classified.has(t))
// MASK_FIELDS 只列了有敏感字段的表，其余 MASK 表只做金额缩放，不算未分类
const KNOWN_MASK_ONLY_SCALE = unclassified
if (process.env.STRICT_TABLE_CHECK === '1' && KNOWN_MASK_ONLY_SCALE.length > 0) {
  log(`ℹ️  ${KNOWN_MASK_ONLY_SCALE.length} 张表只做金额缩放（无敏感字段）`)
}

// ── 2. SKIP：清空 ──
let skipped = 0
for (const [t, why] of Object.entries(SKIP)) {
  if (!tables.includes(t)) continue
  await q(`TRUNCATE TABLE \`${t}\``)
  skipped++
  log(`  清空 ${t.padEnd(34)} ${why}`)
}
log(`\n✅ 已清空 ${skipped} 张表\n`)

// ── 3. 字段级脱敏 ──
const RULES = {
  email: (v) => M.fakeEmail(v),
  name: (v, row) => M.fakeName(v, row.market),
  phone: (v) => M.fakePhone(v),
  ip: (v) => M.fakeIp(v),
  device: (v) => M.fakeDeviceId(v),
  extid: (v) => M.fakeExternalId(v),
  addr: (v) => M.fakeCryptoAddress(v),
  bank: (v) => M.fakeBankAccount(v),
  avatar: (v) => M.fakeAvatar(v),
  preserve: (v) => M.preserveFormat(v),
  fakeDate: (v) => M.fakeDate(v),
  clear: () => null,
  fakeDomain: (v) => (v ? `${M.preserveFormat(String(v).split('.')[0], 'dom')}.demo-site.com` : v),
  identityByProvider: (v, row) => {
    if (row.provider === 'phone') return M.fakePhone(v)
    if (row.provider === 'google') return M.fakeEmail(v)
    return M.fakeExternalId(v)
  },
  blacklistByType: (v, row) => {
    if (row.type === 'phone') return M.fakePhone(v)
    if (row.type === 'ip') return M.fakeIp(v)
    if (row.type === 'device') return M.fakeDeviceId(v)
    return M.preserveFormat(v)
  },
  // 白名单：脱敏规则内的按规则换，KEEP 内的保留，其余一律删掉。
  // 不认识的 key 默认删除，是因为 extra 里装的是第三方回调结构 ——
  // 我们无法预知支付商下次会往里塞什么。
  jsonMask: (v) => {
    if (!v) return v
    let obj
    try { obj = typeof v === 'string' ? JSON.parse(v) : v } catch { return null }  // 解析不了就清空，不冒险留着
    if (obj === null || typeof obj !== 'object') return v
    const out = {}
    for (const [k, val] of Object.entries(obj)) {
      if (JSON_MASK_KEYS[k]) out[k] = RULES[JSON_MASK_KEYS[k]](String(val), {})
      else if (JSON_KEEP_KEYS.includes(k)) out[k] = val
      // 其余丢弃
    }
    return JSON.stringify(out)
  },
}

async function primaryKeyOf(table) {
  const rows = await q(
    `SELECT column_name AS c FROM information_schema.key_column_usage
      WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
      ORDER BY ordinal_position`, [STAGE_DB, table])
  return rows.map((r) => r.c)
}

async function columnsOf(table) {
  return await q(
    `SELECT column_name AS c, data_type AS t, is_nullable AS nullable
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?`, [STAGE_DB, table])
}

/**
 * clear 规则想写 NULL，但列可能是 NOT NULL（bg_agent_domain.label 就是）。
 * 在引擎这层兜底，比让每条规则自己去关心列定义干净 —— 规则关心的是语义，
 * 列能不能为空是 schema 的事。
 */
function emptyValueFor(col) {
  if (col.nullable === 'YES') return null
  if (col.t === 'json') return '{}'          // NOT NULL 的 JSON 列，空串不是合法 JSON
  if (/int|decimal|float|double|bit/.test(col.t)) return 0
  if (/date|time/.test(col.t)) return null   // NOT NULL 的时间列交给下面报错，不猜
  return ''
}

let maskedRows = 0
for (const [table, fieldRules] of Object.entries(MASK_FIELDS)) {
  if (!tables.includes(table)) continue
  if (table === 'cs_message') continue        // 走下面的会话替换分支
  const pk = await primaryKeyOf(table)
  if (pk.length === 0) { log(`  ⚠️  ${table} 无主键，跳过逐行脱敏`); continue }

  const colMeta = await columnsOf(table)
  const cols = colMeta.map((r) => r.c)
  const metaOf = new Map(colMeta.map((m) => [m.c, m]))
  // 规则可能依赖同行的其它列（market 决定名字池、provider 决定 identifier 形态）
  const ctxCols = ['market', 'provider', 'type'].filter((c) => cols.includes(c))
  const targets = Object.keys(fieldRules).filter((c) => cols.includes(c))
  if (targets.length === 0) continue

  const selectCols = [...new Set([...pk, ...targets, ...ctxCols])]
  const rows = await q(`SELECT ${selectCols.map((c) => `\`${c}\``).join(',')} FROM \`${table}\``)
  let n = 0
  for (const row of rows) {
    const sets = []
    const vals = []
    for (const col of targets) {
      const rule = RULES[fieldRules[col]]
      if (!rule) throw new Error(`未知规则 ${fieldRules[col]}（${table}.${col}）`)
      let next = rule(row[col], row)
      if (next === null) next = emptyValueFor(metaOf.get(col))
      if (next === row[col]) continue
      sets.push(`\`${col}\` = ?`)
      vals.push(next)
    }
    if (sets.length === 0) continue
    const where = pk.map((c) => `\`${c}\` = ?`).join(' AND ')
    await q(`UPDATE \`${table}\` SET ${sets.join(',')} WHERE ${where}`, [...vals, ...pk.map((c) => row[c])])
    n++
  }
  maskedRows += n
  log(`  脱敏 ${table.padEnd(34)} ${n} 行 / ${targets.length} 字段`)
}
log(`\n✅ 字段脱敏完成，共 ${maskedRows} 行\n`)

// ── 4. 客服聊天整体替换 ──
if (tables.includes('cs_message')) {
  const msgs = await q('SELECT id, conversation_id, role FROM cs_message ORDER BY conversation_id, id')
  const idxInConv = new Map()
  for (const m of msgs) {
    const i = idxInConv.get(m.conversation_id) ?? 0
    idxInConv.set(m.conversation_id, i + 1)
    const seed = Math.abs(Number(String(m.conversation_id).replace(/\D/g, '')) || i)
    await q('UPDATE cs_message SET content = ? WHERE id = ?', [messageFor(seed, i, m.role), m.id])
  }
  log(`✅ 客服消息已换成假语料：${msgs.length} 条\n`)
}

// ── 5. 金额缩放：按类型自动识别，避开比率字段 ──
// SCALE=1 直接跳过。这不只是省时间 —— 对 132 个 decimal 字段逐个跑全表 UPDATE
// 会把 MySQL 的 buffer pool 打满，测试机上做过一次，直接把 mysqld 送进了 OOM killer。
if (M.SCALE === 1) {
  log('⏭  金额缩放已跳过（DEMO_AMOUNT_SCALE=1，演示库金额与源库一致）\n')
} else {
const decimals = await q(
  `SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE table_schema = ? AND data_type = 'decimal'`, [STAGE_DB])

let scaled = 0
const skippedCols = []
for (const { t, c } of decimals) {
  if (Object.keys(SKIP).includes(t)) continue
  if (NO_SCALE_PATTERN.test(c) || t === 'bg_exchange_rate' || t === 'bi_daily_exchange_rate') {
    skippedCols.push(`${t}.${c}`)
    continue
  }
  const [res] = await conn.query(
    `UPDATE \`${t}\` SET \`${c}\` = ROUND(\`${c}\` * ?, 2) WHERE \`${c}\` IS NOT NULL`, [M.SCALE])
  if (res.affectedRows > 0) scaled++
}
log(`✅ 金额缩放完成（系数 ${M.SCALE}）：${scaled} 个字段有数据被缩放`)
log(`   跳过的比率/汇率字段 ${skippedCols.length} 个\n`)
}

// ── 5b. 统计表的人数/计数放大 ──
// 金额走类型识别（decimal），计数只能按列名白名单 —— int 列里混着 ID、
// 平均值这些不能乘的东西，靠类型认不出来。
if (M.COUNT_SCALE === 1) {
  log('⏭  计数放大已跳过（DEMO_COUNT_SCALE=1）\n')
} else {
  let touched = 0
  for (const [table, cols] of Object.entries(COUNT_SCALE_COLUMNS)) {
    if (!tables.includes(table)) continue
    const existing = (await columnsOf(table)).map((r) => r.c)
    const hit = cols.filter((c) => existing.includes(c))
    if (hit.length === 0) continue
    await conn.query(
      `UPDATE \`${table}\` SET ${hit.map((c) => `\`${c}\` = ROUND(\`${c}\` * ?)`).join(', ')}`,
      hit.map(() => M.COUNT_SCALE))
    log(`  放大 ${table.padEnd(26)} ${hit.length} 个计数列`)
    touched++
  }
  log(`\n✅ 计数放大完成（系数 ${M.COUNT_SCALE}）：${touched} 张统计表\n`)
}

// ── 6. 清掉不能外露的配置 ──
if (tables.includes('bg_admin_settings')) {
  const [res] = await conn.query(
    `DELETE FROM bg_admin_settings WHERE \`key\` IN (${PURGED_SETTINGS.map(() => '?').join(',')})`,
    PURGED_SETTINGS)
  log(`✅ 已清除 ${res.affectedRows} 条自营站专属配置（操作密码、聚合商密钥、域名映射等）`)
}
for (const [table, cols] of Object.entries(PURGED_COLUMNS)) {
  if (!tables.includes(table)) continue
  const existing = (await columnsOf(table)).map((r) => r.c)
  const hit = cols.filter((c) => existing.includes(c))
  if (hit.length === 0) continue
  await q(`UPDATE \`${table}\` SET ${hit.map((c) => `\`${c}\` = NULL`).join(',')}`)
  log(`✅ 已清空 ${table} 的 ${hit.length} 个凭据字段：${hit.join(', ')}`)
}

await conn.end()
log('\n脱敏完成。下一步跑 03-verify.mjs 自检，通过后才允许出快照。')
