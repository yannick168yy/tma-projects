import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { hashPassword } from './admin-auth.service.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('provision')

/**
 * 新租户库要从自营库复制的「配置/参考」表。
 *
 * 🔴 这份白名单是开站安全的核心，加表前必须确认它不含任何单租户业务数据。
 * 反例：`admin_accounts` 一旦被复制，新租户就拿到了自营站的管理员账号。
 *
 * 判断标准：这张表的内容是「平台预置的默认配置」还是「该站运营产生的数据」。
 */
const SEED_TABLES = [
  // 全站配置与活动
  'bg_admin_settings',
  'bg_promo_config',
  'bg_turnover_requirements',
  'bg_game_turnover_rates',
  // 洗码 / 返水
  'bg_rebate_config',
  'bg_rebate_level_config',
  'bg_rebate_level_threshold',
  'bg_rebate_featured_game',
  // 充值档位
  'bg_firstdep_tiers',
  'bg_redep_tier',
  'bg_redep_offer',
  'bg_regular_redep_tier',
  // 转盘 / 任务（父表在前：bg_spin_prize 外键指向 bg_spin_deposit_rule）
  'bg_spin_deposit_rule',
  'bg_spin_prize',
  'bg_task_social',
  // 风控与团队
  'bg_risk_policy',
  'bg_team_config',
  // 首页装修默认版式
  'bg_home_content',
  // 游戏库（平台共享的参考数据，各租户可各自上下架）
  'bg_568win_provider',
  'bg_568win_game',
  'bg_568win_game_override',
] as const

/**
 * 明确不复制的表，写在这里是为了让「为什么没复制」有据可查，
 * 避免后来者以为是漏了而顺手加进白名单。
 */
export const SEED_EXCLUDED_REASON: Record<string, string> = {
  admin_accounts: '自营站管理员账号，复制等于把后台交给别人',
  bg_user: '用户数据',
  bg_bet_order: '注单数据',
  bg_deposit_order: '充值订单',
  bg_kyc: '实名信息',
  bg_exchange_rate: '5 万+ 行历史汇率，新站的定时任务会自己刷',
  bg_team_node: '团队网体，属运营数据',
  bg_agent_domain: '代理域名归因，属运营数据',
}

export interface ProvisionInput {
  code: string
  name: string
  markets: Array<{ market: string; currency: string; timezone: string }>
  domains: Array<{ domain: string; market: string }>
  planCode: string
  adminUsername: string
  adminPassword: string
  poolMin?: number
  poolMax?: number
}

export interface ProvisionResult {
  tenantId: number
  database: string
  tables: number
  seededRows: Record<string, number>
  smoke: { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }
}

const CODE_RE = /^[a-z][a-z0-9]{2,15}$/

/**
 * 开站要建库，而应用账号没有全局 CREATE（只有各业务库的 ALL）。
 * 单独用一个开站账号，凭据只存在环境变量里 —— 不给应用账号全局 CREATE，
 * 是为了让「被拿下应用」和「能创建/删除任意库」之间隔一道。
 *
 * 该账号**不需要 GRANT OPTION**：应用账号的库权限用通配 `betogo\_%`.* 一次性授好，
 * 新库自动覆盖。带 GRANT OPTION 的账号等同 root。
 */
async function provisionConnection(): Promise<Connection> {
  const user = process.env.MYSQL_PROVISION_USER?.trim()
  const password = process.env.MYSQL_PROVISION_PASSWORD
  if (!user || !password) {
    throw new Error('未配置 MYSQL_PROVISION_USER / MYSQL_PROVISION_PASSWORD，开站功能不可用')
  }
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user,
    password,
    multipleStatements: true,
    charset: 'UTF8MB4_UNICODE_CI',
  })
}

function sourceDatabase(): string {
  return process.env.MYSQL_DATABASE ?? 'betogo'
}

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  if (!CODE_RE.test(input.code)) {
    throw new Error('租户代号需为 3-16 位小写字母数字且以字母开头')
  }
  const database = `betogo_${input.code}`
  const platform = getPlatformPool()

  const [dup] = await platform.query<RowDataPacket[]>(
    'SELECT id FROM pf_tenant WHERE code = ? OR db_name = ? LIMIT 1', [input.code, database])
  if (dup[0]) throw new Error('租户代号或库名已被占用')

  const domains = input.domains.map((d) => ({ ...d, domain: d.domain.trim().toLowerCase().replace(/^www\./, '') }))
  const [dupDomain] = await platform.query<RowDataPacket[]>(
    `SELECT domain FROM pf_tenant_domain WHERE domain IN (${domains.map(() => '?').join(',')}) LIMIT 1`,
    domains.map((d) => d.domain))
  if (dupDomain[0]) throw new Error(`域名已被占用：${dupDomain[0].domain}`)

  const conn = await provisionConnection()
  const seededRows: Record<string, number> = {}
  let tables = 0
  let step = '连接'
  const at = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    step = label
    return fn()
  }
  try {
    const [exists] = await at('检查库是否已存在', () => conn.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]))
    if (exists[0]) throw new Error(`库 ${database} 已存在，请先人工确认后再开站`)

    await at('建库', () => conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`))
    // 这里刻意不做 GRANT：应用账号已通过通配库授权 `betogo\_%`.* 覆盖所有租户库
    // （见 scripts/setup-provision-account.sh）。给开站账号 GRANT OPTION
    // 等于给它 root 等价权限，不值得为省一次授权而引入。

    // 结构基线：历史迁移链无法从 001 重放（008 起依赖后续才补的列），只能走基线
    const baselinePath = process.env.SCHEMA_BASELINE_PATH ?? '/app/infra/database/betogo/schema_baseline.sql'
    const baseline = await readFile(baselinePath, 'utf8').catch(() => {
      throw new Error(`读不到结构基线 ${baselinePath}，请确认容器已挂载 infra/database`)
    })
    await at('切换到新库', () => conn.query(`USE \`${database}\``))
    await at('应用结构基线', () => conn.query(baseline))

    const [tableRows] = await at('统计表数', () => conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]))
    tables = Number(tableRows[0].n)
    if (tables < 100) throw new Error(`基线应用异常：只建出 ${tables} 张表`)

    // 种子：从自营库复制配置类表。跨库 INSERT...SELECT，永远反映当前默认配置，
    // 不需要维护一份会过期的种子文件
    const src = sourceDatabase()
    // 复制期间关外键检查：种子表之间有外键依赖，靠人工维护插入顺序迟早会错，
    // 而源库本身是一致的，整批复制过来不会产生脏引用。
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of SEED_TABLES) {
      try {
        const [res] = await conn.query(
          `INSERT INTO \`${database}\`.\`${table}\` SELECT * FROM \`${src}\`.\`${table}\``)
        seededRows[table] = (res as { affectedRows?: number }).affectedRows ?? 0
      } catch (err) {
        // 单张种子表失败不该让整个开站回滚，但必须记下来供人工补
        log.warn({ err, table, database }, '种子表复制失败')
        seededRows[table] = -1
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1')

    // 用户 ID 序列必须初始化，否则新站第一个注册用户拿不到 id
    await conn.query(
      `INSERT IGNORE INTO \`${database}\`.bg_user_id_seq SELECT * FROM \`${src}\`.bg_user_id_seq`).catch(() => {})

    // 该租户自己的后台超管
    const adminHash = await hashPassword(input.adminPassword)
    await at('创建租户后台超管', () => conn.query(
      `INSERT INTO \`${database}\`.admin_accounts (username, password_hash, role, status)
       VALUES (?, ?, 'super_admin', 'active')`,
      [input.adminUsername, adminHash],
    ))
  } catch (err) {
    // 失败即回滚建库，避免留下半成品库挡住重试
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {})
    await conn.end()
    const detail = err instanceof Error ? err.message : String(err)
    log.error({ err, step, database }, '开站失败')
    throw new Error(`开站失败于「${step}」：${detail}`)
  }

  // 平台库登记
  const [ins] = await platform.execute(
    `INSERT INTO pf_tenant (code, name, db_name, status, self_operated, pool_min, pool_max)
     VALUES (?, ?, ?, 'trial', 0, ?, ?)`,
    [input.code, input.name, database, input.poolMin ?? 2, input.poolMax ?? 4],
  )
  const tenantId = (ins as { insertId: number }).insertId

  for (const m of input.markets) {
    await platform.execute(
      'INSERT INTO pf_tenant_market (tenant_id, market, currency, timezone) VALUES (?, ?, ?, ?)',
      [tenantId, m.market, m.currency, m.timezone])
  }
  for (const d of domains) {
    await platform.execute(
      'INSERT INTO pf_tenant_domain (tenant_id, domain, market, purpose) VALUES (?, ?, ?, \'site\')',
      [tenantId, d.domain, d.market])
  }
  await platform.execute(
    `INSERT INTO pf_tenant_plan (tenant_id, plan_id) SELECT ?, id FROM pf_plan WHERE code = ?`,
    [tenantId, input.planCode])

  const smoke = await smokeCheck(conn, database, tenantId)
  // 种子表失败会让新站功能残缺（比如转盘没奖品），必须计入冒烟结论，
  // 否则接口会在有失败项的情况下报「全部通过」
  const failedSeeds = Object.entries(seededRows).filter(([, n]) => n < 0).map(([t]) => t)
  smoke.checks.push({
    name: '种子配置',
    ok: failedSeeds.length === 0,
    detail: failedSeeds.length === 0
      ? `${Object.keys(seededRows).length} 张表全部成功`
      : `失败：${failedSeeds.join('、')}`,
  })
  smoke.ok = smoke.checks.every((c) => c.ok)
  await conn.end()

  log.info({ tenantId, database, tables, smokeOk: smoke.ok }, '开站完成')
  return { tenantId, database, tables, seededRows, smoke }
}

/** 开站自检：只查「站点能不能正常起来」的几项，不通过要在返回里明确暴露 */
async function smokeCheck(conn: Connection, database: string, tenantId: number): Promise<ProvisionResult['smoke']> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const one = async (name: string, sql: string, min: number) => {
    try {
      const [rows] = await conn.query<RowDataPacket[]>(sql)
      const n = Number(Object.values(rows[0])[0])
      checks.push({ name, ok: n >= min, detail: `${n}（需 ≥ ${min}）` })
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) })
    }
  }
  await one('表结构', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}'`, 100)
  await one('全站配置', `SELECT COUNT(*) FROM \`${database}\`.bg_admin_settings`, 1)
  await one('活动配置', `SELECT COUNT(*) FROM \`${database}\`.bg_promo_config`, 1)
  await one('游戏库', `SELECT COUNT(*) FROM \`${database}\`.bg_568win_game`, 1)
  await one('后台管理员', `SELECT COUNT(*) FROM \`${database}\`.admin_accounts`, 1)
  await one('用户表为空', `SELECT 1 - LEAST(COUNT(*),1) FROM \`${database}\`.bg_user`, 1)
  await one('注单表为空', `SELECT 1 - LEAST(COUNT(*),1) FROM \`${database}\`.bg_bet_order`, 1)
  const [dom] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM pf_tenant_domain WHERE tenant_id = ?', [tenantId])
  checks.push({ name: '域名登记', ok: Number(dom[0].n) > 0, detail: `${dom[0].n} 条` })
  return { ok: checks.every((c) => c.ok), checks }
}
