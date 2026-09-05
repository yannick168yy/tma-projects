import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { decryptCredential, encryptCredential, maskCredential } from './platform-credential.service.js'

const log = childLogger('tenant-integration')

/**
 * P1-5 收尾：租户的外部对接配置（聚合商子代理 / 支付通道）。
 *
 * 「自动注册」这一步做不到也不该做：在 568win 那边开一个子代理、在支付商那边开一个商户号，
 * 都是线下签约动作，没有对外的开户 API。能自动化的是**登记之后的一切** ——
 * 平台后台录一次，下发到租户库，开站流程自动带上，不再有人肉改配置那一步。
 */

export interface TenantProvider {
  provider: string
  agentAccount: string
  status: 'pending' | 'active' | 'disabled'
  /** 只回掩码，明文永远不出平台库 */
  companyKeyMask: string | null
  serverId: string | null
  remark: string | null
}

interface ProviderSecret {
  companyKey: string
  serverId: string
}

export interface TenantChannel {
  channelCode: string
  owner: 'platform' | 'tenant'
  merchantNo: string | null
  credentialMask: string | null
  enabled: boolean
  sortOrder: number
  /** 平台代收通道的手续费率（%）。进 GGR 扣减项，账单要靠它算净收益（P2-7） */
  feeRatePct: number
  feeFixed: number
}

// 租户库里存 win568 凭据的位置。与 core-node 的 win568-key-settings.service 同名，
// 改这里必须同步改那边，否则下发完照样用的是平台那把 key
const WIN568_COMPANY_KEY_SETTING = 'win568_operation_company_key'
const WIN568_SERVER_ID_SETTING = 'win568_server_id'

function decodeSecret(cipher: string | null, iv: string | null): ProviderSecret | null {
  if (!cipher || !iv) return null
  try {
    const parsed = JSON.parse(decryptCredential(cipher, iv)) as Partial<ProviderSecret>
    return { companyKey: String(parsed.companyKey ?? ''), serverId: String(parsed.serverId ?? '') }
  } catch (err) {
    log.error({ err }, '凭据解密失败（密钥换过？）')
    return null
  }
}

export async function listTenantProviders(tenantId: number): Promise<TenantProvider[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT provider, agent_account, status, credential_cipher, credential_iv, remark
       FROM pf_tenant_provider WHERE tenant_id = ? ORDER BY provider`, [tenantId])
  return rows.map((r) => {
    const secret = decodeSecret(r.credential_cipher as string | null, r.credential_iv as string | null)
    return {
      provider: String(r.provider),
      agentAccount: String(r.agent_account),
      status: r.status as TenantProvider['status'],
      companyKeyMask: secret?.companyKey ? maskCredential(secret.companyKey) : null,
      serverId: secret?.serverId || null,
      remark: (r.remark as string | null) ?? null,
    }
  })
}

/** companyKey 传空串表示「不改密钥，只改其他字段」—— 后台表单里密钥框本来就只显掩码 */
export async function saveTenantProvider(tenantId: number, input: {
  provider: string
  agentAccount: string
  companyKey: string
  serverId: string
  status: TenantProvider['status']
  remark: string
}): Promise<void> {
  const pool = getPlatformPool()
  const [[existing]] = await pool.query<RowDataPacket[]>(
    'SELECT credential_cipher, credential_iv FROM pf_tenant_provider WHERE tenant_id = ? AND provider = ? LIMIT 1',
    [tenantId, input.provider]) as unknown as [RowDataPacket[]]

  const prev = decodeSecret(
    (existing?.credential_cipher as string | null) ?? null,
    (existing?.credential_iv as string | null) ?? null,
  )
  const secret: ProviderSecret = {
    companyKey: input.companyKey || prev?.companyKey || '',
    serverId: input.serverId || prev?.serverId || '',
  }
  const { cipher, iv } = encryptCredential(JSON.stringify(secret))

  await pool.execute(
    `INSERT INTO pf_tenant_provider
       (tenant_id, provider, agent_account, credential_cipher, credential_iv, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       agent_account = VALUES(agent_account), credential_cipher = VALUES(credential_cipher),
       credential_iv = VALUES(credential_iv), status = VALUES(status), remark = VALUES(remark)`,
    [tenantId, input.provider, input.agentAccount, cipher, iv, input.status, input.remark || null],
  )
}

/**
 * 把子代理凭据下发到租户库。
 * 落点就是 core-node 今天读的那两个 bg_admin_settings —— 下发完该租户的所有 win568
 * 调用自动用自己的子代理，不需要改任何代码分支。
 */
export async function syncProviderToTenantDb(env: Env, tenantId: number, provider: string): Promise<{ companyKey: boolean; serverId: boolean }> {
  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT credential_cipher, credential_iv, status FROM pf_tenant_provider
      WHERE tenant_id = ? AND provider = ? LIMIT 1`, [tenantId, provider]) as unknown as [RowDataPacket[]]
  if (!row) throw new Error('该租户没有配置这个聚合商子代理')
  if (row.status === 'disabled') throw new Error('子代理已停用，下发会让该租户开始用一把停用的密钥')

  const secret = decodeSecret(row.credential_cipher as string | null, row.credential_iv as string | null)
  if (!secret?.companyKey) throw new Error('子代理密钥为空，先在平台后台补齐')

  const db = getMysqlPool(env)
  const put = async (key: string, value: string) => {
    await db.execute(
      `INSERT INTO bg_admin_settings (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`, [key, value])
  }
  await put(WIN568_COMPANY_KEY_SETTING, secret.companyKey)
  // serverId 不是密钥但同样按租户不同；为空时不写，让它继续回落平台 env
  if (secret.serverId) await put(WIN568_SERVER_ID_SETTING, secret.serverId)

  await getPlatformPool().execute(
    `UPDATE pf_tenant_provider SET status = 'active' WHERE tenant_id = ? AND provider = ?`, [tenantId, provider])
  return { companyKey: true, serverId: Boolean(secret.serverId) }
}

export async function listTenantChannels(tenantId: number): Promise<TenantChannel[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT channel_code, owner, merchant_no, credential_cipher, credential_iv, enabled, sort_order,
            fee_rate_pct, fee_fixed
       FROM pf_tenant_channel WHERE tenant_id = ? ORDER BY sort_order, channel_code`, [tenantId])
  return rows.map((r) => {
    let mask: string | null = null
    if (r.credential_cipher && r.credential_iv) {
      try { mask = maskCredential(decryptCredential(String(r.credential_cipher), String(r.credential_iv))) }
      catch { mask = '解密失败' }
    }
    return {
      channelCode: String(r.channel_code),
      owner: r.owner as TenantChannel['owner'],
      merchantNo: (r.merchant_no as string | null) ?? null,
      credentialMask: mask,
      enabled: Number(r.enabled) === 1,
      sortOrder: Number(r.sort_order),
      feeRatePct: Number(r.fee_rate_pct ?? 0),
      feeFixed: Number(r.fee_fixed ?? 0),
    }
  })
}

export async function saveTenantChannel(tenantId: number, input: {
  channelCode: string
  owner: 'platform' | 'tenant'
  merchantNo: string
  credential: string
  enabled: boolean
  sortOrder: number
  feeRatePct: number
  feeFixed: number
}): Promise<void> {
  const pool = getPlatformPool()
  let cipher: string | null = null
  let iv: string | null = null
  if (input.credential) {
    const enc = encryptCredential(input.credential)
    cipher = enc.cipher
    iv = enc.iv
  }
  // 密钥留空 = 不动原密钥（表单里本来只显掩码），用 COALESCE 而不是覆盖成 NULL
  await pool.execute(
    `INSERT INTO pf_tenant_channel
       (tenant_id, channel_code, owner, merchant_no, credential_cipher, credential_iv, enabled, sort_order,
        fee_rate_pct, fee_fixed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       owner = VALUES(owner), merchant_no = VALUES(merchant_no),
       credential_cipher = COALESCE(VALUES(credential_cipher), credential_cipher),
       credential_iv = COALESCE(VALUES(credential_iv), credential_iv),
       enabled = VALUES(enabled), sort_order = VALUES(sort_order),
       fee_rate_pct = VALUES(fee_rate_pct), fee_fixed = VALUES(fee_fixed)`,
    [tenantId, input.channelCode, input.owner, input.merchantNo || null, cipher, iv,
     input.enabled ? 1 : 0, input.sortOrder, input.feeRatePct, input.feeFixed],
  )
}

export async function deleteTenantChannel(tenantId: number, channelCode: string): Promise<void> {
  await getPlatformPool().execute(
    'DELETE FROM pf_tenant_channel WHERE tenant_id = ? AND channel_code = ?', [tenantId, channelCode])
}

/**
 * 把平台侧的通道分配下发到租户库 payment_channels。
 *
 * 新库里这张表是空的（payment_channels 刻意不在开站种子白名单里 —— 收款方式必须由平台
 * 逐个分配，不能整表复制自营站的）。所以下发要做两件事：
 *   1. 分配到的通道：从自营库把该 provider 的行整行复制过来（费率等默认值有据可依，
 *      租户后台之后可以自己调），已存在的不动
 *   2. 没分配到的：一律关掉并对客户端隐藏
 */
export async function syncChannelsToTenantDb(env: Env, tenantId: number): Promise<{ enabled: string[]; copied: number; disabled: number }> {
  const rows = await listTenantChannels(tenantId)
  const enabledCodes = rows.filter((r) => r.enabled).map((r) => r.channelCode)
  const db = getMysqlPool(env)
  const src = process.env.MYSQL_DATABASE ?? 'betogo'

  if (enabledCodes.length === 0) {
    const [res] = await db.execute('UPDATE payment_channels SET enabled = 0, client_visible = 0')
    return { enabled: [], copied: 0, disabled: (res as { affectedRows?: number }).affectedRows ?? 0 }
  }

  let copied = 0
  for (const code of enabledCodes) {
    const [res] = await db.execute(
      `INSERT IGNORE INTO payment_channels SELECT * FROM \`${src}\`.payment_channels WHERE provider = ?`, [code])
    copied += (res as { affectedRows?: number }).affectedRows ?? 0
  }

  const placeholders = enabledCodes.map(() => '?').join(',')
  await db.execute(`UPDATE payment_channels SET enabled = 1 WHERE provider IN (${placeholders})`, enabledCodes)
  const [res] = await db.execute(
    `UPDATE payment_channels SET enabled = 0, client_visible = 0 WHERE provider NOT IN (${placeholders})`, enabledCodes)
  log.info({ tenantId, enabledCodes, copied }, '支付通道已下发')
  return { enabled: enabledCodes, copied, disabled: (res as { affectedRows?: number }).affectedRows ?? 0 }
}
