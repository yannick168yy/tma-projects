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
export interface PlatformPlan { id: number; code: string; name: string; description: string | null }
export const listPlatformPlans = () => get<PlatformPlan[]>('/platform/plans')

// ── 套餐可覆盖范围（P1-14）──
export interface PlanLimitRange { min: number | null; max: number | null }
export interface PlanOverrides {
  plan: { id: number; code: string; name: string }
  keys: Array<{ key: string; label: string }>
  overrides: Record<string, PlanLimitRange>
}
export const getPlanOverrides = (planId: number) =>
  get<PlanOverrides>(`/platform/plans/${planId}/overrides`)

/** min 与 max 同时留空 = 删除该项限制，回到「平台不管」 */
export const setPlanOverride = (planId: number, key: string, min: number | null, max: number | null) =>
  put<{ planId: number; key: string; min: number | null; max: number | null }>(
    `/platform/plans/${planId}/overrides/${key}`, { min, max })

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

// ── 功能开关（P1-8）──
export interface TenantFeatures {
  keys: string[]
  /** 生效值 = 套餐默认 叠加 租户覆盖 */
  effective: Record<string, boolean>
  planDefaults: Record<string, boolean>
  /** 只含该租户单独设过的项；清掉覆盖即回落套餐默认值 */
  overrides: Record<string, boolean>
}
export const getTenantFeatures = (tenantId: number) =>
  get<TenantFeatures>(`/platform/tenants/${tenantId}/features`)

/** enabled 传 null = 删除覆盖，回落套餐默认值 */
export const setTenantFeature = (tenantId: number, key: string, enabled: boolean | null) =>
  put<{ id: number; key: string; effective: Record<string, boolean> }>(
    `/platform/tenants/${tenantId}/features/${key}`, { enabled })

// ── 品牌包（P1-10）──
export interface TenantBrandConfig {
  siteName: string
  shortName: string
  logoTextPrimary: string
  logoTextAccent: string
  tagline: string
  logoLightKey: string | null
  logoDarkKey: string | null
  faviconKey: string | null
  appIconKey: string | null
  theme: Record<string, string>
  updatedAt: string | null
}
export interface TenantBrandResponse {
  themeKeys: string[]
  brand: TenantBrandConfig
  /** 预览地址前缀：平台控制台不在租户域名下，资产要由平台代读 */
  assetPreviewBase: string
}
export const getTenantBrand = (tenantId: number) =>
  get<TenantBrandResponse>(`/platform/tenants/${tenantId}/brand`)

export const saveTenantBrand = (tenantId: number, patch: Partial<TenantBrandConfig>) =>
  put<TenantBrandConfig>(`/platform/tenants/${tenantId}/brand`, patch)

export const uploadBrandAsset = (
  tenantId: number,
  slot: 'logoLight' | 'logoDark' | 'favicon' | 'appIcon',
  imageData: string,
) => post<{ key: string }>(`/platform/tenants/${tenantId}/brand/asset`, { slot, imageData })

// ── 文案覆盖（P1-11）──
export interface I18nCatalogEntry { key: string; defaultValue: string }
export interface I18nOverrideRow {
  locale: string
  keyPath: string
  value: string
  updatedAt: string | null
}
export const searchI18nKeys = (q: string) =>
  get<{ total: number; matched: number; entries: I18nCatalogEntry[] }>(
    `/platform/i18n/keys?q=${encodeURIComponent(q)}`)

export const listTenantI18n = (tenantId: number, locale?: string, q?: string) => {
  const params = new URLSearchParams()
  if (locale) params.set('locale', locale)
  if (q) params.set('q', q)
  const qs = params.toString()
  return get<{ locales: string[]; rows: I18nOverrideRow[]; total: number; max: number }>(
    `/platform/tenants/${tenantId}/i18n${qs ? `?${qs}` : ''}`)
}

export const setTenantI18n = (tenantId: number, locale: string, keyPath: string, value: string) =>
  put<{ locale: string; keyPath: string }>(`/platform/tenants/${tenantId}/i18n`, { locale, keyPath, value })

export const deleteTenantI18n = (tenantId: number, locale: string, keyPath: string) =>
  del<{ locale: string; keyPath: string }>(
    `/platform/tenants/${tenantId}/i18n?locale=${encodeURIComponent(locale)}&keyPath=${encodeURIComponent(keyPath)}`)

// ── impersonate（P1-6）──
export const impersonateTenant = (tenantId: number) =>
  post<{ url: string; expiresIn: number }>(`/platform/tenants/${tenantId}/impersonate`, {})

// ── P2 商务闭环：分成方案 ──
export type BillingRuleType = 'deposit_commission' | 'ggr_share' | 'turnover_rebate' | 'monthly_fee'

export interface BillingTier { upTo: number | null; ratePct: number }

export interface BillingRule {
  id: number
  ruleType: BillingRuleType
  label: string
  ratePct: number | null
  fixedAmount: number | null
  tiers: BillingTier[] | null
  tierMode: 'flat' | 'progressive'
  scope: 'all' | 'platform' | 'tenant'
  deductBonus: boolean
  deductCommission: boolean
  deductChannelFee: boolean
  carryOver: boolean
  venueRates: Record<string, number> | null
  sortOrder: number
}

export interface BillingPlan {
  id: number
  code: string
  name: string
  description: string | null
  settleMode: 'sum' | 'max_of_fee'
  settleCurrency: string
  period: string
  enabled: boolean
  tenantCount: number
  rules: BillingRule[]
}

export const listBillingPlans = () => get<BillingPlan[]>('/platform/billing/plans')
export const createBillingPlan = (body: { code: string; name: string; description?: string; settleMode: string }) =>
  post<{ id: number }>('/platform/billing/plans', body)
export const updateBillingPlan = (id: number, body: Partial<{ name: string; description: string; settleMode: string; enabled: boolean }>) =>
  put<{ id: number }>(`/platform/billing/plans/${id}`, body)
export const createBillingRule = (planId: number, body: Partial<BillingRule>) =>
  post<{ id: number }>(`/platform/billing/plans/${planId}/rules`, body)
export const updateBillingRule = (ruleId: number, body: Partial<BillingRule>) =>
  put<{ id: number }>(`/platform/billing/rules/${ruleId}`, body)
export const deleteBillingRule = (ruleId: number) =>
  del<{ id: number }>(`/platform/billing/rules/${ruleId}`)

// ── 租户额度账户 ──
export interface TenantAccount {
  tenantId: number
  currency: string
  balance: number
  depositAmount: number
  creditLimit: number
  available: number
  updatedAt: string | null
}
export interface LedgerRow {
  id: number
  currency: string
  bizType: string
  amount: number
  balanceAfter: number
  refType: string | null
  refId: string | null
  remark: string | null
  createdAt: string
}
export const getTenantBillingPlan = (tenantId: number) =>
  get<{ bound: { plan: { id: number; name: string; settleMode: string; settleCurrency: string; period: string }; rules: BillingRule[] } | null; account: TenantAccount }>(
    `/platform/billing/tenants/${tenantId}/plan`)
export const assignBillingPlan = (tenantId: number, billingPlanId: number) =>
  put<{ tenantId: number }>(`/platform/billing/tenants/${tenantId}/plan`, { billingPlanId })

export const getTenantAccount = (tenantId: number) =>
  get<{ account: TenantAccount; ledger: LedgerRow[] }>(`/platform/billing/tenants/${tenantId}/account`)
export const postTenantLedger = (tenantId: number, body: { bizType: string; amount: number; remark: string }) =>
  post<{ duplicated: boolean; balanceAfter: number }>(`/platform/billing/tenants/${tenantId}/account/ledger`, body)
export const setTenantCredit = (tenantId: number, creditLimit: number) =>
  put<TenantAccount>(`/platform/billing/tenants/${tenantId}/account/credit`, { creditLimit })
export const listAccounts = () =>
  get<Array<TenantAccount & { code: string; name: string; status: string }>>('/platform/billing/accounts')

// ── 日切快照 ──
export interface BillingDailyRow {
  statDate: string
  currency: string
  fxRateUsdt: number
  depositAmount: number
  depositPlatform: number
  depositTenant: number
  withdrawAmount: number
  turnover: number
  payout: number
  ggr: number
  bonusCost: number
  commissionCost: number
  channelFee: number
  locked: boolean
  channelDetail: Record<string, { owner: string; amount: number; fee: number; count: number }>
}
export const listBillingDaily = (tenantId: number, from?: string, to?: string) => {
  const p = new URLSearchParams()
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  const qs = p.toString()
  return get<BillingDailyRow[]>(`/platform/billing/tenants/${tenantId}/daily${qs ? `?${qs}` : ''}`)
}
export const recomputeBillingDaily = (tenantId: number, date: string) =>
  post<{ date: string; rows: number }>(`/platform/billing/tenants/${tenantId}/daily/recompute`, { date })

// ── 账单 ──
export type InvoiceStatus = 'draft' | 'issued' | 'confirmed' | 'disputed' | 'settled' | 'void'
export interface Invoice {
  id: number
  invoiceNo: string
  tenantId: number
  tenantCode?: string
  periodStart: string
  periodEnd: string
  currency: string
  carryIn: number
  carryOut: number
  grossAmount: number
  adjustAmount: number
  totalAmount: number
  status: InvoiceStatus
  disputeReason: string | null
  note: string | null
  issuedAt: string | null
  confirmedAt: string | null
  settledAt: string | null
  createdAt: string
}
export interface InvoiceItem {
  ruleType: string
  label: string
  basisAmount: number
  ratePct: number | null
  amount: number
  detail: Record<string, unknown>
}
export const listInvoices = (params: { tenantId?: number; status?: string } = {}) => {
  const p = new URLSearchParams()
  if (params.tenantId) p.set('tenantId', String(params.tenantId))
  if (params.status) p.set('status', params.status)
  const qs = p.toString()
  return get<Invoice[]>(`/platform/billing/invoices${qs ? `?${qs}` : ''}`)
}
export const getInvoice = (id: number) =>
  get<{ invoice: Invoice; items: InvoiceItem[] }>(`/platform/billing/invoices/${id}`)
export const previewInvoice = (tenantId: number, month?: string) =>
  get<{
    period: { start: string; end: string }
    planName: string | null
    days: number
    missingFx: string[]
    carryIn: number
    carryOut: number
    gross: number
    items: InvoiceItem[]
    basis: Record<string, unknown>
  }>(`/platform/billing/tenants/${tenantId}/invoices/preview${month ? `?month=${month}` : ''}`)
export const generateInvoice = (tenantId: number, month?: string) =>
  post<{ id: number; invoiceNo: string; total: number; itemCount: number }>(
    `/platform/billing/tenants/${tenantId}/invoices`, month ? { month } : {})
export const setInvoiceStatus = (id: number, status: InvoiceStatus, reason?: string) =>
  put<Invoice>(`/platform/billing/invoices/${id}/status`, { status, reason })
export const adjustInvoice = (id: number, adjust: number, note: string) =>
  put<Invoice>(`/platform/billing/invoices/${id}/adjust`, { adjust, note })

// ── 人工队列与催收 ──
export interface ManualQueueRow {
  id: number
  tenantId: number
  code: string
  kind: string
  refType: string | null
  refId: string | null
  currency: string
  amount: number
  reason: string
  status: string
  createdAt: string
}
export const listManualQueue = (status = 'pending') =>
  get<ManualQueueRow[]>(`/platform/billing/manual-queue?status=${status}`)
export const resolveManualQueue = (id: number, status: 'resolved' | 'rejected', note?: string) =>
  put<{ id: number }>(`/platform/billing/manual-queue/${id}`, { status, note })
export const getDunningPolicy = () =>
  get<{ warnDays: number; suspendWithdrawDays: number; suspendDepositDays: number; suspendSiteDays: number }>(
    '/platform/billing/dunning/policy')
export const runDunning = () =>
  post<{ actions: Array<{ tenantCode: string; from: string; to: string; reason: string }> }>(
    '/platform/billing/dunning/run', {})

// ── 平台总览 BI（P2-11）──
export interface OverviewTenant {
  tenantId: number
  code: string
  name: string
  status: string
  planName: string | null
  depositUsdt: number
  withdrawUsdt: number
  turnoverUsdt: number
  ggrUsdt: number
  bonusUsdt: number
  commissionUsdt: number
  netGgrUsdt: number
  depositUsers: number
  firstDepUsers: number
  dau: number
  newUsers: number
  skippedRows: number
}
export interface OverviewTrend {
  statDate: string
  depositUsdt: number
  turnoverUsdt: number
  ggrUsdt: number
  dau: number
  tenants: number
}
export const getPlatformOverview = (from?: string, to?: string) => {
  const p = new URLSearchParams()
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  const qs = p.toString()
  return get<{ period: { from: string; to: string }; tenants: OverviewTenant[]; trend: OverviewTrend[] }>(
    `/platform/billing/overview${qs ? `?${qs}` : ''}`)
}
export const refreshPlatformOverview = () => post<{ ok: boolean }>('/platform/billing/overview/refresh', {})

// ── 混用模式对账（P2-9）──
export interface ReconcileRow {
  tenantId: number
  code: string
  currency: string
  fxRateUsdt: number
  depositPlatform: number
  depositTenant: number
  withdrawPlatform: number
  withdrawTenant: number
  channelFee: number
  mixed: boolean
  channels: Array<{ channel: string; owner: string; amount: number; fee: number; count: number }>
}
export const getReconcile = (from: string, to: string, tenantId?: number) => {
  const p = new URLSearchParams({ from, to })
  if (tenantId) p.set('tenantId', String(tenantId))
  return get<{ period: { from: string; to: string }; rows: ReconcileRow[] }>(
    `/platform/billing/reconcile?${p.toString()}`)
}
