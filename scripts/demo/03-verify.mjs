#!/usr/bin/env node
/**
 * 脱敏结果自检。不通过就不允许出快照 —— 这是数据外发前的最后一道闸。
 *
 * 检查的是"还能不能看出真实信息"，不是"脚本有没有跑完"。
 * 脚本跑完但漏了一张表，靠 02 的日志是看不出来的。
 */
import { createRequire } from 'node:module'
import { SKIP, MASK_FIELDS, PURGED_SETTINGS } from './config.mjs'
import { SCRIPTS } from './lib/conversations.mjs'

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

const DB = process.env.STAGE_DB
if (!DB) { console.error('需要 STAGE_DB'); process.exit(1) }

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD,
  database: DB,
  charset: 'UTF8MB4_UNICODE_CI',
})
const q = async (sql, p) => (await conn.query(sql, p))[0]

const fails = []
const warns = []
const ok = []
const check = (name, passed, detail) => {
  if (passed) ok.push(name)
  else fails.push(`${name}：${detail}`)
}

const tables = (await q(
  'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [DB])).map((r) => r.t)

// 1. SKIP 表必须为空
for (const t of Object.keys(SKIP)) {
  if (!tables.includes(t)) continue
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM \`${t}\``)
  check(`SKIP 表 ${t} 已清空`, n === 0, `仍有 ${n} 行`)
}

// 2. 真实邮箱域名残留。演示库里所有邮箱都该是 @demo-mail.com
if (tables.includes('bg_user')) {
  const rows = await q(
    `SELECT COUNT(*) AS n FROM bg_user WHERE email IS NOT NULL AND email NOT LIKE '%@demo-mail.com'`)
  check('无真实邮箱残留', rows[0].n === 0, `${rows[0].n} 条邮箱不是 demo 域名`)
}

// 3. 常见真实邮箱服务商特征（跨全库扫，防止漏表）
for (const t of tables) {
  if (Object.keys(SKIP).includes(t)) continue
  const cols = await q(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND data_type IN ('varchar','text','mediumtext','longtext')`,
    [DB, t])
  for (const { c } of cols) {
    const [{ n }] = await q(
      `SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${c}\` REGEXP '@(gmail|yahoo|hotmail|outlook|qq|163|foxmail)\\\\.'`)
    if (n > 0) fails.push(`真实邮箱特征残留：${t}.${c} 有 ${n} 行`)
  }
}

// 4. 被 purge 的配置键确实不在了
if (tables.includes('bg_admin_settings')) {
  const rows = await q(
    `SELECT \`key\` FROM bg_admin_settings WHERE \`key\` IN (${PURGED_SETTINGS.map(() => '?').join(',')})`,
    PURGED_SETTINGS)
  check('自营站专属配置已清除', rows.length === 0, `仍存在：${rows.map((r) => r.key).join(', ')}`)
}

// 5. 客服消息必须全部来自语料库
if (tables.includes('cs_message')) {
  const corpus = new Set(SCRIPTS.flat().map(([, text]) => text))
  const rows = await q('SELECT id, content FROM cs_message')
  const foreign = rows.filter((r) => r.content && !corpus.has(r.content))
  check('客服消息全部来自假语料', foreign.length === 0,
    `${foreign.length} 条不在语料库中（示例 id=${foreign[0]?.id}）`)
}

// 6. 外键一致性：脱敏不该动 id，动了就会出现查不到用户的孤儿订单
for (const t of ['bg_deposit_order', 'bg_withdraw_order', 'bg_bet_order', 'bg_wallet']) {
  if (!tables.includes(t) || !tables.includes('bg_user')) continue
  const [{ n }] = await q(
    `SELECT COUNT(*) AS n FROM \`${t}\` o LEFT JOIN bg_user u ON u.id = o.user_id WHERE u.id IS NULL`)
  check(`${t} 无孤儿记录`, n === 0, `${n} 行的 user_id 在 bg_user 里不存在`)
}

// 7. 脱敏字段抽样展示，供人工过目 —— 自动检查覆盖不到"看起来像不像真的"
const samples = []
for (const [t, rules] of Object.entries(MASK_FIELDS)) {
  if (!tables.includes(t)) continue
  const cols = Object.keys(rules)
  const exist = (await q(
    `SELECT column_name AS c FROM information_schema.columns WHERE table_schema=? AND table_name=?`,
    [DB, t])).map((r) => r.c)
  const use = cols.filter((c) => exist.includes(c)).slice(0, 3)
  if (use.length === 0) continue
  const rows = await q(`SELECT ${use.map((c) => `\`${c}\``).join(',')} FROM \`${t}\` WHERE ${use[0]} IS NOT NULL LIMIT 2`)
  for (const r of rows) samples.push(`  ${t.padEnd(26)} ${JSON.stringify(r)}`)
}

console.log('\n【脱敏抽样】人工过一遍，确认看起来像真数据：')
console.log(samples.slice(0, 25).join('\n'))
console.log(`\n【自检结果】通过 ${ok.length} 项`)
if (warns.length) { console.log('\n⚠️  警告：'); warns.forEach((w) => console.log('  ' + w)) }
if (fails.length) {
  console.log(`\n❌ 失败 ${fails.length} 项：`)
  fails.forEach((f) => console.log('  ' + f))
  console.log('\n🔴 自检未通过，禁止出快照。')
  await conn.end()
  process.exit(1)
}
console.log('\n✅ 自检全部通过，可以出快照。')
await conn.end()
