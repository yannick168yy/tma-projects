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

/**
 * 需要跑定时任务的租户。
 * 只排除 closed（已关站）：停站/停充提的租户仍要继续结算、对账、发放已产生的权益，
 * 否则关停期间的数据会永久缺失。
 *
 * 以及排除 is_demo（演示站）。这是整个包网体系里唯一一处需要认识演示站的地方 ——
 * 所有跨租户机制都收敛到这个函数：16 个定时任务、风控联防身份采集
 * （runIdentityCollection）、平台 BI 抽数（runPlatformBi）、计费日切
 * （runBillingSnapshot）全都经由 forEachTenant 取清单。
 *
 * 演示站的数据是脱敏样本，放进来的后果不是"报表脏一点"：broadcast-tick 会拿假
 * 用户真发 TG 消息，deposit-status 会拿假订单号去问支付商，payout-reversal 会
 * 调代付撤销。这些都不走 HTTP 路由，中间件层的护栏拦不住。
 */
export async function listRunnableTenants(): Promise<TenantContext[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value
  // 容器网络的 DNS 偶发 ENOTFOUND，取不到租户清单会让整轮定时任务被跳过。
  // 重试一次盖住抖动；仍失败才让调用方按失败处理。
  const [rows] = await withRetry(() => getPlatformPool().query<TenantRow[]>(
    `SELECT id, code, db_name, status, self_operated, pool_min, pool_max, queue_limit
       FROM pf_tenant WHERE status <> 'closed' AND is_demo = 0 ORDER BY id`,
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
