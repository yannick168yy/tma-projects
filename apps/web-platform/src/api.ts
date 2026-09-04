import axios from 'axios'

const BASE = import.meta.env.VITE_PLATFORM_API_BASE_URL || '/api/v1'

export const http = axios.create({ baseURL: BASE })

// 平台后台用独立的 token key：与租户后台的 admin_token 隔离，
// 同一浏览器同时开两边也不会互相顶掉登录态
export const PLATFORM_TOKEN_KEY = 'platform_token'
export const PLATFORM_ROLE_KEY = 'platform_role'

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(PLATFORM_TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem(PLATFORM_TOKEN_KEY)) {
      localStorage.removeItem(PLATFORM_TOKEN_KEY)
      localStorage.removeItem(PLATFORM_ROLE_KEY)
      window.location.href = '/platform/login'
    }
    const msg = err.response?.data?.message || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  },
)

async function unwrap<T>(p: Promise<{ data: { code: number; message?: string; data: T } }>): Promise<T> {
  const res = await p
  if (res.data.code !== 0) throw new Error(res.data.message || '请求失败')
  return res.data.data
}

export const get = <T>(url: string) => unwrap<T>(http.get(url))
export const post = <T>(url: string, body?: unknown) => unwrap<T>(http.post(url, body))
export const put = <T>(url: string, body?: unknown) => unwrap<T>(http.put(url, body))
export const del = <T>(url: string) => unwrap<T>(http.delete(url))

// ── 平台认证 ──
export interface PlatformLoginResult { token: string; role: string; username: string }
export const platformLogin = (username: string, password: string) =>
  post<PlatformLoginResult>('/platform/auth/login', { username, password })
export const platformMe = () => get<{ id: number; username: string; role: string }>('/platform/auth/me')

// ── 租户总览 ──
export interface PlatformTenant {
  id: number
  code: string
  name: string
  database: string
  status: string
  selfOperated: boolean
  planName: string | null
  marketCount: number
  domainCount: number
  createdAt: string
}
export const listPlatformTenants = () => get<PlatformTenant[]>('/platform/tenants')

export interface TenantDomain {
  id: number
  domain: string
  market: string
  purpose: string
  enabled: boolean
  appMarket: string | null
  appPriority: number
  domainType: 'platform_subdomain' | 'custom'
  certStatus: 'none' | 'pending_dns' | 'issued' | 'expiring' | 'failed'
  certExpiresAt: string | null
  certCheckedAt: string | null
  certDetail: string | null
  dnsResolvedIp: string | null
}

export interface TenantDetail extends PlatformTenant {
  remark: string | null
  planCode: string | null
  pool: { min: number; max: number; queueLimit: number }
  markets: Array<{ market: string; currency: string; timezone: string; enabled: boolean }>
  domains: TenantDomain[]
  providers: Array<{ provider: string; agentAccount: string; status: string }>
  channels: Array<{ channelCode: string; owner: string; merchantNo: string | null; enabled: boolean }>
}
export const getTenantDetail = (id: number) => get<TenantDetail>(`/platform/tenants/${id}`)
export const updateTenantStatus = (id: number, status: string) =>
  put<{ id: number; status: string }>(`/platform/tenants/${id}/status`, { status })
export const updateTenantPool = (id: number, poolMin: number, poolMax: number, queueLimit: number) =>
  put<{ id: number; poolMin: number; poolMax: number; queueLimit: number; poolRecreated: boolean }>(
    `/platform/tenants/${id}/pool`, { poolMin, poolMax, queueLimit })

// ── 套餐 ──
export interface PlatformPlan { code: string; name: string; description: string | null }
export const listPlatformPlans = () => get<PlatformPlan[]>('/platform/plans')

// ── 一键开站 ──
export interface ProvisionRequest {
  code: string
  name: string
  markets: Array<{ market: string; currency: string; timezone: string }>
  domains: Array<{ domain: string; market: string }>
  planCode: string
  adminUsername: string
  adminPassword: string
  poolMin?: number
  poolMax?: number
}
export interface ProvisionResult {
  tenantId: number
  database: string
  adminDomain: string
  tables: number
  seededRows: Record<string, number>
  smoke: { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }
}
export const provisionTenant = (body: ProvisionRequest) => post<ProvisionResult>('/platform/tenants', body)

// ── 域名管理 ──
export interface DomainProbe {
  domain: string
  dnsResolvedIp: string | null
  dnsOk: boolean
  certStatus: string
  certExpiresAt: string | null
  detail: string | null
}
export const addTenantDomain = (
  tenantId: number,
  body: { domain?: string; market: string; purpose: string; type: 'platform_subdomain' | 'custom' },
) => post<{ id: number; domain: string; certStatus: string }>(`/platform/tenants/${tenantId}/domains`, body)

export const removeTenantDomain = (tenantId: number, domainId: number) =>
  del<{ id: number }>(`/platform/tenants/${tenantId}/domains/${domainId}`)

export const probeDomains = (domainIds?: number[]) =>
  post<DomainProbe[]>('/platform/domains/probe', { domainIds })
