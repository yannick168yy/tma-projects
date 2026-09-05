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
  pool_min: number
  pool_max: number
  queue_limit: number
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    await new Promise((r) => setTimeout(r, 300))
    return fn()
  }
}

let cache: { value: TenantContext[]; expiresAt: number } | null = null
const CACHE_MS = 60_000

/** 只排除 closed：停站/停充提的租户仍要继续结算与对账，否则关停期间数据永久缺失 */
export async function listRunnableTenants(): Promise<TenantContext[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value
  // 容器网络的 DNS 偶发 ENOTFOUND，取不到租户清单会让整轮定时任务被跳过。
  // 重试一次盖住抖动；仍失败才让调用方按失败处理。
  const [rows] = await withRetry(() => getPlatformPool().query<TenantRow[]>(
    `SELECT id, code, db_name, status, self_operated, pool_min, pool_max, queue_limit
       FROM pf_tenant WHERE status <> 'closed' ORDER BY id`,
  ))
  const tenants = rows.map((row) => ({
    id: row.id,
    code: row.code,
    database: row.db_name,
    status: row.status,
    selfOperated: row.self_operated === 1,
    pool: { min: row.pool_min, max: row.pool_max, queueLimit: row.queue_limit },
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
 * win568 这类「按子代理」的任务用它（P1-5）：
 * 自营站 + 每个有 active 独立子代理的租户各跑一次。
 *
 * 共用平台子代理的租户**不单独跑**：它们与自营站是同一把 CompanyKey、同一个 ServerId，
 * 再跑一遍就是把同一份报表重复拉、把同一把密钥重复轮换。
 */
export async function runForProviderTenants(
  app: FastifyInstance,
  job: string,
  provider: string,
  fn: (tenant: TenantContext) => Promise<unknown>,
): Promise<void> {
  if (inFlight.has(job)) {
    app.log.warn({ job }, '上一轮尚未结束，跳过本轮')
    return
  }
  inFlight.add(job)
  try {
    const self = await selfOperatedTenant()
    const targets: TenantContext[] = self ? [self] : []
    if (!self) app.log.error({ job }, '读不到自营站租户')

    try {
      const [rows] = await withRetry(() => getPlatformPool().query<TenantRow[]>(
        `SELECT t.id, t.code, t.db_name, t.status, t.self_operated, t.pool_min, t.pool_max, t.queue_limit
           FROM pf_tenant t
           JOIN pf_tenant_provider p ON p.tenant_id = t.id
          WHERE p.provider = ? AND p.status = 'active'
                AND t.self_operated = 0 AND t.status <> 'closed'
          ORDER BY t.id`, [provider]))
      for (const row of rows) {
        targets.push({
          id: row.id, code: row.code, database: row.db_name,
          status: row.status, selfOperated: row.self_operated === 1,
        })
      }
    } catch (err) {
      // 取不到独立子代理清单时仍要把自营站跑完：那是今天在产的那份收入
      app.log.error({ err, job }, '取独立子代理租户清单失败，本轮只跑自营站')
    }

    for (const tenant of targets) {
      try {
        await runWithTenant(tenant, () => fn(tenant))
      } catch (err) {
        app.log.error({ err, job, tenant: tenant.code }, '子代理任务执行失败')
      }
    }
  } finally {
    inFlight.delete(job)
  }
}
