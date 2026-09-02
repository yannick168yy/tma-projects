import type { RowDataPacket } from 'mysql2/promise'
import type { FastifyInstance } from 'fastify'
import { getPlatformPool, selfOperatedTenant } from '../clients/platform-mysql.js'
import { runWithTenant, type TenantContext, type TenantStatus } from './tenant-context.js'

interface TenantRow extends RowDataPacket {
  id: number
  code: string
  db_name: string
  status: TenantStatus
  self_operated: number
}

let cache: { value: TenantContext[]; expiresAt: number } | null = null
const CACHE_MS = 60_000

/** 只排除 closed：停站/停充提的租户仍要继续结算与对账，否则关停期间数据永久缺失 */
export async function listRunnableTenants(): Promise<TenantContext[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT id, code, db_name, status, self_operated
       FROM pf_tenant WHERE status <> 'closed' ORDER BY id`,
  )
  const tenants = rows.map((row) => ({
    id: row.id,
    code: row.code,
    database: row.db_name,
    status: row.status,
    selfOperated: row.self_operated === 1,
  }))
  cache = { value: tenants, expiresAt: Date.now() + CACHE_MS }
  return tenants
}

// 同名任务上一轮没跑完就跳过本轮，避免几十个租户串行执行超过间隔后堆叠
const inFlight = new Set<string>()

/** 逐租户执行。单租户失败只记日志，不影响其他租户 */
export async function forEachTenant(
  app: FastifyInstance,
  job: string,
  fn: (tenant: TenantContext) => Promise<unknown>,
): Promise<void> {
  if (inFlight.has(job)) {
    app.log.warn({ job }, '上一轮尚未结束，跳过本轮')
    return
  }
  inFlight.add(job)
  try {
    const tenants = await listRunnableTenants()
    for (const tenant of tenants) {
      try {
        await runWithTenant(tenant, () => fn(tenant))
      } catch (err) {
        app.log.error({ err, job, tenant: tenant.code }, '租户任务执行失败')
      }
    }
  } catch (err) {
    app.log.error({ err, job }, '取租户列表失败，本轮跳过')
  } finally {
    inFlight.delete(job)
  }
}

/**
 * 以自营站身份执行平台级任务。
 * 聚合商 CompanyKey 目前是全平台共用的一把：密钥轮换、报表拉取这类任务
 * 按租户跑会把同一把密钥轮换 N 次、把同一份报表拉 N 遍。
 * 等 P1 的 pf_tenant_provider 给每个租户建独立子代理后，再改成按租户执行。
 */
export async function runAsSelfOperated(
  app: FastifyInstance,
  job: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    const tenant = await selfOperatedTenant()
    if (!tenant) {
      app.log.error({ job }, '读不到自营站租户，平台级任务跳过本轮')
      return
    }
    await runWithTenant(tenant, fn)
  } catch (err) {
    app.log.error({ err, job }, '平台级任务执行失败')
  }
}
