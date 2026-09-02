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
  /** 该租户的业务库名。自营站保留原库名 betogo */
  database: string
  status: TenantStatus
  selfOperated: boolean
}

const storage = new AsyncLocalStorage<TenantContext>()

export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T {
  return storage.run(tenant, fn)
}

export function currentTenantOrNull(): TenantContext | null {
  return storage.getStore() ?? null
}

export function currentTenant(): TenantContext {
  const tenant = storage.getStore()
  if (!tenant) {
    throw new Error('[tenant] 当前执行链没有租户上下文，请检查 tenant 插件或任务是否用 runWithTenant 包裹')
  }
  return tenant
}
