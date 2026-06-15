import axios from 'axios'

const BASE = import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/v1'

export const http = axios.create({ baseURL: BASE })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('admin_token')) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_role')
      window.location.href = '/login'
    }
    return Promise.reject(new Error(err.response?.data?.message ?? err.message))
  },
)

export interface ApiResp<T = unknown> {
  code: number
  message: string
  data: T
}

async function req<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const resp = await http.request<ApiResp<T>>({ method, url, data: payload, params: method === 'GET' ? payload : undefined })
  if (resp.data.code !== 0) throw new Error(resp.data.message)
  return resp.data.data
}

const get = <T>(url: string, params?: unknown) => req<T>('GET', url, params)
const post = <T>(url: string, data?: unknown) => req<T>('POST', url, data)
const patch = <T>(url: string, data?: unknown) => req<T>('PATCH', url, data)
const put = <T>(url: string, data?: unknown) => req<T>('PUT', url, data)

// Auth
export const adminLogin = (username: string, password: string) =>
  post<{ token: string; expiresIn: number; role: string }>('/admin/auth/login', { username, password })
export const adminLogout = () => post('/admin/auth/logout')
export const adminChangePassword = (currentPassword: string, newPassword: string) =>
  post('/admin/auth/change-password', { currentPassword, newPassword })

// Dashboard
export const getDashboard = () => get<{
  totalUsers: number; activeUsers: number; frozenUsers: number
  todayDepositCount: number; todayDepositAmount: number
  todayWithdrawCount: number; todayWithdrawAmount: number
  pendingWithdrawCount: number; totalBalance: number
  sgMultiCurrency: boolean
}>('/admin/dashboard')

// Users
export interface AdminUser {
  id: string; displayName: string; email: string | null; telegramUsername: string | null
  status: string; label: string
  lastLoginAt: string | null; lastLoginRegion: string | null
  registerRegion: string | null
  registeredAt: string; balance: number
}
export interface LoginLog {
  id: number; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; createdAt: string
}
export interface BetOrder {
  id: number; providerTxnId: string; roundId: string | null
  betType: string; amount: number; currencyCode: string; status: string; createdAt: string
}
export interface LedgerEntry {
  id: string; type: string; amount: number; currency: string
  balanceAfter: number; description: string; createdAt: string
}
export const getUsers = (params: { page?: number; pageSize?: number; search?: string; status?: string }) =>
  get<{ total: number; items: AdminUser[] }>('/admin/users', params)
export type KycOverrideMode = 'inherit' | 'on' | 'off'

export interface KycUserConfig {
  system: KycStepSettings
  effective: KycStepSettings
  docOverride: boolean | null
  faceOverride: boolean | null
}

export const getUserDetail = (id: string) =>
  get<{
    user: Record<string, unknown>
    wallet: { available: number; frozen: number }
    ledger: LedgerEntry[]
    loginLogs: LoginLog[]
    betOrders: BetOrder[]
    kycConfig: KycUserConfig
    kyc: AdminKycSummary | null
  }>(`/admin/users/${id}`)
export const updateUserKycOverride = (
  id: string,
  requireDocument: KycOverrideMode,
  requireFace: KycOverrideMode,
) =>
  patch<{
    docOverride: boolean | null
    faceOverride: boolean | null
    effective: KycStepSettings
  }>(`/admin/users/${id}/kyc-override`, { requireDocument, requireFace })
export const updateUserStatus = (id: string, status: string, reason?: string) =>
  patch<{ status: string }>(`/admin/users/${id}/status`, { status, reason })
export const updateUserLabel = (id: string, label: string) =>
  patch<{ label: string }>(`/admin/users/${id}/label`, { label })
export interface UserProfileData { firstName: string; lastName: string; gender: string; dobMonth: string; dobDay: string; dobYear: string; phone?: string; email?: string }
export const updateUserProfile = (id: string, profile: Partial<UserProfileData>) =>
  patch<{ profile: UserProfileData }>(`/admin/users/${id}/profile`, profile)
export const SUPPORTED_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX', 'TRX_TESTNET', 'BNB', 'ETH', 'BTC'] as const
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]

export const adjustBalance = (id: string, amount: number, opPassword: string, currency: string, note?: string) =>
  post<{ available: number; orderId: string }>(`/admin/users/${id}/adjust-balance`, { amount, opPassword, currency, note })

// KYC
export interface AdminKycSummary {
  status: string
  phoneVerified: boolean
  docVerified: boolean
  faceVerified: boolean
  phone: string | null
  fullName: string | null
  docType: string | null
  rejectReason: string | null
  rejectStep: string | null
  extractedIdNo: string | null
  docSubmittedAt: string | null
  faceSubmittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface AdminKycListItem {
  userId: string
  displayName: string | null
  status: string
  phone: string | null
  fullName: string | null
  docType: string | null
  phoneVerified: boolean
  docVerified: boolean
  faceVerified: boolean
  submittedAt: string | null
  docSubmittedAt: string | null
  faceSubmittedAt: string | null
  reviewedAt: string | null
}

export interface AdminKycDetail {
  user: { id: string; displayName: string | null; status: string } | null
  kyc: AdminKycSummary & {
    geminiConfidence: number | null
    geminiResult: Record<string, unknown> | null
    docImageKey: string | null
    livenessFrames: { action: string; key: string; capturedAt: string }[] | null
    submittedAt: string | null
  }
}

export interface KycDocLogItem {
  id: number
  fullName: string | null
  docType: string | null
  docImageKey: string | null
  geminiConfidence: number | null
  docVerified: boolean
  rejectReason: string | null
  submittedAt: string
}

export const getKycList = (params: { page?: number; pageSize?: number; status?: string }) =>
  get<{ total: number; page: number; pageSize: number; items: AdminKycListItem[] }>('/admin/kyc', params)

export const getKycDocLog = (userId: string) =>
  get<{ items: KycDocLogItem[] }>(`/admin/kyc/${userId}/doc-log`)

export const getKycDetail = (userId: string) =>
  get<AdminKycDetail>(`/admin/kyc/${userId}`)

export const reviewKyc = (userId: string, decision: 'approve' | 'reject', note?: string) =>
  post<{ status: string }>(`/admin/kyc/${userId}/${decision}`, { note })

export interface KycStepSettings { requireDocument: boolean; requireFace: boolean }
export const getKycSettings = () => get<KycStepSettings>('/admin/settings/kyc')
export const setKycSettings = (s: KycStepSettings) => put<KycStepSettings>('/admin/settings/kyc', s)

export async function fetchKycImageBlob(userId: string, key: string): Promise<string> {
  const resp = await http.get(`/admin/kyc/${userId}/images/${encodeURIComponent(key)}`, { responseType: 'blob' })
  return URL.createObjectURL(resp.data as Blob)
}

export interface TurnoverRequirement {
  id: number; sourceType: string; sourceRef: string
  requiredAmount: number; completedAmount: number
  status: 'pending' | 'completed' | 'expired' | 'cancelled'
  expiresAt: string | null; createdAt: string; updatedAt: string
}
export const getUserTurnover = (id: string) =>
  get<{ canWithdraw: boolean; totalRemaining: number; requirements: TurnoverRequirement[] }>(`/admin/users/${id}/turnover`)
export const adjustTurnoverRequirement = (id: string, reqId: number, action: 'adjust' | 'cancel', completedAmount?: number, reason?: string) =>
  patch<{ success: boolean }>(`/admin/users/${id}/turnover/${reqId}`, { action, completedAmount, reason })

// Settings - op password
export const getOpPasswordStatus = () =>
  get<{ configured: boolean }>('/admin/settings/op-password')
export const setOpPassword = (newPassword: string, currentPassword?: string) =>
  post('/admin/settings/op-password', { newPassword, currentPassword })

export interface SmsSendLogEntry {
  id: string
  scene: string
  userId: string
  phone: string
  code: string
  text: string
  mocked: boolean
  createdAt: string
}
export const getSmsSettings = () => get<{ testMode: boolean }>('/admin/settings/sms')
export const updateSmsSettings = (testMode: boolean) => put<{ testMode: boolean }>('/admin/settings/sms', { testMode })
export const getSmsSendLogs = () => get<SmsSendLogEntry[]>('/admin/settings/sms/logs')

// Deposits
export interface AdminDeposit {
  orderId: string; userId: string; amount: number; currency: string; channelId: string
  status: string; createdAt: string; paidAt: string | null; credited: number | null
}
export const getDeposits = (params: { page?: number; pageSize?: number; userId?: string; status?: string }) =>
  get<{ total: number; items: AdminDeposit[] }>('/admin/deposits', params)

// Withdrawals
export interface AdminWithdrawal {
  orderId: string; userId: string; amount: number; currency: string; channelId: string
  status: string; reviewVerdict: string | null; reviewedAt: string | null
  createdAt: string; completedAt: string | null; rejectReason: string | null
}
export const getWithdrawals = (params: { page?: number; pageSize?: number; userId?: string; status?: string; reviewVerdict?: string }) =>
  get<{ total: number; items: AdminWithdrawal[] }>('/admin/withdrawals', params)
export const approveWithdrawal = (orderId: string) =>
  post<{ orderId: string; status: string }>(`/admin/withdrawals/${orderId}/approve`)
export const rejectWithdrawal = (orderId: string, reason: string) =>
  post<{ orderId: string; status: string }>(`/admin/withdrawals/${orderId}/reject`, { reason })

// 自动审核
export interface ReviewRuleResult {
  ruleCode: string; ruleName: string; verdict: string
  actualValue: number | null; threshold: number | null
  detail: Record<string, unknown> | null; createdAt: string
}
export const getWithdrawalReview = (orderId: string) =>
  get<{ rules: ReviewRuleResult[] }>(`/admin/withdrawals/${orderId}/review`)

export interface ReviewConfigItem {
  ruleCode: string; name: string; desc: string
  enabled: boolean; threshold: number | null
  params: Record<string, number> | null; updatedAt: string | null
}
export const getReviewConfig = () =>
  get<{ config: ReviewConfigItem[] }>('/admin/review/config')
export const saveReviewConfig = (config: { ruleCode: string; enabled: boolean; threshold?: number | null; params?: Record<string, number> | null }[]) =>
  req<{ saved: number }>('PUT', '/admin/review/config', { config })

// 审核总览
export interface ReviewOverview {
  autoApproveRate: number | null
  manualBacklog: number; overdue: number; totalReviewed7d: number
  topHits: { ruleCode: string; name: string; count: number }[]
  trend: { date: string; pass: number; manual: number }[]
}
export const getReviewOverview = () => get<ReviewOverview>('/admin/review/overview')

// 提案审核记录 / 待人工队列
export interface ReviewProposal {
  orderId: string; userId: string; displayName: string | null
  channelId: string; currency: string; amount: number; status: string
  reviewVerdict: string | null; reviewedAt: string | null; reviewMs: number | null
  handledBy: string | null; handledAt: string | null; createdAt: string
  hitRules: { code: string; name: string }[]
}
export const getReviewProposals = (params: { page?: number; pageSize?: number; userId?: string; status?: string; reviewVerdict?: string; queue?: string }) =>
  get<{ total: number; page: number; pageSize: number; items: ReviewProposal[] }>('/admin/review/proposals', params)

export interface ReviewProposalDetail {
  order: {
    orderId: string; userId: string; channelId: string; currency: string; amount: number; status: string
    reviewVerdict: string | null; reviewedAt: string | null; reviewRound: number | null; reviewMs: number | null
    rejectReason: string | null; handledBy: string | null; handledAt: string | null; createdAt: string
  }
  user: {
    userId: string; displayName: string | null; status: string | null; email: string | null
    registeredAt: string | null; inviterId: string | null; kycStatus: string | null
    walletAvailable: number; walletFrozen: number
  }
  snapshot: Record<string, number | string | boolean> | null
  rules: ReviewRuleResult[]
  related: { ip: { userId: string; ip: string }[]; device: { userId: string; deviceId: string }[] }
}
export const getReviewProposalDetail = (orderId: string) =>
  get<ReviewProposalDetail>(`/admin/review/proposals/${orderId}`)
export const rerunReview = (orderId: string) =>
  post<{ round: number }>(`/admin/review/proposals/${orderId}/rerun`)

export interface ManualQueueItem {
  kind: 'user' | 'team'
  id: string
  userId: string
  displayName: string | null
  amount: number
  currency: string
  status: string
  handledBy: string | null
  handledAt: string | null
  createdAt: string
  hitRules: { code: string; name: string }[]
}
export const getManualQueue = (params: { page?: number; pageSize?: number }) =>
  get<{ total: number; page: number; pageSize: number; items: ManualQueueItem[] }>('/admin/review/manual-queue', params)
export const approveTeamWithdrawal = (id: string) =>
  post(`/admin/review/team-withdrawals/${id}/approve`)
export const rejectTeamWithdrawal = (id: string, reason?: string) =>
  post(`/admin/review/team-withdrawals/${id}/reject`, { reason })

// 风控名单
export interface BlacklistItem {
  id: number; type: string; value: string; reason: string | null; createdBy: string | null; createdAt: string
}
export const getBlacklist = (type?: string) =>
  get<{ items: BlacklistItem[] }>('/admin/review/blacklist', type ? { type } : undefined)
export const addBlacklist = (data: { type: string; value: string; reason?: string }) =>
  post<{ added: boolean }>('/admin/review/blacklist', data)
export const removeBlacklist = (id: number) =>
  req<{ deleted: number }>('DELETE', `/admin/review/blacklist/${id}`)

// Games
export interface AdminGame {
  uuid: string; name: string; nameId: string | null; nameVi: string | null; nameZh: string | null
  type: string | null; provider: string; providerId: number | null
  technology: string | null; category: string | null; subCategory: string | null
  imageUrl: string | null; imageHqUrl: string | null
  hasDemo: boolean; hasLobby: boolean; isMobile: boolean
  hasFreespins: boolean; hasTables: boolean
  label: string | null; rtp: number | null; volatility: string | null
  reelsCount: string | null; linesCount: number | null
  tags: string[]; isActive: boolean; updatedAt: string | null
  weight: number; phBonus: number; isFeatured: boolean; sortCategory: string | null
  theme: string | null; gameStyle: string | null; playerType: string | null
  descriptionEn: string | null; descriptionZh: string | null
  searchKeywords: string | null; weightUpdatedAt: string | null
}
export const getAdminGames = (params: {
  page?: number; pageSize?: number; provider?: string; search?: string; isActive?: boolean
  type?: string; sortCategory?: string; volatility?: string; isFeatured?: boolean
  hasDemo?: boolean; theme?: string; gameStyle?: string; playerType?: string
  technology?: string
  weightMin?: number; weightMax?: number
  sortField?: string; sortOrder?: 'asc' | 'desc'
}) =>
  get<{ total: number; items: AdminGame[]; providers: string[] }>('/admin/games', params)
export const toggleGame = (uuid: string, isActive: boolean) =>
  patch<{ uuid: string; isActive: boolean }>(`/admin/games/${uuid}/toggle`, { isActive })
export interface AdminGameJob {
  id: string
  type: 'games_sync' | 'games_translate'
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  total: number
  message: string
  result?: { synced?: number; translated?: number; errors?: number; total?: number }
  error?: string
}

export const startSyncGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/sync', {})
export const startTranslateGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/translate', {})
export const getGameJob = (jobId: string) =>
  get<AdminGameJob>(`/admin/games/jobs/${jobId}`)

export interface ProviderStat { provider: string; total: number; active: number }
export const getProviderStats = () =>
  get<ProviderStat[]>('/admin/games/provider-stats')
export const toggleProviderGames = (provider: string, isActive: boolean) =>
  post<{ provider: string; isActive: boolean; affected: number }>('/admin/games/provider-toggle', { provider, isActive })

// Audit log
export interface AuditEntry {
  id: number; adminUsername: string; action: string; targetType: string | null
  targetId: string | null; detail: unknown; ip: string | null; createdAt: string
}
export const getAuditLog = (params: { page?: number; pageSize?: number }) =>
  get<{ items: AuditEntry[]; page: number }>('/admin/audit-log', params)

// Customer Service
export interface CsConversation {
  id: number; userId: number; status: string; assignedAdminId: number | null
  displayName: string; lastMessage: string; createdAt: string; updatedAt: string
}
export interface CsMessage {
  id: number; conversationId: number; role: 'user' | 'assistant' | 'admin'
  content: string; createdAt: string
}
export const getCsConversations = (params: { status?: string; page?: number; pageSize?: number }) =>
  get<{ items: CsConversation[]; total: number; page: number; pageSize: number }>('/admin/cs/conversations', params)
export const getCsConversation = (id: number) =>
  get<{ conversation: CsConversation; messages: CsMessage[] }>(`/admin/cs/conversations/${id}`)
export const csReply = (id: number, message: string) =>
  post<CsMessage>(`/admin/cs/conversations/${id}/reply`, { message })
export const csTakeover = (id: number) =>
  post(`/admin/cs/conversations/${id}/takeover`)
export const csResolve = (id: number) =>
  post(`/admin/cs/conversations/${id}/resolve`)

// 汇率管理
export interface ExchangeRate {
  from: string; to: string
  rate: number | null; source: string | null; fetchedAt: string | null
}
export interface RateHistoryBatch {
  id: number; fetchedAt: string; source: string
  rates: Record<string, number>  // { USDT: 58.0, USDC: 58.1, TON: 350.0, ... }
}
export const getExchangeRates = () => get<ExchangeRate[]>('/admin/settings/exchange-rates')
export const getRateHistory = () => get<RateHistoryBatch[]>('/admin/settings/exchange-rates/history')
export const refreshExchangeRates = () => post<ExchangeRate[]>('/admin/settings/exchange-rates/refresh')
export const setManualRate = (from: string, to: string, rate: number) =>
  post('/admin/settings/exchange-rates/manual', { from, to, rate })
export const clearManualRate = (from: string, to: string) =>
  req<null>('DELETE', `/admin/settings/exchange-rates/manual/${from}/${to}`)

// FAQ 知识库
export interface FaqItem {
  id: number; category: string; question: string; answer: string
  lang: string; sort_order: number; is_active: number
  created_at: string; updated_at: string
}
export const getFaqList = (params: { keyword?: string; category?: string; page?: number; pageSize?: number }) =>
  get<{ items: FaqItem[]; total: number; page: number; pageSize: number }>('/admin/cs/faq', params)
export const createFaq = (data: { category: string; question: string; answer: string; lang?: string; sort_order?: number }) =>
  post<FaqItem>('/admin/cs/faq', data)
export const updateFaq = (id: number, data: Partial<{ category: string; question: string; answer: string; lang: string; sort_order: number; is_active: number }>) =>
  req<FaqItem>('PATCH', `/admin/cs/faq/${id}`, data)
export const deleteFaq = (id: number) =>
  req<{ success: boolean }>('DELETE', `/admin/cs/faq/${id}`)

// ── 三级分销管理 ──────────────────────────────────────────────────────────────

export interface TeamOverview {
  activeAgents: number
  thisMonthCommissionCents: number
  pendingWithdrawalCount: number
  pendingWithdrawalCents: number
}

export interface TeamAgent {
  userId: string
  displayName: string
  l1Count: number; l2Count: number; l3Count: number
  thisMonthCommissionCents: number
  lifetimeEarnedCents: number
  optedInAt: string
  ratePlanId: number | null
  ratePlanName: string | null
}

export interface TeamCommission {
  id: number
  beneficiary_id: string; beneficiary_name: string
  from_user_id: string; from_name: string
  level: number; period: string; currency: string
  turnover_cents: number; rate_pct: number; commission_cents: number; php_equivalent_cents: number
  currency_breakdown: { currency: string; betCents: number; fxRate: number }[] | null
  status: string; paid_at: string | null; created_at: string
}

export interface TeamWithdrawalAdmin {
  id: number
  user_id: string; display_name: string
  amount_cents: number; status: string
  reject_reason: string | null; reviewed_at: string | null; created_at: string
}

export interface TeamConfig {
  min_activation_cents: number; min_withdrawal_cents: number
  max_commission_per_settlement_cents: number | null
  settlement_hour: number
  commission_basis: 'ggr' | 'turnover'
  last_auto_settlement: string | null
}

export interface TeamRatePlan {
  id: number; name: string; is_default: number
  l1_rate_pct: number; l2_rate_pct: number; l3_rate_pct: number
  created_at: string; updated_at: string
}

export const getTeamOverview = () =>
  get<TeamOverview>('/admin/team/overview')

export const getTeamAgents = (params?: { search?: string; page?: number; pageSize?: number }) =>
  get<{ items: TeamAgent[]; total: number; page: number; pageSize: number }>('/admin/team/agents', params)

export const getTeamAgentDetail = (userId: string) =>
  get<{ agent: unknown; history: unknown[] }>(`/admin/team/agents/${userId}`)

export interface TeamTreeMember {
  userId: string
  displayName: string
  isAgent: boolean
  thisMonthCents: number
  turnoverCents: number
  currencyBreakdown: { currency: string; betCents: number }[]
  children: TeamTreeMember[]
}
export const getTeamAgentTree = (userId: string, date?: string) =>
  get<{ l1Members: TeamTreeMember[] }>(`/admin/team/agents/${userId}/tree`, date ? { date } : undefined)

export const getTeamCommissions = (params?: { period?: string; beneficiaryId?: string; status?: string; page?: number }) =>
  get<{ items: TeamCommission[]; total: number; page: number; pageSize: number }>('/admin/team/commissions', params)

export const triggerTeamSettle = (date: string, force = false) =>
  post<{ message: string }>('/admin/team/settle', { date, force })

export const getTeamRatePlans = () =>
  get<{ items: TeamRatePlan[] }>('/admin/team/rate-plans')

export const createTeamRatePlan = (data: { name: string; l1_rate_pct: number; l2_rate_pct: number; l3_rate_pct: number }) =>
  post<{ id: number }>('/admin/team/rate-plans', data)

export const updateTeamRatePlan = (id: number, data: Partial<Omit<TeamRatePlan, 'id' | 'is_default' | 'created_at' | 'updated_at'>>) =>
  req<{ ok: boolean }>('PUT', `/admin/team/rate-plans/${id}`, data)

export const setDefaultTeamRatePlan = (id: number) =>
  req<{ ok: boolean }>('PUT', `/admin/team/rate-plans/${id}/default`, {})

export const setAgentRatePlan = (userId: string, planId: number | null) =>
  req<{ ok: boolean }>('PUT', `/admin/team/agents/${userId}/rate-plan`, { planId })

export const getTeamWithdrawals = (params?: { status?: string; page?: number }) =>
  get<{ items: TeamWithdrawalAdmin[]; total: number; page: number; pageSize: number }>('/admin/team/withdrawals', params)


export const getTeamConfig = () =>
  get<TeamConfig>('/admin/team/config')

export const updateTeamConfig = (data: Partial<TeamConfig>) =>
  req<{ ok: boolean }>('PUT', '/admin/team/config', data)

// 投注记录
export interface BetOrderRecord {
  id: number; userId: string; aggregatorId: string; providerId: string
  providerTxnId: string; roundId: string | null
  betType: 'bet' | 'win' | 'refund' | 'cancel'
  amount: number; currencyCode: string
  originalAmount: number | null; exchangeRate: number | null
  status: 'pending' | 'settled' | 'failed'
  createdAt: string; settledAt: string | null
  gameName: string | null; providerName: string | null
}
export interface BetRoundRecord {
  roundId: string; userId: string; currencyCode: string
  betAmount: number; winAmount: number
  gameName: string | null; providerName: string | null
  betTime: string | null; winTime: string | null
}
export interface BetOrderStats {
  totalBet: number; totalWin: number; roundCount: number
}
export const getBetOrders = (params: {
  page?: number; pageSize?: number
  userId?: string; status?: string; betType?: string
  dateFrom?: string; dateTo?: string
}) => get<{ total: number; page: number; pageSize: number; stats: BetOrderStats; items: BetOrderRecord[] }>('/admin/bet-orders', params)

export const getBetRounds = (params: {
  page?: number; pageSize?: number
  userId?: string; dateFrom?: string; dateTo?: string
}) => get<{ total: number; page: number; pageSize: number; stats: BetOrderStats; items: BetRoundRecord[] }>('/admin/bet-orders', { ...params, view: 'round' })

// SG 结算报告
export interface SgSettlementRecord {
  id: number; reportDate: string; currency: string
  sgBetAmount: number; sgWinAmount: number; sgGgr: number; sgRoundCount: number
  localBet: number; localWin: number
  discrepancyNote: string | null; reconciled: number; fetchedAt: string
}
export const getSgSettlements = (params: { page?: number; pageSize?: number }) =>
  get<{ total: number; page: number; pageSize: number; items: SgSettlementRecord[] }>('/admin/sg-settlement', params)
export const triggerReconcile = (date: string) =>
  post('/admin/sg-settlement/reconcile', { date })
export const markReconciled = (id: number) =>
  req<{ id: number }>('PATCH', `/admin/sg-settlement/${id}/reconcile`)

// Promo Config
export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  referral: { inviterAmount: number; inviteeAmount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { matchPct: number; maxBonus: number; minDeposit: number; turnoverX: number; turnoverDays: number; enabled: boolean }
}
export const getPromoConfig = () => get<PromoConfig>('/admin/promotions/config')
export const savePromoConfig = (data: PromoConfig) => req<PromoConfig>('PUT', '/admin/promotions/config', data)

export interface PromoClaimRecord {
  id: string
  userId: string
  displayName: string
  promoName: string
  amount: number
  currency: string
  claimedAt: string
}
export const getPromoClaims = (params?: { page?: number; pageSize?: number; promoId?: string }) =>
  get<{ items: PromoClaimRecord[]; total: number; page: number; pageSize: number }>('/admin/promotions/claims', params)

// Rebate
export interface RebateConfigItem {
  gameCategory: string
  ratePct: number
  enabled: boolean
}
export interface RebateFeaturedGame {
  id: number
  gameUuid: string
  tier: string
  sortOrder: number
  name?: string
  nameZh?: string
  provider?: string
  coverUrl?: string
}
export interface RebateRecord {
  id: number
  userId: string
  displayName: string
  date: string
  gameCategory: string
  currencyCode: string
  betAmount: number
  rebateAmount: number
  ratePct: number
  status: string
  paidAt: string | null
}
export const getRebateConfig = () =>
  get<{ config: RebateConfigItem[] }>('/admin/rebate/config')
export const saveRebateConfig = (config: RebateConfigItem[]) =>
  req<{ saved: number }>('PUT', '/admin/rebate/config', { config })
export const getFeaturedGames = () =>
  get<{ games: RebateFeaturedGame[] }>('/admin/rebate/featured-games')
export const addFeaturedGame = (data: { gameUuid: string; tier: string; sortOrder?: number }) =>
  post('/admin/rebate/featured-games', data)
export const removeFeaturedGame = (id: number) =>
  req('DELETE', `/admin/rebate/featured-games/${id}`)
export const triggerRebatePayout = (date?: string) =>
  req<{ users: number; totalRebate: number }>('POST', '/admin/rebate/payout/manual', { date })
export const getRebateRecords = (params?: { page?: number; pageSize?: number; date?: string; userId?: string }) =>
  get<{ items: RebateRecord[]; total: number; page: number; pageSize: number }>('/admin/rebate/records', params)

export interface AdminBadges {
  manualWithdrawals: number
  pendingCs: number
}
export const getAdminBadges = () => get<AdminBadges>('/admin/dashboard/badges')
