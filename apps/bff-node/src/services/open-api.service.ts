import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { childLogger } from '../lib/logger.js'
import type { TenantContext } from '../lib/tenant-context.js'
import { tenantById } from './tenant.service.js'

const log = childLogger('open-api')

/**
 * 开放 API 密钥（P3-7）。
 *
 * key 形如 `bgk<9位十六进制>.<随机密钥>`：前缀明文存库用于定位是哪一把，
 * 密钥只存 sha256 摘要。API key 是高熵随机串，不需要慢哈希（撞不出来），
 * 但明文存库等于一次拖库就把所有客户的数据接口一起交出去。
 *
 * v1 只给读权限。写接口（调余额、改配置）不开：那是资损面，需要比「一把 key」
 * 更强的授权设计（二次确认、IP 白名单、操作密码），而客户目前的需求都是拉数据。
 */
export const API_SCOPES = [
  'users:read', 'orders:read', 'bets:read', 'billing:read', 'stats:read',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

export const SCOPE_LABEL: Record<ApiScope, string> = {
  'users:read': '用户列表与明细',
  'orders:read': '充值 / 提现订单',
  'bets:read': '注单流水',
  'billing:read': '平台账单与对账明细',
  'stats:read': '每日经营数据',
}

export interface ApiKeyRow {
  id: number
  name: string
  keyPrefix: string
  scopes: ApiScope[]
  ratePerMin: number
  ipAllowlist: string[]
  enabled: boolean
  lastUsedAt: string | null
  lastUsedIp: string | null
  expiresAt: string | null
  createdBy: string | null
  createdAt: string
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))

function mapKey(r: RowDataPacket): ApiKeyRow {
  return {
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    scopes: String(r.scopes ?? '').split(',').filter(Boolean) as ApiScope[],
    ratePerMin: Number(r.rate_per_min),
    ipAllowlist: String(r.ip_allowlist ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    enabled: r.enabled === 1,
    lastUsedAt: iso(r.last_used_at),
    lastUsedIp: r.last_used_ip,
    expiresAt: iso(r.expires_at),
    createdBy: r.created_by,
    createdAt: iso(r.created_at) ?? '',
  }
}

export async function listApiKeys(tenantId: number): Promise<ApiKeyRow[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT * FROM pf_api_key WHERE tenant_id = ? ORDER BY id DESC', [tenantId])
  return rows.map(mapKey)
}

export async function listAllApiKeys(): Promise<Array<ApiKeyRow & { tenantCode: string }>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT k.*, t.code AS tenant_code FROM pf_api_key k JOIN pf_tenant t ON t.id = k.tenant_id
      ORDER BY k.enabled DESC, k.id DESC LIMIT 300`)
  return rows.map((r) => ({ ...mapKey(r), tenantCode: String(r.tenant_code) }))
}

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')

/**
 * 建一把 key。**完整 key 只在这一次返回**，之后拿不到 —— 库里只有摘要。
 * 丢了只能吊销重建，这比「随时能查看」安全得多：能查看意味着任何一个能进后台的人
 * 都能拿走全部 key。
 */
export async function createApiKey(tenantId: number, input: {
  name: string
  scopes: ApiScope[]
  ratePerMin: number
  ipAllowlist: string[]
  expiresAt: string | null
  createdBy: string | null
}): Promise<{ key: string; row: ApiKeyRow }> {
  const prefix = `bgk${randomBytes(5).toString('hex').slice(0, 9)}`
  const secret = randomBytes(24).toString('base64url')
  const full = `${prefix}.${secret}`
  const [res] = await getPlatformPool().execute(
    `INSERT INTO pf_api_key (tenant_id, name, key_prefix, key_hash, scopes, rate_per_min, ip_allowlist, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [tenantId, input.name, prefix, hash(full), input.scopes.join(','), input.ratePerMin,
     input.ipAllowlist.join(',') || null, input.expiresAt, input.createdBy])
  const id = (res as { insertId: number }).insertId
  const [rows] = await getPlatformPool().query<RowDataPacket[]>('SELECT * FROM pf_api_key WHERE id = ?', [id])
  log.info({ tenantId, id, prefix }, '开放 API 密钥已创建')
  return { key: full, row: mapKey(rows[0]) }
}

/** 吊销即置 enabled=0，记录保留：谁什么时候开的、最后用在哪，出事要查得到 */
export async function revokeApiKey(tenantId: number, id: number): Promise<boolean> {
  const [res] = await getPlatformPool().execute(
    'UPDATE pf_api_key SET enabled = 0 WHERE id = ? AND tenant_id = ?', [id, tenantId])
  return (res as { affectedRows: number }).affectedRows > 0
}

/** 平台侧吊销：不带 tenant 限制，用于客户 key 泄露时平台先行处置 */
export async function revokeApiKeyByPlatform(id: number): Promise<boolean> {
  const [res] = await getPlatformPool().execute('UPDATE pf_api_key SET enabled = 0 WHERE id = ?', [id])
  return (res as { affectedRows: number }).affectedRows > 0
}

export interface VerifiedKey {
  id: number
  tenant: TenantContext
  scopes: ApiScope[]
  ratePerMin: number
  keyPrefix: string
}

export interface VerifyFailure {
  ok: false
  reason: 'missing' | 'malformed' | 'unknown' | 'disabled' | 'expired' | 'ip'
}

/**
 * 校验 key。失败原因分类返回而不是统一 401：
 * 「IP 不在白名单」与「key 不存在」对客户是完全不同的排查方向，都回 401
 * 会让客户反复怀疑自己抄错了 key。
 * 但**不**区分「摘要不匹配」与「前缀不存在」—— 那会变成枚举前缀的信道。
 */
export async function verifyApiKey(raw: string | undefined, ip: string): Promise<VerifiedKey | VerifyFailure> {
  if (!raw) return { ok: false, reason: 'missing' }
  const [prefix, secret] = raw.split('.')
  if (!prefix || !secret) return { ok: false, reason: 'malformed' }

  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT * FROM pf_api_key WHERE key_prefix = ? LIMIT 1', [prefix]) as unknown as [RowDataPacket[]]
  if (!row) return { ok: false, reason: 'unknown' }

  const expected = Buffer.from(String(row.key_hash), 'hex')
  const actual = Buffer.from(hash(raw), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'unknown' }
  }
  if (row.enabled !== 1) return { ok: false, reason: 'disabled' }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  const allow = String(row.ip_allowlist ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allow.length > 0 && !allow.includes(ip)) return { ok: false, reason: 'ip' }

  const tenant = await tenantById(Number(row.tenant_id))
  if (!tenant) return { ok: false, reason: 'unknown' }
  // 关站的租户连自己的数据也别拉了：站已经停了，继续给数据只会让人以为还在服务
  if (tenant.status === 'closed') return { ok: false, reason: 'disabled' }

  // 最后使用时间异步更新：每次请求多一次同步写库，开放 API 的吞吐会被这条写卡住
  void getPlatformPool().execute(
    'UPDATE pf_api_key SET last_used_at = NOW(3), last_used_ip = ? WHERE id = ?', [ip, row.id])
    .catch(() => { /* 记不上不影响调用 */ })

  return {
    id: row.id,
    tenant,
    scopes: String(row.scopes ?? '').split(',').filter(Boolean) as ApiScope[],
    ratePerMin: Number(row.rate_per_min),
    keyPrefix: prefix,
  }
}

export function isApiScope(v: unknown): v is ApiScope {
  return typeof v === 'string' && (API_SCOPES as readonly string[]).includes(v)
}
