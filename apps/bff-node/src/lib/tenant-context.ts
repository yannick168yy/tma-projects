import { AsyncLocalStorage } from 'node:async_hooks'

export type TenantStatus =
  | 'trial'
  | 'active'
  | 'withdraw_suspended'
  | 'deposit_suspended'
  | 'suspended'
  | 'closed'

export interface TenantContext {
  id: number
  code: string
  /** 该租户的业务库名。自营站保留原库名 betogo，不随 code 变化 */
  database: string
  status: TenantStatus
  selfOperated: boolean
  /** 连接池策略。来自平台库 pf_tenant；兜底上下文没有此配置，回落环境变量默认值 */
  pool?: TenantPoolConfig
}

export interface TenantPoolConfig {
  /** 常驻连接数：池创建后后台预热到此数，空闲也不回收到更低 */
  min: number
  /** 连接数上限 */
  max: number
  /** 等待队列上限，0 = 不限 */
  queueLimit: number
}

const storage = new AsyncLocalStorage<TenantContext>()

/** 在租户上下文中执行。异步调用链（await / Promise / 定时器回调）内均可读到 */
export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T {
  return storage.run(tenant, fn)
}

/**
 * 取当前租户。取不到直接抛错 —— 绝不能静默回落到自营站：
 * 那样一条漏包上下文的代码路径会把别家租户的请求打到自营库上。
 */
export function currentTenant(): TenantContext {
  const tenant = storage.getStore()
  if (!tenant) {
    throw new Error('[tenant] 当前执行链没有租户上下文，请检查中间件或任务是否用 runWithTenant 包裹')
  }
  return tenant
}

/** 取当前租户，允许为空。只给"确实可能在上下文外运行"的启动期代码用 */
export function currentTenantOrNull(): TenantContext | null {
  return storage.getStore() ?? null
}

/** 该租户当前是否允许提现（欠费降级第一级会先停提现） */
export function canWithdraw(tenant: TenantContext): boolean {
  return tenant.status === 'trial' || tenant.status === 'active' || tenant.status === 'deposit_suspended'
}

/** 该租户当前是否允许充值（第二级降级停充值） */
export function canDeposit(tenant: TenantContext): boolean {
  return tenant.status === 'trial' || tenant.status === 'active' || tenant.status === 'withdraw_suspended'
}

/** 站点是否可访问。停站/关站后前台整站不可用 */
export function isSiteOpen(tenant: TenantContext): boolean {
  return tenant.status !== 'suspended' && tenant.status !== 'closed'
}
