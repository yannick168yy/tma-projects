import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import type { Env } from '../config/env.js'
import { childLogger } from '../lib/logger.js'
import { currentTenant } from '../lib/tenant-context.js'
import { credentialKeyConfigured, encryptCredential, maskCredential, decryptCredential } from './platform-credential.service.js'
import { invalidateChannelOwnershipCache } from './billing/settlement-mode.service.js'
import { listTenantApps, saveTenantApp, validateTenantApp, type TenantAppBuild } from './tenant-app.service.js'

const log = childLogger('self-service')

/**
 * 租户自助（P3-5）。
 *
 * 🔴 所有函数都以 currentTenant() 为准，不接受 tenantId 入参 —— 这是唯一能保证
 * 「客户只能改自己的东西」的写法。带 tenantId 的接口只要漏一次校验就是跨租户越权。
 *
 * 自助的边界：客户能改的是**自己的钱和自己的包**（自带通道凭据、出包参数），
 * 不能改平台代收通道（那是平台的商户号）、不能改费率（商务合同定的）、
 * 不能自己点出包（签名密钥不在服务器上）。
 */

export interface SelfChannel {
  channelCode: string
  owner: 'platform' | 'tenant'
  merchantNo: string | null
  credentialMask: string | null
  enabled: boolean
  /** 平台代收的通道客户只能看不能改 */
  editable: boolean
  feeRatePct: number
  feeFixed: number
}

export async function listSelfChannels(): Promise<{ credentialKeyReady: boolean; items: SelfChannel[] }> {
  const tenant = currentTenant()
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT channel_code, owner, merchant_no, credential_cipher, credential_iv, enabled, fee_rate_pct, fee_fixed
       FROM pf_tenant_channel WHERE tenant_id = ? ORDER BY sort_order, channel_code`, [tenant.id])
  return {
    credentialKeyReady: credentialKeyConfigured(),
    items: rows.map((r) => {
      let mask: string | null = null
      if (r.credential_cipher && r.credential_iv) {
        try { mask = maskCredential(decryptCredential(String(r.credential_cipher), String(r.credential_iv))) }
        catch { mask = '（无法解密，请联系平台）' }
      }
      return {
        channelCode: String(r.channel_code),
        owner: r.owner === 'tenant' ? 'tenant' : 'platform',
        merchantNo: (r.merchant_no as string | null) ?? null,
        credentialMask: mask,
        enabled: Number(r.enabled) === 1,
        editable: r.owner === 'tenant',
        feeRatePct: Number(r.fee_rate_pct ?? 0),
        feeFixed: Number(r.fee_fixed ?? 0),
      }
    }),
  }
}

/**
 * 客户改自己自带通道的商户号与密钥。
 *
 * 只允许改 owner='tenant' 的行：平台代收通道用的是平台的商户号，客户改了会把
 * 平台的收款账号换成别的地方 —— 那是资金被劫持，不是配置错误。
 * 通道的启用与费率也不给改：启用哪些通道是平台分配的，费率是商务合同定的。
 */
export async function saveSelfChannelCredential(
  env: Env, channelCode: string, input: { merchantNo: string; credential: string },
  operator: string | null, ip: string,
): Promise<void> {
  const tenant = currentTenant()
  const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
    'SELECT owner FROM pf_tenant_channel WHERE tenant_id = ? AND channel_code = ? LIMIT 1',
    [tenant.id, channelCode]) as unknown as [RowDataPacket[]]
  if (!row) throw new Error('该通道未分配给你，请联系平台')
  if (row.owner !== 'tenant') throw new Error('平台代收通道的凭据由平台维护，不能在这里改')
  if (input.credential && !credentialKeyConfigured()) throw new Error('平台未配置凭据主密钥，暂时无法保存')

  let cipher: string | null = null
  let iv: string | null = null
  if (input.credential) {
    const enc = encryptCredential(input.credential)
    cipher = enc.cipher
    iv = enc.iv
  }
  await getPlatformPool().execute(
    `UPDATE pf_tenant_channel
        SET merchant_no = ?,
            credential_cipher = COALESCE(?, credential_cipher),
            credential_iv = COALESCE(?, credential_iv)
      WHERE tenant_id = ? AND channel_code = ? AND owner = 'tenant'`,
    [input.merchantNo || null, cipher, iv, tenant.id, channelCode])
  await invalidateChannelOwnershipCache(env, tenant.id)
  // 🔴 只记「改了哪个通道」，不记明文也不记掩码
  await writeSelfLog('channel.credential', { channelCode, credentialChanged: Boolean(input.credential) }, operator, ip)
  log.info({ tenant: tenant.code, channelCode }, '租户自助更新了通道凭据')
}

export async function listSelfApps(): Promise<TenantAppBuild[]> {
  return listTenantApps(currentTenant().id)
}

/**
 * 客户自己改出包参数。
 * 包名与签名引用名不给改：包名发布后改一次等于换一个 App（老用户收不到更新），
 * 签名引用名指向出包机上的密钥文件，客户改它只会让出包失败。
 */
export async function saveSelfApp(
  input: TenantAppBuild, operator: string | null, ip: string,
): Promise<void> {
  const tenant = currentTenant()
  const existing = (await listTenantApps(tenant.id)).find((x) => x.appMarket === input.appMarket)
  if (!existing) throw new Error('该市场的出包参数还没建，请联系平台先建一次')
  const merged: TenantAppBuild = {
    ...existing,
    appLabel: input.appLabel,
    routeDomains: input.routeDomains,
    tgRecoveryChannel: input.tgRecoveryChannel,
    splashBackground: input.splashBackground,
    versionName: input.versionName,
    versionCode: input.versionCode,
    // 包名与签名引用名以库里的为准，忽略入参
    packageName: existing.packageName,
    keystoreRef: existing.keystoreRef,
  }
  const err = validateTenantApp(merged)
  if (err) throw new Error(err)
  await saveTenantApp(tenant.id, merged)
  await writeSelfLog('app.params', { appMarket: input.appMarket, versionName: input.versionName }, operator, ip)
}

export interface BuildRequest {
  id: number
  appMarket: string
  versionName: string
  versionCode: number
  note: string | null
  status: string
  artifactUrl: string | null
  rejectReason: string | null
  createdAt: string
  handledAt: string | null
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))

export async function listBuildRequests(tenantId?: number): Promise<Array<BuildRequest & { tenantCode?: string }>> {
  const id = tenantId ?? currentTenant().id
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT r.*, t.code AS tenant_code FROM pf_app_build_request r
       JOIN pf_tenant t ON t.id = r.tenant_id
      WHERE r.tenant_id = ? ORDER BY r.id DESC LIMIT 50`, [id])
  return rows.map(mapRequest)
}

function mapRequest(r: RowDataPacket): BuildRequest & { tenantCode?: string } {
  return {
    id: r.id,
    tenantCode: r.tenant_code,
    appMarket: r.app_market,
    versionName: r.version_name,
    versionCode: Number(r.version_code),
    note: r.note,
    status: r.status,
    artifactUrl: r.artifact_url,
    rejectReason: r.reject_reason,
    createdAt: iso(r.created_at) ?? '',
    handledAt: iso(r.handled_at),
  }
}

/** 平台侧待办：所有租户的出包申请 */
export async function listAllBuildRequests(status = 'pending'): Promise<Array<BuildRequest & { tenantCode?: string }>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT r.*, t.code AS tenant_code FROM pf_app_build_request r
       JOIN pf_tenant t ON t.id = r.tenant_id
      WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`, [status])
  return rows.map(mapRequest)
}

export async function requestBuild(
  appMarket: string, note: string, operator: string | null, ip: string,
): Promise<void> {
  const tenant = currentTenant()
  const app = (await listTenantApps(tenant.id)).find((x) => x.appMarket === appMarket)
  if (!app) throw new Error('该市场还没有出包参数')
  if (!app.keystoreRef) throw new Error('签名还没配好，请联系平台')
  try {
    await getPlatformPool().execute(
      `INSERT INTO pf_app_build_request (tenant_id, app_market, version_name, version_code, note, requested_by)
       VALUES (?,?,?,?,?,?)`,
      [tenant.id, appMarket, app.versionName, app.versionCode, note || null, operator])
  } catch (err) {
    // 唯一键 (tenant, market, status) 挡住连点：待处理的申请只能有一条
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new Error('已有一条待处理的出包申请，平台处理完再提下一条')
    }
    throw err
  }
  await writeSelfLog('app.build_request', { appMarket, versionName: app.versionName }, operator, ip)
  log.info({ tenant: tenant.code, appMarket }, '租户提交了出包申请')
}

export async function resolveBuildRequest(
  id: number, status: 'building' | 'done' | 'rejected', adminId: number | null,
  extra: { artifactUrl?: string | null; rejectReason?: string | null },
): Promise<boolean> {
  const [res] = await getPlatformPool().execute(
    `UPDATE pf_app_build_request
        SET status = ?, handled_by = ?, handled_at = NOW(3), artifact_url = ?, reject_reason = ?
      WHERE id = ? AND status IN ('pending','building')`,
    [status, adminId, extra.artifactUrl ?? null, extra.rejectReason ?? null, id])
  return (res as { affectedRows: number }).affectedRows > 0
}

async function writeSelfLog(action: string, detail: unknown, operator: string | null, ip: string): Promise<void> {
  await getPlatformPool().execute(
    'INSERT INTO pf_self_service_log (tenant_id, action, detail, operator, ip) VALUES (?,?,?,?,?)',
    [currentTenant().id, action, JSON.stringify(detail), operator, ip],
  ).catch((err) => log.warn({ err }, '自助操作留痕失败'))
}

export async function listSelfServiceLog(tenantId: number): Promise<Array<{
  id: number; action: string; detail: unknown; operator: string | null; createdAt: string
}>> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT id, action, detail, operator, created_at FROM pf_self_service_log
      WHERE tenant_id = ? ORDER BY id DESC LIMIT 100`, [tenantId])
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    detail: typeof r.detail === 'object' ? r.detail : JSON.parse(String(r.detail ?? '{}')),
    operator: r.operator,
    createdAt: iso(r.created_at) ?? '',
  }))
}
