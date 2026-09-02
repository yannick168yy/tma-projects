import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../clients/platform-mysql.client.js'
import { runWithTenant, type TenantContext, type TenantStatus } from '../lib/tenant-context.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('tenant-jobs')

interface TenantRow extends RowDataPacket {
  id: number
  code: string
  db_name: string
  status: TenantStatus
  self_operated: number
}

let cache: { value: TenantContext[]; expiresAt: number } | null = null
const CACHE_MS = 60_000

/**
 * 需要跑定时任务的租户。
 * 只排除 closed（已关站）：停站/停充提的租户仍要继续结算、对账、发放已产生的权益，
 * 否则关停期间的数据会永久缺失。
 */
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

// 同名任务的上一轮还没跑完就不再开新一轮。
// 30 秒 tick 的任务乘以几十个租户，很容易超过间隔时间，不挡住就会堆叠成雪崩。
const inFlight = new Set<string>()

/**
 * 逐租户执行定时任务。
 * 单个租户失败只记日志不中断其他租户 —— 一家的数据问题不能拖垮所有站点的结算。
 * 任务体内 getMysqlPool / getRedis 会自动拿到该租户的库与带前缀的 Redis 客户端。
 */
export async function forEachTenant(
  job: string,
  fn: (tenant: TenantContext) => Promise<unknown>,
): Promise<void> {
  if (inFlight.has(job)) {
    log.warn({ job }, '上一轮尚未结束，跳过本轮')
    return
  }
  inFlight.add(job)
  try {
    const tenants = await listRunnableTenants()
    for (const tenant of tenants) {
      try {
        await runWithTenant(tenant, () => fn(tenant))
      } catch (err) {
        log.error({ err, job, tenant: tenant.code }, '租户任务执行失败')
      }
    }
  } catch (err) {
    log.error({ err, job }, '取租户列表失败，本轮跳过')
  } finally {
    inFlight.delete(job)
  }
}
