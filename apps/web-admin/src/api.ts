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
export type AdminLoginResult =
  | { token: string; expiresIn: number; role: string; requiresTotp?: false }
  | { requiresTotp: true; challengeToken: string; expiresIn: number }
export const adminLogin = (username: string, password: string) =>
  post<AdminLoginResult>('/admin/auth/login', { username, password })
export const adminLoginTotp = (challengeToken: string, code: string) =>
  post<{ token: string; expiresIn: number; role: string }>('/admin/auth/login/totp', { challengeToken, code })
export const adminLogout = () => post('/admin/auth/logout')
export const adminChangePassword = (currentPassword: string, newPassword: string) =>
  post('/admin/auth/change-password', { currentPassword, newPassword })

export interface AdminTotpStatus {
  enabled: boolean
  confirmedAt: string | null
}
export interface AdminTotpSetup {
  secret: string
  otpauthUri: string
  expiresIn: number
}
export const getAdminTotpStatus = () => get<AdminTotpStatus>('/admin/security/totp/status')
export const setupAdminTotp = () => post<AdminTotpSetup>('/admin/security/totp/setup')
export const enableAdminTotp = (code: string) => post<{ enabled: boolean }>('/admin/security/totp/enable', { code })
export const disableAdminTotp = (code?: string) => post<{ enabled: boolean }>('/admin/security/totp/disable', { code })
export const cancelAdminTotpSetup = () => post('/admin/security/totp/cancel-setup')

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
  registeredAt: string; balance: number; level: number
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
    level: number
    totalTurnover: number
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
export const SUPPORTED_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX', 'TRX_TESTNET', 'BNB', 'ETH', 'BTC'] as const
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]

export const adjustBalance = (id: string, amount: number, opPassword: string, currency: string, note?: string) =>
  post<{ available: number; orderId: string }>(`/admin/users/${id}/adjust-balance`, { amount, opPassword, currency, note })

export interface AdminLedgerRecord {
  id: string
  userId: string
  type: string
  currency: string
  amount: number
  balanceAfter: number
  refType: string | null
  refId: string | null
  description: string
  traceId: string | null
  createdAt: string
}

export const getLedgerRecords = (params: {
  page?: number
  pageSize?: number
  userId?: string
  type?: string
  currency?: string
  from?: string
  to?: string
}) =>
  get<{ total: number; items: AdminLedgerRecord[]; page: number; pageSize: number }>('/admin/ledger', params)

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
    badgeIgnored: boolean
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
export const ignoreKyc = (userId: string) =>
  post<{ ignored: boolean }>(`/admin/kyc/${userId}/ignore`)

export interface KycStepSettings { requireDocument: boolean; requireFace: boolean; faceMatchThreshold: number }
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
export const getWin568KeyRotationSettings = () => get<{ enabled: boolean }>('/admin/settings/win568-key-rotation')
export const updateWin568KeyRotationSettings = (enabled: boolean) => put<{ enabled: boolean }>('/admin/settings/win568-key-rotation', { enabled })
export interface SystemParams {
  smsDailyLimitPerUser: number
  smsDailyLimitPerIp: number
  otpLockSeconds: number
  kycDocFailureLimit: number
  kycFaceFailureLimit: number
  loginPasswordFailureLimit: number
  loginPasswordLockSeconds: number
}
export const getSystemParams = () => get<SystemParams>('/admin/settings/system-params')
export const updateSystemParams = (params: SystemParams) => put<SystemParams>('/admin/settings/system-params', params)

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
export type ReviewScope = 'user' | 'team'
export const getReviewConfig = (scope: ReviewScope = 'user') =>
  get<{ config: ReviewConfigItem[] }>(`/admin/review/config?scope=${scope}`)
export const saveReviewConfig = (scope: ReviewScope, config: { ruleCode: string; enabled: boolean; threshold?: number | null; params?: Record<string, number> | null }[]) =>
  req<{ saved: number }>('PUT', '/admin/review/config', { scope, config })

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
  type: 'games_sync' | 'games_translate' | 'win568_games_sync'
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  total: number
  message: string
  result?: { synced?: number; translated?: number; errors?: number; total?: number }
  error?: string
}

export const startSyncGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/sync', {})
export const startWin568SyncGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/win568-sync', {})
export const startTranslateGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/translate', {})
export const getGameJob = (jobId: string) =>
  get<AdminGameJob>(`/admin/games/jobs/${jobId}`)

export interface ProviderStat { provider: string; total: number; active: number; rtps?: number[] }
export const getProviderStats = () =>
  get<ProviderStat[]>('/admin/games/provider-stats')
export const toggleProviderGames = (provider: string, isActive: boolean) =>
  post<{ provider: string; isActive: boolean; affected: number }>('/admin/games/provider-toggle', { provider, isActive })

export interface AdminWin568Game {
  uuid: string
  gameId: number
  gameProviderId: number
  provider: string
  name: string
  nameEn: string | null
  nameZh: string | null
  nameOverride: string | null
  imageUrl: string | null
  iconUrl: string | null
  iconWidth: number | null
  iconHeight: number | null
  iconProbedAt: string | null
  coverStatus: 'landscape' | 'portrait' | 'square' | 'none'
  imageOverride: string | null
  newGameType: number | null
  gameType: number | null
  sortCategory: string
  overrideSortCategory: string | null
  siteCategory: string
  siteCategoryAuto: string | null
  overrideSiteCategory: string | null
  rankNo: number | null
  device: string | null
  platform: string | null
  rtp: number | null
  rowsCount: number | null
  reelsCount: number | null
  linesCount: number | null
  supportedCurrencies: unknown
  blockCountries: unknown
  upstreamAvailable: boolean
  localActive: boolean
  isActive: boolean
  isEnabled: boolean
  isMaintain: boolean
  providerStatus: string | null
  isProviderOnline: boolean
  isProvideCommission: boolean
  hasHedgeBet: boolean
  weight: number
  overrideWeight: number | null
  phBonus: number | null
  weightBreakdown: unknown
  theme: string | null
  gameStyle: string | null
  playerType: string | null
  descriptionEn: string | null
  descriptionZh: string | null
  searchKeywords: string | null
  volatility: string | null
  maxWinMultiplier: number | null
  rtpOfficial: number | null
  releaseDate: string | null
  minBet: number | null
  maxBet: number | null
  series: string | null
  features: unknown
  similarGames: unknown
  riskFlags: unknown
  taglineEn: string | null
  taglineTl: string | null
  descriptionTl: string | null
  webEnrichedAt: string | null
  weightUpdatedAt: string | null
  isFeatured: boolean
  overrideFeatured: boolean | null
  overrideActive: boolean | null
  syncedAt: string | null
  updatedAt: string | null
}

export const getAdminWin568Games = (params: {
  page?: number
  pageSize?: number
  provider?: string | string[]
  search?: string
  isActive?: boolean
  upstreamAvailable?: boolean
  sortCategory?: string
  siteCategory?: string
  volatility?: string
  newGameType?: number
  currency?: string
  device?: string
  isFeatured?: boolean
  coverStatus?: 'landscape' | 'portrait' | 'square' | 'none'
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}) =>
  get<{ total: number; items: AdminWin568Game[]; providers: string[] }>('/admin/games/win568', params)
export const toggleWin568Game = (gameProviderId: number, gameId: number, isActive: boolean) =>
  patch<{ gameProviderId: number; gameId: number; isActive: boolean }>(`/admin/games/win568/${gameProviderId}/${gameId}/toggle`, { isActive })
export const updateWin568Game = (gameProviderId: number, gameId: number, data: {
  isActive?: boolean | null
  weight?: number | null
  isFeatured?: boolean | null
  sortCategory?: string | null
  siteCategory?: string | null
  nameOverride?: string | null
  imageOverride?: string | null
  imageOverrideSource?: string | null
  imageAnim?: string | null
}) =>
  patch<{ gameProviderId: number; gameId: number }>(`/admin/games/win568/${gameProviderId}/${gameId}`, data)
export interface CoverCandidate { source: string; url: string; animUrl: string | null }
export const getWin568CoverCandidates = (gameProviderId: number, gameId: number) =>
  get<{ candidates: CoverCandidate[]; currentSource: string; currentUrl: string }>(`/admin/games/win568/${gameProviderId}/${gameId}/cover-candidates`)
export const enrichWin568Game = (gameProviderId: number, gameId: number) =>
  post<{ gameProviderId: number; gameId: number; game: AdminWin568Game | null }>(`/admin/games/win568/${gameProviderId}/${gameId}/enrich`, {})
export const getWin568ProviderStats = () =>
  get<ProviderStat[]>('/admin/games/win568-provider-stats')
export const toggleWin568ProviderGames = (provider: string, isActive: boolean) =>
  post<{ provider: string; isActive: boolean; affected: number }>('/admin/games/win568-provider-toggle', { provider, isActive })

// 首页板块手动干预（pin/exclude）
export interface HomepageSectionEntry {
  sectionKey: string
  gameUuid: string
  action: 'pin' | 'exclude'
  pinPosition: number | null
  currency: string
  sortOrder: number
  name: string | null
  provider: string | null
  imageUrl: string | null
  siteCategory: string | null
}
export const getHomepageSections = () =>
  get<{ sectionKeys: string[]; sections: Record<string, HomepageSectionEntry[]> }>('/admin/games/homepage-sections')
// 当前实际推荐结果（各板块生效列表，pin 已合并/exclude 已剔除），做后台编辑基线
export interface PublicHomepageGame { uuid: string; name: string; provider: string; imageUrl: string | null; supportsActiveCurrency?: boolean }
export const getPublicHomepage = (currency: string) =>
  get<Record<string, PublicHomepageGame[]>>('/slots/homepage', { currency })
export const putHomepageSection = (
  sectionKey: string,
  currency: string,
  items: { gameUuid: string; action: 'pin' | 'exclude'; pinPosition: number | null }[],
) => put<{ ok: boolean }>(`/admin/games/homepage-sections/${sectionKey}`, { currency, items })

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

// Promo Config
export interface FirstDepTier { depositAmount: number; bonusAmount: number }
export const FIRSTDEP_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TON', 'TRX'] as const
export type FirstDepCurrency = (typeof FIRSTDEP_CURRENCIES)[number]
export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  referral: { inviterAmount: number; inviteeAmount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { enabled: boolean; turnoverX: number; turnoverDays: number; tiers: Record<string, FirstDepTier[]> }
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

// 首页装修
export interface HomeContentItem {
  kind: 'banner' | 'card' | 'wallet_banner'
  slot: number
  imageKey: string
  imageUrl: string
  actionType: 'promo' | 'cashback' | 'spin' | 'lobby' | 'none' | 'path' | 'url'
  actionValue: string | null
  enabled: boolean
  updatedAt: string | null
}
export interface HomeContent {
  banners: HomeContentItem[]
  cards: HomeContentItem[]
  walletBanners: HomeContentItem[]
}
export const getHomeContent = () => get<HomeContent>('/admin/home-content')
export const uploadHomeImage = (kind: HomeContentItem['kind'], imageData: string) =>
  post<{ imageKey: string; imageUrl: string }>('/admin/home-content/upload', { kind, imageData })
export const saveHomeContentItem = (item: Pick<HomeContentItem, 'kind' | 'slot' | 'imageKey' | 'actionType' | 'actionValue' | 'enabled'>) =>
  req<HomeContentItem>('PUT', '/admin/home-content/item', item)
export const deleteHomeContentItem = (kind: HomeContentItem['kind'], slot: number) =>
  req<{ ok: boolean }>('DELETE', `/admin/home-content/item/${kind}/${slot}`)

// Rewards Spin
export interface SpinDepositRule {
  id?: number
  name: string
  minDepositPhp: number
  depositAmountPhp?: number
  maxDepositPhp: number | null
  chances: number
  enabled: boolean
  sortOrder: number
  remainingChances?: number
}
export interface SpinPrize {
  id?: number
  ruleId?: number | null
  name: string
  imageKey: string
  amountPhp: number
  weight: number
  turnoverX: number
  enabled: boolean
  sortOrder: number
}
export interface SpinConfig {
  enabled: boolean
  depositRules: SpinDepositRule[]
  prizes: SpinPrize[]
}
export interface SpinRecord {
  id: string
  userId: string
  displayName: string
  prizeName: string
  amountPhp: number
  createdAt: string
}
export const getSpinConfig = () => get<SpinConfig>('/admin/spin/config')
export const saveSpinConfig = (data: SpinConfig) => req<SpinConfig>('PUT', '/admin/spin/config', data)
export const getSpinRecords = (params?: { page?: number; pageSize?: number; userId?: string }) =>
  get<{ items: SpinRecord[]; total: number; page: number; pageSize: number }>('/admin/spin/records', params)

// Rebate
export interface RebateConfigItem {
  level: number
  gameCategory: string
  ratePct: number
  maxBonus: number
  enabled: boolean
}
export interface RebateThresholdItem {
  level: number
  minTurnover: number
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
  get<{ config: RebateConfigItem[]; thresholds: RebateThresholdItem[] }>('/admin/rebate/config')
export const saveRebateConfig = (config: RebateConfigItem[]) =>
  req<{ saved: number }>('PUT', '/admin/rebate/config', { config })
export const saveRebateThresholds = (thresholds: RebateThresholdItem[]) =>
  req<{ saved: number }>('PUT', '/admin/rebate/thresholds', { thresholds })
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
  rejectedKyc: number
}
export const getAdminBadges = () => get<AdminBadges>('/admin/dashboard/badges')

// ── 支付渠道管理 ──────────────────────────────────────────────────────────────

export type PaymentTxType = 'deposit' | 'withdraw' | 'both'

export interface PaymentChannelRule {
  id: number; channelId: number; currency: string
  txType: PaymentTxType
  amountMin: number | null; amountMax: number | null
  weight: number; enabled: boolean
  createdAt: string; updatedAt: string
}
export interface PaymentChannel {
  id: number; name: string; provider: string; label: string; category: string
  depositFeeType: FeeType; depositFeeValue: number
  withdrawFeeType: FeeType; withdrawFeeValue: number
  enabled: boolean; sortOrder: number; rules: PaymentChannelRule[]
  createdAt: string; updatedAt: string
}
export type FeeType = 'none' | 'percent' | 'fixed'

export const getPaymentChannels = () => get<PaymentChannel[]>('/admin/payment/channels')

export const createPaymentChannel = (data: {
  name: string; provider: string; label: string; category?: string
  depositFeeType?: FeeType; depositFeeValue?: number
  withdrawFeeType?: FeeType; withdrawFeeValue?: number
  enabled: boolean; sortOrder: number
}) => post<{ id: number }>('/admin/payment/channels', data)

export const updatePaymentChannel = (id: number, data: Partial<{
  name: string; provider: string; label: string; category: string
  depositFeeType: FeeType; depositFeeValue: number
  withdrawFeeType: FeeType; withdrawFeeValue: number
  enabled: boolean; sortOrder: number
}>) => req<null>('PUT', `/admin/payment/channels/${id}`, data)

export const deletePaymentChannel = (id: number) =>
  req<null>('DELETE', `/admin/payment/channels/${id}`)

export const createPaymentRule = (channelId: number, data: {
  currency: string; txType: PaymentTxType; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean
}) => post<{ id: number }>(`/admin/payment/channels/${channelId}/rules`, data)

export const updatePaymentRule = (id: number, data: Partial<{
  currency: string; txType: PaymentTxType; amountMin: number | null; amountMax: number | null; weight: number; enabled: boolean
}>) => req<null>('PUT', `/admin/payment/rules/${id}`, data)

export const deletePaymentRule = (id: number) =>
  req<null>('DELETE', `/admin/payment/rules/${id}`)

// ── 支付渠道记账 ──────────────────────────────────────────────────────────────

export interface PaymentAccountingRow {
  provider: string; label: string
  depositAmount: number; depositCount: number
  withdrawAmount: number; withdrawCount: number
  feeAmount: number; netAmount: number; bookBalance: number
}
export interface ProviderBalanceRow {
  provider: string; label: string
  balance: number; frozen: number; observedBalance: number; bookBalance: number; diffAmount: number
  diffStatus: 'normal' | 'mismatch' | 'error'
  currency: string
  status: 'ok' | 'error'; errorMsg: string | null; updatedAt: string | null
}

export const getPaymentAccounting = (range: { from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams()
  if (range.from) qs.set('from', range.from)
  if (range.to) qs.set('to', range.to)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return get<{ rows: PaymentAccountingRow[]; total: PaymentAccountingRow }>(`/admin/payment/accounting${suffix}`)
}
export const getProviderBalances = () => get<ProviderBalanceRow[]>('/admin/payment/balance')
export const refreshProviderBalances = () => post<ProviderBalanceRow[]>('/admin/payment/balance/refresh', {})

// ── 代理分成 ───────────────────────────────────────────────────────────────
const del = <T>(url: string) => req<T>('DELETE', url)

export interface AgentListItem {
  agent_id: string; name: string; ggr_rate_pct: string; status: 'active' | 'disabled'
  display_name: string; user_count: number; channel_count: number
  this_month_commission_cents: number; created_at: string
}
export interface AgentDomain {
  id: number; domain: string; label: string; enabled: number
  agent_id: string | null; agent_name: string | null; created_at: string
}
export interface AgentBot {
  id: number; bot_username: string; bot_id: number | null; label: string; enabled: number
  agent_id: string | null; agent_name: string | null; created_at: string
}
export interface AgentDetail {
  agent_id: string; name: string; ggr_rate_pct: string; status: 'active' | 'disabled'
  remark: string; display_name: string; user_count: number; created_at: string
}
export interface AgentUser {
  user_id: string; source: 'domain' | 'bot' | 'manual'; bound_at: string
  display_name: string; registered_at: string; ggr_cents: number
}
export interface AgentCommission {
  period: string; ggr_cents: number; carry_in_cents: number; net_ggr_cents: number
  carry_out_cents: number; rate_pct: string; commission_cents: number
  status: 'pending' | 'paid' | 'voided'; paid_at: string | null; settled_at: string
}
export interface AgentCommissionReportItem {
  agent_id: string; name: string; ggr_cents: number; carry_in_cents: number; net_ggr_cents: number
  carry_out_cents: number; rate_pct: string; commission_cents: number
  status: 'pending' | 'paid' | 'voided'; paid_at: string | null
}

export const getAgentList = (params: { search?: string; page?: number; pageSize?: number }) =>
  get<{ total: number; page: number; pageSize: number; items: AgentListItem[] }>('/admin/agent/list', params)
export const createAgent = (data: { userId: string; name?: string; ggrRatePct: number; remark?: string; domainIds?: number[]; botIds?: number[] }) =>
  post<{ agentId: string }>('/admin/agent', data)
export const updateAgent = (agentId: string, data: { name?: string; ggrRatePct?: number; status?: string; remark?: string }) =>
  patch(`/admin/agent/${agentId}`, data)
export const getAgentDetail = (agentId: string) =>
  get<{ agent: AgentDetail; domains: AgentDomain[]; bots: AgentBot[] }>(`/admin/agent/${agentId}`)
export const getAgentUsers = (agentId: string, params: { page?: number; pageSize?: number }) =>
  get<{ total: number; page: number; pageSize: number; items: AgentUser[] }>(`/admin/agent/${agentId}/users`, params)
export const getAgentCommissions = (agentId: string) =>
  get<{ items: AgentCommission[] }>(`/admin/agent/${agentId}/commissions`)

// 域名管理
export const getAgentDomains = (onlyUnassigned?: boolean) =>
  get<{ items: AgentDomain[] }>('/admin/agent/domains', onlyUnassigned ? { onlyUnassigned: '1' } : undefined)
export const createAgentDomain = (data: { domain: string; label?: string; agentId?: string }) =>
  post<{ id: number; domain: string }>('/admin/agent/domains', data)
export const updateAgentDomain = (id: number, data: { label?: string; enabled?: boolean; agentId?: string | null }) =>
  patch(`/admin/agent/domains/${id}`, data)
export const deleteAgentDomain = (id: number) =>
  del(`/admin/agent/domains/${id}`)
export const assignDomainToAgent = (agentId: string, domainId: number) =>
  patch(`/admin/agent/${agentId}/assign-domain`, { domainId })

// 机器人管理
export const getAgentBots = (onlyUnassigned?: boolean) =>
  get<{ items: AgentBot[] }>('/admin/agent/bots', onlyUnassigned ? { onlyUnassigned: '1' } : undefined)
export const createAgentBot = (data: { botToken: string; label?: string; agentId?: string }) =>
  post<{ id: number; botUsername: string; botId: number }>('/admin/agent/bots', data)
export const updateAgentBot = (id: number, data: { label?: string; enabled?: boolean; agentId?: string | null }) =>
  patch(`/admin/agent/bots/${id}`, data)
export const deleteAgentBot = (id: number) =>
  del(`/admin/agent/bots/${id}`)
export const assignBotToAgent = (agentId: string, botId: number) =>
  patch(`/admin/agent/${agentId}/assign-bot`, { botId })
export const bindUserToAgent = (userId: string, agentId: string) =>
  post('/admin/agent/bind-user', { userId, agentId })
export const unbindUserAgent = (userId: string) =>
  del(`/admin/agent/user/${userId}`)
export const getUserAgentInfo = (userId: string) =>
  get<{ isAgent: boolean; agent: AgentDetail | null; attributedTo: { agent_id: string; agent_name: string; source: string; bound_at: string } | null }>(`/admin/agent/user/${userId}/info`)
export const settleAgentMonth = (period?: string) =>
  post<{ period: string; agentCount: number; totalCommissionCents: number }>('/admin/agent/settle', { period })
export const getAgentCommissionReport = (period?: string) =>
  get<{ period: string; summary: { total_commission_cents: number; pending_cents: number }; items: AgentCommissionReportItem[] }>('/admin/agent/commissions/report', period ? { period } : undefined)
export const payAgentCommission = (agentId: string, period: string) =>
  post('/admin/agent/commission/pay', { agentId, period })
