import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'

/**
 * P1-15 租户 App 出包参数（平台库 pf_tenant_app）。
 *
 * 🔴 这里存不下签名密钥：只有 keystoreRef 这个引用名，密钥文件与密码始终只在出包机上。
 * 密钥丢了就再也无法更新已发布的 App —— 它不该躺在任何一个能被拖库的地方。
 */
export interface TenantAppBuild {
  appMarket: string
  packageName: string
  appLabel: string
  routeDomains: string[]
  tgRecoveryChannel: string
  splashBackground: string
  keystoreRef: string
  versionCode: number
  versionName: string
  updatedAt: string | null
}

// applicationId 的合法形态：至少两段、小写字母开头、只含小写字母数字下划线。
// 发布后不可更改，写错一次就是一个再也收不回来的包名
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/
// keystoreRef 会被拼进 keystore-<ref>.properties 这个文件名，
// 放开任何路径字符就等于让平台后台能读出包机上的任意文件
const KEYSTORE_REF_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const TG_CHANNEL_RE = /^@?[A-Za-z0-9_]{5,32}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const VERSION_NAME_RE = /^\d+\.\d+(\.\d+)?$/

export async function listTenantApps(tenantId: number): Promise<TenantAppBuild[]> {
  const [rows] = await getPlatformPool().query<RowDataPacket[]>(
    `SELECT app_market, package_name, app_label, route_domains, tg_recovery_channel,
            splash_background, keystore_ref, version_code, version_name, updated_at
     FROM pf_tenant_app WHERE tenant_id = ? ORDER BY app_market ASC`,
    [tenantId],
  )
  return rows.map((r) => ({
    appMarket: String(r.app_market),
    packageName: String(r.package_name),
    appLabel: String(r.app_label),
    routeDomains: String(r.route_domains).split(',').map((d) => d.trim()).filter(Boolean),
    tgRecoveryChannel: String(r.tg_recovery_channel ?? ''),
    splashBackground: String(r.splash_background),
    keystoreRef: String(r.keystore_ref ?? ''),
    versionCode: Number(r.version_code),
    versionName: String(r.version_name),
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
  }))
}

/** 校验通过返回 null，否则返回给运营看的中文原因 */
export function validateTenantApp(input: Partial<TenantAppBuild>): string | null {
  if (!input.appMarket || !/^[A-Z]{2,8}$/.test(input.appMarket)) return 'appMarket 需为 2-8 位大写字母'
  if (!input.packageName || !PACKAGE_RE.test(input.packageName)) return '包名不合法（形如 games.example.app，发布后不可更改）'
  if (!input.appLabel || input.appLabel.length > 32) return '桌面名需为 1-32 字'
  const domains = input.routeDomains ?? []
  if (!domains.length) return '线路组不能为空：内置线路表为空的包起不来'
  if (domains.length > 12) return '线路组最多 12 个域名'
  for (const d of domains) if (!DOMAIN_RE.test(d)) return `线路域名不合法：${d}`
  if (new Set(domains).size !== domains.length) return '线路组有重复域名'
  if (input.tgRecoveryChannel && !TG_CHANNEL_RE.test(input.tgRecoveryChannel)) return 'TG 频道名不合法'
  if (input.splashBackground && !HEX_RE.test(input.splashBackground)) return '启动屏底色需为 #RRGGBB'
  if (input.keystoreRef && !KEYSTORE_REF_RE.test(input.keystoreRef)) return '签名引用名只能是小写字母数字与 . _ -'
  const code = Number(input.versionCode)
  if (!Number.isInteger(code) || code < 1 || code > 2_100_000_000) return 'versionCode 需为正整数'
  if (!input.versionName || !VERSION_NAME_RE.test(input.versionName)) return 'versionName 形如 1.0.0'
  return null
}

export async function saveTenantApp(tenantId: number, input: TenantAppBuild): Promise<void> {
  await getPlatformPool().execute(
    `INSERT INTO pf_tenant_app
       (tenant_id, app_market, package_name, app_label, route_domains, tg_recovery_channel,
        splash_background, keystore_ref, version_code, version_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       package_name = VALUES(package_name), app_label = VALUES(app_label),
       route_domains = VALUES(route_domains), tg_recovery_channel = VALUES(tg_recovery_channel),
       splash_background = VALUES(splash_background), keystore_ref = VALUES(keystore_ref),
       version_code = VALUES(version_code), version_name = VALUES(version_name)`,
    [
      tenantId, input.appMarket, input.packageName, input.appLabel,
      input.routeDomains.join(','), input.tgRecoveryChannel, input.splashBackground,
      input.keystoreRef, input.versionCode, input.versionName,
    ],
  )
}

export async function deleteTenantApp(tenantId: number, appMarket: string): Promise<void> {
  await getPlatformPool().execute(
    `DELETE FROM pf_tenant_app WHERE tenant_id = ? AND app_market = ?`,
    [tenantId, appMarket],
  )
}
