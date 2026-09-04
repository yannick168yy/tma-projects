import { Resolver } from 'node:dns/promises'
import { connect as tlsConnect } from 'node:tls'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('domain-cert')

export type CertStatus = 'none' | 'pending_dns' | 'issued' | 'expiring' | 'failed'

/** 到期前多少天算 expiring：Let's Encrypt 有效期 90 天、30 天内会自动续期，留 30 天窗口 */
const EXPIRING_DAYS = 30

/**
 * 平台自有的根域名。子域名租户用 `<code>.<根域名>`，
 * DNS 走一条泛解析记录、证书走一张泛域名证书，开站零人工介入。
 */
export function platformRootDomain(): string {
  return process.env.PLATFORM_ROOT_DOMAIN?.trim() || 'betogo.games'
}

/** 本服务器的公网 IP，用于判定客户自带域名的 A 记录是否已指过来 */
function serverPublicIps(): string[] {
  return (process.env.SERVER_PUBLIC_IP ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
}

export interface DomainProbe {
  domain: string
  dnsResolvedIp: string | null
  dnsOk: boolean
  certStatus: CertStatus
  certExpiresAt: Date | null
  detail: string | null
}

/**
 * 探测一个域名的 DNS 与证书状态。全程只读，不签发、不改 nginx ——
 * 签发是会改动线上配置的动作，必须人工确认后单独触发。
 */
export async function probeDomain(domain: string, opts: { expectSubdomain: boolean }): Promise<DomainProbe> {
  const result: DomainProbe = {
    domain, dnsResolvedIp: null, dnsOk: false,
    certStatus: 'none', certExpiresAt: null, detail: null,
  }

  // 用公共 DNS 而不是容器内的 resolver：容器 DNS 只认内网服务名，
  // 查公网域名会走上游但受 aardvark-dns 抖动影响（P1-0d 那个老问题）
  const resolver = new Resolver({ timeout: 5000, tries: 2 })
  resolver.setServers(['8.8.8.8', '1.1.1.1'])

  try {
    const ips = await resolver.resolve4(domain)
    result.dnsResolvedIp = ips[0] ?? null
    const expected = serverPublicIps()
    // 没配 SERVER_PUBLIC_IP 时不做 IP 比对，只要能解析就算通过，
    // 避免因为运维没配环境变量就把所有域名判成失败
    result.dnsOk = expected.length === 0 ? ips.length > 0 : ips.some((ip) => expected.includes(ip))
  } catch (err) {
    result.detail = `DNS 解析失败：${(err as Error).message.slice(0, 80)}`
    result.certStatus = opts.expectSubdomain ? 'failed' : 'pending_dns'
    return result
  }

  if (!result.dnsOk) {
    result.detail = `A 记录指向 ${result.dnsResolvedIp}，未指向本服务器`
    result.certStatus = 'pending_dns'
    return result
  }

  // DNS 通了才有必要探证书：解析都没生效时握手必然失败，那个错误没有诊断价值
  try {
    const cert = await fetchCertNotAfter(domain)
    result.certExpiresAt = cert
    const daysLeft = (cert.getTime() - Date.now()) / 86400000
    result.certStatus = daysLeft <= 0 ? 'failed' : daysLeft <= EXPIRING_DAYS ? 'expiring' : 'issued'
    if (daysLeft <= 0) result.detail = '证书已过期'
    else if (daysLeft <= EXPIRING_DAYS) result.detail = `${Math.floor(daysLeft)} 天后到期`
  } catch (err) {
    result.certStatus = 'failed'
    result.detail = `证书探测失败：${(err as Error).message.slice(0, 80)}`
  }
  return result
}

/** TLS 握手取证书有效期。只连不发数据，握手成功即可拿到证书链 */
function fetchCertNotAfter(domain: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      { host: domain, port: 443, servername: domain, timeout: 8000, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate()
        socket.end()
        if (!cert?.valid_to) return reject(new Error('未取到证书'))
        resolve(new Date(cert.valid_to))
      },
    )
    socket.on('timeout', () => { socket.destroy(); reject(new Error('握手超时')) })
    socket.on('error', (e) => { socket.destroy(); reject(e) })
  })
}

interface DomainRow extends RowDataPacket {
  id: number
  domain: string
  domain_type: 'platform_subdomain' | 'custom'
}

/**
 * 批量巡检并回写状态。
 * 子域名由泛域名证书覆盖，不需要逐个探测证书 —— 但仍探一次 DNS，
 * 因为泛解析记录一旦被误删，所有子域名租户会同时失联，这是必须尽早发现的故障。
 */
export async function refreshDomainCertStatus(domainIds?: number[]): Promise<DomainProbe[]> {
  const pool = getPlatformPool()
  const where = domainIds?.length ? `WHERE id IN (${domainIds.map(() => '?').join(',')})` : 'WHERE enabled = 1'
  const [rows] = await pool.query<DomainRow[]>(
    `SELECT id, domain, domain_type FROM pf_tenant_domain ${where}`, domainIds ?? [])

  const out: DomainProbe[] = []
  for (const row of rows) {
    const probe = await probeDomain(row.domain, { expectSubdomain: row.domain_type === 'platform_subdomain' })
    out.push(probe)
    await pool.execute(
      `UPDATE pf_tenant_domain
          SET cert_status = ?, cert_expires_at = ?, cert_checked_at = NOW(3),
              cert_detail = ?, dns_resolved_ip = ?
        WHERE id = ?`,
      [probe.certStatus, probe.certExpiresAt, probe.detail, probe.dnsResolvedIp, row.id],
    ).catch((err: unknown) => log.warn({ err, domain: row.domain }, '回写证书状态失败'))
  }
  return out
}
