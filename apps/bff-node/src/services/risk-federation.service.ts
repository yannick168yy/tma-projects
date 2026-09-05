import { createHmac } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getDefaultRedis } from '../clients/redis.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'
import { forEachTenant } from './tenant-jobs.js'

const log = childLogger('risk-federation')

export type IdentityType = 'device' | 'phone' | 'bank_card' | 'ip' | 'id_no'
export type FederationSeverity = 'watch' | 'escalate' | 'deny'

export const IDENTITY_TYPES: IdentityType[] = ['device', 'phone', 'bank_card', 'ip', 'id_no']

const CACHE_KEY = 'platform:risk-federation:hashes'
const CACHE_TTL_SECONDS = 60

/**
 * 归一化：同一个值在不同租户库里的写法不一样（手机号带不带国码、卡号带不带空格），
 * 不归一化就等于联防不生效 —— 而且是静默不生效。
 */
export function normalizeIdentity(type: IdentityType, raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  switch (type) {
    case 'phone':
      // 只留数字，去掉国际前缀 0/62/63 的写法差异靠取后 10 位兜住
      return v.replace(/\D/g, '').slice(-10)
    case 'bank_card':
      return v.replace(/[\s-]/g, '').toLowerCase()
    case 'ip':
      return v.replace(/^::ffff:/i, '').toLowerCase()
    case 'id_no':
      return v.replace(/[\s-]/g, '').toUpperCase()
    case 'device':
      return v.toLowerCase()
  }
}

function pepper(): string {
  return (process.env.RISK_FEDERATION_PEPPER ?? '').trim()
}

/** 没配 pepper 时联防整体关闭：手机号只有 10 位数字，不加盐的摘要能被穷举反查 */
export function federationEnabled(): boolean {
  return pepper().length >= 16
}

export function hashIdentity(type: IdentityType, raw: string): string | null {
  const norm = normalizeIdentity(type, raw)
  if (!norm || !federationEnabled()) return null
  return createHmac('sha256', pepper()).update(`${type}:${norm}`).digest('hex')
}

/** 掩码：保留尾 4 位够运营核对，又不足以还原原值 */
export function hintOf(type: IdentityType, raw: string): string {
  const norm = normalizeIdentity(type, raw)
  if (norm.length <= 4) return '*'.repeat(norm.length)
  if (type === 'ip') {
    const parts = norm.split('.')
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : `${norm.slice(0, 6)}***`
  }
  return `****${norm.slice(-4)}`
}

export interface FederationMatch {
  idType: IdentityType
  valueHash: string
  severity: FederationSeverity
  reason: string
  hint: string | null
}

/**
 * 名单摘要集缓存：登录这种高频管控点不能每次都打平台库。
 * 缓存 60s —— 上名单要立刻生效的场景（正在被刷的团伙）等一分钟可以接受，
 * 换成实时查库则是给每次登录加一次跨库往返。
 */
async function loadHashSet(env: Env): Promise<Map<string, FederationMatch>> {
  const redis = getDefaultRedis(env)
  try {
    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      return new Map(Object.entries(JSON.parse(cached) as Record<string, FederationMatch>))
    }
  } catch (err) {
    log.warn({ err }, '联防名单缓存读取失败，回落查库')
  }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT id_type, value_hash, severity, reason, value_hint FROM pf_risk_blacklist
      WHERE expires_at IS NULL OR expires_at > NOW(3)`)
  const map = new Map<string, FederationMatch>()
  for (const r of rows) {
    map.set(`${r.id_type}:${r.value_hash}`, {
      idType: r.id_type as IdentityType,
      valueHash: String(r.value_hash),
      severity: r.severity as FederationSeverity,
      reason: String(r.reason),
      hint: (r.value_hint as string | null) ?? null,
    })
  }
  await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(Object.fromEntries(map)))
    .catch((err: unknown) => log.warn({ err }, '联防名单缓存写入失败'))
  return map
}

export async function invalidateFederationCache(env: Env): Promise<void> {
  await getDefaultRedis(env).del(CACHE_KEY).catch((err: unknown) => log.warn({ err }, '联防缓存失效失败'))
}

const SEVERITY_RANK: Record<FederationSeverity, number> = { watch: 0, escalate: 1, deny: 2 }

/** 命中最严重的一条。多项同时命中（同设备同手机号）时以最严重为准 */
export async function matchFederation(env: Env, values: Partial<Record<IdentityType, string>>): Promise<FederationMatch | null> {
  if (!federationEnabled()) return null
  const set = await loadHashSet(env)
  if (set.size === 0) return null
  let worst: FederationMatch | null = null
  for (const type of IDENTITY_TYPES) {
    const raw = values[type]
    if (!raw) continue
    const hash = hashIdentity(type, raw)
    if (!hash) continue
    const hit = set.get(`${type}:${hash}`)
    if (hit && (!worst || SEVERITY_RANK[hit.severity] > SEVERITY_RANK[worst.severity])) worst = hit
  }
  return worst
}

/** 命中要留痕：否则没法回答「这条名单到底拦住了什么」，也没法判断该不该降级或删掉 */
export async function recordFederationHit(
  tenantId: number, match: FederationMatch, checkpoint: string, action: string,
): Promise<void> {
  const pool = getPlatformPool()
  await Promise.all([
    pool.execute(
      `INSERT INTO pf_risk_hit (tenant_id, id_type, value_hash, checkpoint, action) VALUES (?,?,?,?,?)`,
      [tenantId, match.idType, match.valueHash, checkpoint, action]),
    pool.execute(
      `UPDATE pf_risk_blacklist SET hit_count = hit_count + 1, last_hit_at = NOW(3)
        WHERE id_type = ? AND value_hash = ?`, [match.idType, match.valueHash]),
  ]).catch((err) => log.warn({ err }, '联防命中留痕失败'))
}

// ── 名单维护 ────────────────────────────────────────────────────────────────

export interface BlacklistInput {
  idType: IdentityType
  /** 明文只在这一次请求里出现，落库只留摘要 */
  rawValue: string
  severity: FederationSeverity
  reason: string
  sourceTenantId?: number | null
  expiresAt?: string | null
}

export async function addToBlacklist(env: Env, input: BlacklistInput, adminId: number | null): Promise<{ hash: string }> {
  const hash = hashIdentity(input.idType, input.rawValue)
  if (!hash) throw new Error('未配置 RISK_FEDERATION_PEPPER 或值为空，无法加入联防名单')
  await getPlatformPool().execute(
    `INSERT INTO pf_risk_blacklist
       (id_type, value_hash, value_hint, severity, reason, source_tenant_id, created_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), reason = VALUES(reason),
       expires_at = VALUES(expires_at)`,
    [input.idType, hash, hintOf(input.idType, input.rawValue), input.severity, input.reason,
     input.sourceTenantId ?? null, adminId, input.expiresAt ?? null])
  await invalidateFederationCache(env)
  return { hash }
}

/** 从跨租户身份榜直接拉黑：那边只有摘要，没有明文可再哈希一次 */
export async function addHashToBlacklist(
  env: Env, idType: IdentityType, valueHash: string, hint: string | null,
  severity: FederationSeverity, reason: string, adminId: number | null,
): Promise<void> {
  await getPlatformPool().execute(
    `INSERT INTO pf_risk_blacklist (id_type, value_hash, value_hint, severity, reason, created_by)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), reason = VALUES(reason)`,
    [idType, valueHash, hint, severity, reason, adminId])
  await invalidateFederationCache(env)
}

export async function removeFromBlacklist(env: Env, id: number): Promise<boolean> {
  const [res] = await getPlatformPool().execute('DELETE FROM pf_risk_blacklist WHERE id = ?', [id])
  await invalidateFederationCache(env)
  return (res as { affectedRows: number }).affectedRows > 0
}

export async function listBlacklist(): Promise<Array<{
  id: number; idType: string; valueHint: string | null; severity: string; reason: string
  sourceTenantCode: string | null; hitCount: number; lastHitAt: string | null
  expiresAt: string | null; createdAt: string
}>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT b.id, b.id_type, b.value_hint, b.severity, b.reason, b.hit_count, b.last_hit_at,
            b.expires_at, b.created_at, t.code AS source_code
       FROM pf_risk_blacklist b
       LEFT JOIN pf_tenant t ON t.id = b.source_tenant_id
      ORDER BY b.hit_count DESC, b.id DESC LIMIT 500`)
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))
  return rows.map((r) => ({
    id: r.id,
    idType: r.id_type,
    valueHint: r.value_hint,
    severity: r.severity,
    reason: r.reason,
    sourceTenantCode: r.source_code ?? null,
    hitCount: Number(r.hit_count),
    lastHitAt: iso(r.last_hit_at),
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at) ?? '',
  }))
}

// ── 跨租户身份抽数与撞库识别 ──────────────────────────────────────────────

/**
 * 抽当前租户的身份摘要写进平台库。
 *
 * 只抽「稳定且能唯一指向一个自然人」的四类：注册设备、登录手机号、提现收款账号、证件号。
 * IP 不抽 —— 家用宽带的动态 IP 会把同城玩家全串成一伙，噪声大到没法用，
 * 但仍保留 ip 类型：平台手工拉黑某个机房出口 IP 是有意义的。
 */
export async function collectTenantIdentities(env: Env): Promise<number> {
  const tenant = currentTenantOrNull()
  if (!tenant || !federationEnabled()) return 0
  const db = getMysqlPool(env)
  const batch: Array<{ type: IdentityType; raw: string; users: number }> = []

  const [devices] = await db.query<RowDataPacket[]>(
    `SELECT register_device_id AS v, COUNT(*) AS n FROM bg_user
      WHERE register_device_id IS NOT NULL AND register_device_id <> '' GROUP BY register_device_id`)
  for (const r of devices) batch.push({ type: 'device', raw: String(r.v), users: Number(r.n) })

  const [phones] = await db.query<RowDataPacket[]>(
    `SELECT identifier AS v, COUNT(DISTINCT user_id) AS n FROM bg_user_identity
      WHERE provider = 'phone' GROUP BY identifier`)
  for (const r of phones) batch.push({ type: 'phone', raw: String(r.v), users: Number(r.n) })

  const [ids] = await db.query<RowDataPacket[]>(
    `SELECT extracted_id_no AS v, COUNT(DISTINCT user_id) AS n FROM bg_kyc
      WHERE extracted_id_no IS NOT NULL AND extracted_id_no <> '' GROUP BY extracted_id_no`)
  for (const r of ids) batch.push({ type: 'id_no', raw: String(r.v), users: Number(r.n) })

  // 收款账号在提现单的 extra 里（没有独立的收款人表）；只看近 90 天，老单没有联防价值
  const [accounts] = await db.query<RowDataPacket[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(extra, '$.targetAccount')) AS v, COUNT(DISTINCT user_id) AS n
       FROM bg_withdraw_order
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND JSON_EXTRACT(extra, '$.targetAccount') IS NOT NULL
      GROUP BY v`)
  for (const r of accounts) {
    if (r.v && r.v !== 'null') batch.push({ type: 'bank_card', raw: String(r.v), users: Number(r.n) })
  }

  if (batch.length === 0) return 0
  const pool = getPlatformPool()
  let written = 0
  // 分批 upsert：单条一次往返在几万行时会跑很久
  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200)
      .map((x) => ({ ...x, hash: hashIdentity(x.type, x.raw), hint: hintOf(x.type, x.raw) }))
      .filter((x) => x.hash)
    if (chunk.length === 0) continue
    const values = chunk.map(() => '(?,?,?,?,?)').join(',')
    const params = chunk.flatMap((x) => [x.type, x.hash, tenant.id, x.hint, x.users])
    await pool.execute(
      `INSERT INTO pf_risk_identity (id_type, value_hash, tenant_id, value_hint, user_count)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE user_count = VALUES(user_count), value_hint = VALUES(value_hint),
         last_seen = NOW(3)`, params)
    written += chunk.length
  }
  log.info({ tenant: tenant.code, written }, '身份摘要已抽数')
  return written
}

export async function runIdentityCollection(env: Env): Promise<void> {
  if (!federationEnabled()) {
    log.warn('未配置 RISK_FEDERATION_PEPPER，跨租户联防未启用')
    return
  }
  await forEachTenant('risk-identity', async () => { await collectTenantIdentities(env) })
}

export interface CrossTenantRow {
  idType: string
  valueHash: string
  valueHint: string | null
  tenantCount: number
  userTotal: number
  tenants: string[]
  blacklisted: boolean
  lastSeen: string
}

/**
 * 撞库识别：同一个身份摘要出现在 N 家以上租户。
 * 这是包网平台独有的信号 —— 单个客户站自己永远看不到「这个设备在另外三家也在刷」。
 */
export async function crossTenantIdentities(minTenants = 2, idType?: IdentityType): Promise<CrossTenantRow[]> {
  const params: unknown[] = []
  let typeFilter = ''
  if (idType) { typeFilter = 'AND i.id_type = ?'; params.push(idType) }
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT i.id_type, i.value_hash, MAX(i.value_hint) AS value_hint,
            COUNT(DISTINCT i.tenant_id) AS tenant_count, SUM(i.user_count) AS user_total,
            GROUP_CONCAT(DISTINCT t.code ORDER BY t.code) AS tenants,
            MAX(i.last_seen) AS last_seen,
            EXISTS(SELECT 1 FROM pf_risk_blacklist b
                    WHERE b.id_type = i.id_type AND b.value_hash = i.value_hash) AS blacklisted
       FROM pf_risk_identity i JOIN pf_tenant t ON t.id = i.tenant_id
      WHERE 1 = 1 ${typeFilter}
      GROUP BY i.id_type, i.value_hash
     HAVING tenant_count >= ?
      ORDER BY tenant_count DESC, user_total DESC LIMIT 200`, [...params, minTenants])
  return rows.map((r) => ({
    idType: r.id_type,
    valueHash: String(r.value_hash),
    valueHint: r.value_hint,
    tenantCount: Number(r.tenant_count),
    userTotal: Number(r.user_total),
    tenants: String(r.tenants ?? '').split(',').filter(Boolean),
    blacklisted: Number(r.blacklisted) === 1,
    lastSeen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
  }))
}
