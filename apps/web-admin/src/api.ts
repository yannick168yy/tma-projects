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
}>('/admin/dashboard')

export interface HomeDashboard {
  asOf: string
  todos: { manualWithdrawals: number; rejectedKyc: number; csConversations: number; openAlerts: number }
  today: BiWindowStats
  yesterdaySameTime: BiWindowStats
  balances: {
    wallets: { currency: string; amount: number; php: number }[]
    walletTotalPhp: number
    pendingWithdrawCount: number
    pendingWithdrawPhp: number
    providers: { provider: string; balance: number; currency: string; status: string; updatedAt: string | null }[]
  }
  heartbeat: {
    lastBetAt: string | null
    lastDepositAt: string | null
    lastLoginAt: string | null
    channelsToday: { direction: string; channel: string; total: number; success: number }[]
  }
  users: { total: number; active: number; frozen: number }
}
export const getHomeDashboard = () => get<HomeDashboard>('/admin/dashboard/v2')

// BI 数据分析
export interface BiWindowStats {
  depositAmount: number; depositCount: number; withdrawAmount: number
  betAmount: number; ggr: number; bonusCost: number; ngr: number
  dau: number; newUsers: number; firstDepUsers: number
}
export interface BiOverview {
  asOf: string
  today: BiWindowStats
  yesterdaySameTime: BiWindowStats
  lastWeekSameTime: BiWindowStats
  yesterdayFull: BiWindowStats
}
export const getBiOverview = () => get<BiOverview>('/admin/bi/overview')

export interface BiTrendPoint {
  date: string; deposit: number; withdraw: number; betAmount: number
  ggr: number; bonusCost: number; ngr: number
  dau: number; newUsers: number; firstDepUsers: number
}
export const getBiTrends = (params: { days: number; granularity: 'day' | 'week' | 'month'; currency: string }) =>
  get<{ currency: string; series: BiTrendPoint[] }>('/admin/bi/trends', params)

export interface BiProviderRow {
  provider: string; betAmount: number; payoutAmount: number; ggr: number
  rtp: number | null; betCount: number; userDays: number; share: number
}
export const getBiProviders = (params: { days: number; currency: string }) =>
  get<{ currency: string; providers: BiProviderRow[]; trend: { dates: string[]; series: { name: string; ggr: number[] }[] } }>('/admin/bi/providers', params)

export interface BiGameRow {
  gpid: number; gameId: number; name: string; provider: string; category: string
  theoreticalRtp: number | null; betAmount: number; ggr: number; rtp: number | null
  betCount: number; userDays: number; launchCount: number; launchUsers: number
}
export const getBiGames = (params: { days: number; currency: string; limit?: number }) =>
  get<{ currency: string; games: BiGameRow[]; categories: { category: string; betAmount: number; ggr: number }[] }>('/admin/bi/games', params)

export interface BiAlertRow {
  id: number; statDate: string; alertType: string; dimension: string; currency: string
  value: number; baseline: number; deviation: number; severity: string; status: string; createdAt: string
}
export const getBiAlerts = (status?: string) => get<BiAlertRow[]>('/admin/bi/alerts', status ? { status } : undefined)

export interface BiFunnel { registered: number; kycApproved: number; firstDep: number; redep: number }
export const getBiFunnel = (params: { days: number; source?: string }) => get<BiFunnel>('/admin/bi/funnel', params)

export interface BiRetentionCohort { week: string; size: number; d1: number; d3: number; d7: number; d14: number; d30: number }
export const getBiRetention = (weeks: number) => get<BiRetentionCohort[]>('/admin/bi/retention', { weeks })

export interface BiRfmCell { valueTier: string; recency: string; users: number; depositAmount: number }
export const getBiRfm = (days: number) =>
  get<{ cells: BiRfmCell[]; nonDepositors: number; totalUsers: number }>('/admin/bi/rfm', { days })

export interface BiLtvCohort { week: string; size: number; d7: number; d30: number; d60: number; d90: number }
export const getBiLtv = (weeks: number) => get<BiLtvCohort[]>('/admin/bi/ltv', { weeks })

export interface BiTopWinner { userId: string; displayName: string; netWin: number; betAmount: number }
export const getBiTopWinners = (days: number) => get<BiTopWinner[]>('/admin/bi/top-winners', { days })

export interface BiAcquisitionRow {
  source: string; newUsers: number; firstDepUsers: number
  conversion: number | null; bonusCost: number; ngr: number
}
export const getBiAcquisition = (days: number) =>
  get<{ sources: BiAcquisitionRow[]; dauTrend: { dates: string[]; series: { name: string; data: number[] }[] } }>('/admin/bi/acquisition', { days })

export interface BiForecastPoint { date: string; value: number }
export const getBiForecast = (metric: 'ggr' | 'deposit') =>
  get<{ history: BiForecastPoint[]; forecast: BiForecastPoint[] }>('/admin/bi/forecast', { metric })

export const getBiTargets = (period: string) => get<{ metric: string; targetValue: number }[]>('/admin/bi/targets', { period })
export const putBiTarget = (period: string, metric: string, targetValue: number) =>
  put<{ ok: boolean }>('/admin/bi/targets', { period, metric, targetValue })

export interface BiTargetProgress {
  metric: string; target: number; actual: number
  timeProgress: number; completion: number; requiredDaily: number
  projected: number; projectedCompletion: number
}
export const getBiTargetProgress = () => get<{ period: string; items: BiTargetProgress[] }>('/admin/bi/target-progress')

export interface BiChurnUser {
  userId: string; displayName: string; deposit90d: number
  lastActive: string; idleDays: number; cadenceDays: number; score: number
}
export const getBiChurnRisk = () => get<BiChurnUser[]>('/admin/bi/churn-risk')
export const grantChurnRedepOffer = (userId: string, currency = 'PHP') =>
  post<{ ok: boolean; reason?: string; bonusAmount?: number; minDeposit?: number; endsAt?: string }>('/admin/bi/churn/redep-offer', { userId, currency })

export interface BiChannelRow {
  direction: string; channel: string; total: number; success: number
  rate: number; avgSecs: number | null
}
export const getBiChannels = (days: number) =>
  get<{ channels: BiChannelRow[]; trend: { dates: string[]; series: { name: string; data: (number | null)[] }[] } }>('/admin/bi/channels', { days })
export const sendBiReport = () => post<{ sent: boolean; text: string }>('/admin/bi/report/send')
export const getBiReportConfig = () => get<{ enabled: boolean }>('/admin/bi/report/config')
export const setBiReportConfig = (enabled: boolean) => put<{ enabled: boolean }>('/admin/bi/report/config', { enabled })
export const setBiAlertStatus = (id: number, status: 'ack' | 'closed') =>
  patch<{ updated: boolean }>(`/admin/bi/alerts/${id}`, { status })

// Users
export interface AdminUser {
  id: string; displayName: string; email: string | null; telegramUsername: string | null
  status: string; label: string
  lastLoginAt: string | null; lastLoginRegion: string | null
  registerRegion: string | null
  registeredAt: string; balance: number; level: number
}
export interface LoginLog {
  id: number; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; entrySource: string | null; deviceId: string | null; fpVisitor: string | null; createdAt: string
}
export interface BetOrder {
  id: number; providerTxnId: string; roundId: string | null
  betType: string; amount: number; currencyCode: string; status: string; createdAt: string
}
export interface LedgerEntry {
  id: string; type: string; amount: number; currency: string
  balanceAfter: number; description: string; createdAt: string
}
export interface WalletBalance {
  currency: string; available: number; frozen: number
}
export const getUsers = (params: { page?: number; pageSize?: number; search?: string; status?: string }) =>
  get<{ total: number; items: AdminUser[] }>('/admin/users', params)

export interface DeviceLookupAccount {
  userId: string; displayName: string; status: string; loginCount: number; firstSeen: string; lastSeen: string
}
export interface DeviceLookupResult {
  value: string
  accounts: DeviceLookupAccount[]
  logs: (LoginLog & { userId: string })[]
}
export const lookupDevice = (params: { value: string }) =>
  get<DeviceLookupResult>('/admin/device-lookup', params)
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
    walletBalances: WalletBalance[]
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
export const resetUserPassword = (id: string, provider: 'phone', password: string, opPassword: string) =>
  post<{ success: boolean }>(`/admin/users/${id}/reset-password`, { provider, password, opPassword })
export const SUPPORTED_CURRENCIES = ['PHP', 'USDT', 'USDC', 'TRX_TESTNET'] as const
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

export interface KycStepSettings { requirePhone?: boolean; requireDocument: boolean; requireFace: boolean; faceMatchThreshold: number }
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
export interface AdminGameJob {
  id: string
  type: 'win568_games_sync'
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  total: number
  message: string
  result?: { synced?: number }
  error?: string
}

export const startWin568SyncGames = () =>
  post<{ jobId: string; alreadyRunning?: boolean }>('/admin/games/win568-sync', {})
export const getGameJob = (jobId: string) =>
  get<AdminGameJob>(`/admin/games/jobs/${jobId}`)

export interface ProviderStat { provider: string; providerShort: string | null; weight: number; total: number; active: number; rtps?: number[] }

export interface AdminWin568Game {
  uuid: string
  gameId: number
  gameProviderId: number
  provider: string
  providerShort: string | null
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
  weightBreakdown: unknown
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
export const getWin568ProviderStats = () =>
  get<ProviderStat[]>('/admin/games/win568-provider-stats')
export const toggleWin568ProviderGames = (provider: string, isActive: boolean) =>
  post<{ provider: string; isActive: boolean; affected: number }>('/admin/games/win568-provider-toggle', { provider, isActive })
export const setWin568ProviderWeight = (provider: string, weight: number) =>
  post<{ provider: string; weight: number }>('/admin/games/win568-provider-weight', { provider, weight })

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

// Games 页各分类 All 列表手动置顶排序（手动排序 + 缺省权重垫后）
export interface CategorySortEntry {
  gameUuid: string
  position: number
  name: string | null
  provider: string | null
  imageUrl: string | null
  siteCategory: string | null
}
export const getCategorySort = () =>
  get<{ categoryKeys: string[]; categories: Record<string, CategorySortEntry[]> }>('/admin/games/category-sort')
export const putCategorySort = (categoryKey: string, gameUuids: string[]) =>
  put<{ ok: boolean }>(`/admin/games/category-sort/${categoryKey}`, { gameUuids })

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
  escalateReason: string | null
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
export const csClose = (id: number) =>
  post(`/admin/cs/conversations/${id}/close`)

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
export const getCsWelcome = () => get<{ welcome: string; defaultWelcome: string }>('/admin/cs/welcome')
export const saveCsWelcome = (welcome: string) => req<{ success: boolean }>('PUT', '/admin/cs/welcome', { welcome })
export const getCsDuty = () => get<{ enabled: boolean; onlineAdmins: number; onDuty: boolean }>('/admin/cs/duty')
export const saveCsDuty = (enabled: boolean) => req<{ success: boolean }>('PUT', '/admin/cs/duty', { enabled })

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

export const getTeamCommissions = (params?: { period?: string; beneficiaryId?: string; status?: string; page?: number; pageSize?: number }) =>
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

export const getTeamWithdrawals = (params?: { status?: string; page?: number; pageSize?: number }) =>
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
export const FIRSTDEP_CURRENCIES = ['PHP', 'USDT', 'USDC'] as const
export type FirstDepCurrency = (typeof FIRSTDEP_CURRENCIES)[number]
// 激励类配置币种选项：稳定币 USDT/USDC 共用一套（保存 USDT 后端自动同步 USDC），后台只需维护两套
export const CONFIG_CCY_OPTIONS = [
  { value: 'PHP', label: 'PHP' },
  { value: 'USDT', label: 'USDT / USDC' },
] as const
export type PopupAudience = 'all' | 'guest' | 'no_deposit' | 'new' | 'deposited'
export type PopupFrequency = 'daily' | 'once' | 'always'
export interface PopupConfig {
  id: string
  enabled: boolean
  order: number
  audience: PopupAudience
  frequency: PopupFrequency
}
export interface RedepCcyTier { minDeposit: number; bonusAmount: number }
export interface RedepConfig {
  enabled: boolean
  minDeposit: number
  bonusAmount: number
  /** 按币种独立的门槛/奖励（PHP/USDT/USDC） */
  byCcy: Record<string, RedepCcyTier>
  windowHours: number
  cooldownDays: number
  turnoverX: number
  turnoverDays: number
}
export interface LossRebateConfig {
  enabled: boolean
  ratePct: number
  minDeposit: number
  /** 按币种独立的存款门槛（PHP/USDT/USDC） */
  minDepositByCcy: Record<string, number>
  /** 存款统计滚动窗口天数（门槛/封顶按近 N 天累计存款） */
  windowDays: number
  capToDeposit: boolean
  eligibleCats: string[]
  settleHour: number
}
export type BonusCardId = 'checkin' | 'agent' | 'trial' | 'appdl' | 'firstdep' | 'lossrebate'
export interface BonusCard {
  id: BonusCardId
  enabled: boolean
  order: number
  audience: PopupAudience
}
export interface PromoConfig {
  trial:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  firstdep: { enabled: boolean; turnoverX: number; turnoverDays: number; tiers: Record<string, FirstDepTier[]> }
  appdl:    { amount: number; enabled: boolean; turnoverX: number; turnoverDays: number }
  redep:    RedepConfig
  lossRebate: LossRebateConfig
  popups:   PopupConfig[]
  bonusCards: BonusCard[]
}
export const getPromoConfig = () => get<PromoConfig>('/admin/promotions/config')
export const savePromoConfig = (data: PromoConfig) => req<PromoConfig>('PUT', '/admin/promotions/config', data)

// 每日签到配置
export type CheckinTier = 'starter' | 'premium' | 'elite'
export interface CheckinReward { tier: CheckinTier; n: number }
export interface CheckinDay { base: CheckinReward; enh: CheckinReward }
export interface CheckinMilestone { atDays: number; tier: CheckinTier; n: number }
export interface CheckinConfig {
  enabled: boolean
  enhancedMinPhp: number
  cycle: CheckinDay[]
  milestones: CheckinMilestone[]
}
export const getCheckinConfig = () => get<CheckinConfig>('/admin/checkin/config')
export const saveCheckinConfig = (data: CheckinConfig) => req<CheckinConfig>('PUT', '/admin/checkin/config', data)

// ── 任务体系 ──
export type TaskRewardType = 'cash' | 'spin' | 'growth'
export interface TaskRewardCfg {
  enabled: boolean
  rewardType: TaskRewardType
  amount: number
  spin: number
  turnoverX: number
  currency: string
  threshold: number
  /** daily_bets：单笔投注 ≥ 此额才计数 */
  minStake: number
  /** daily_play：指定 site_category */
  category: string
}
export type TaskConfig = Record<string, TaskRewardCfg>
export const getTaskConfig = (currency = 'PHP') =>
  get<{ currency: string; config: TaskConfig }>('/admin/tasks/config', { currency })
export const saveTaskConfig = (config: TaskConfig, currency = 'PHP') =>
  req<TaskConfig>('PUT', '/admin/tasks/config', { config, currency })

export type TaskVerifyStrategy = 'tg_member' | 'code_redeem' | 'manual_review'
export interface TaskSocialConfig {
  task_key: string
  platform: 'telegram' | 'facebook' | 'viber'
  verify_strategy: TaskVerifyStrategy
  title: string
  subtitle: string
  action_url: string
  channel_ref: string
  redeem_code: string
  reward_type: TaskRewardType
  currency: string
  reward_amount: number
  reward_spin: number
  turnover_x: number
  enabled: number
  sort: number
}
export const getTaskSocial = () => get<TaskSocialConfig[]>('/admin/tasks/social')
export const saveTaskSocial = (key: string, patch: Partial<TaskSocialConfig>) =>
  req<{ ok: boolean }>('PUT', `/admin/tasks/social/${encodeURIComponent(key)}`, patch)

export interface TaskManualReview {
  id: number
  user_id: string
  task_key: string
  screenshot_url: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}
export const getTaskReviews = (status = 'pending') =>
  get<TaskManualReview[]>(`/admin/tasks/manual-reviews?status=${status}`)
export const reviewTaskManual = (id: number, approve: boolean, note = '') =>
  req<{ ok: boolean }>('POST', `/admin/tasks/manual-reviews/${id}/review`, { approve, note })

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
  kind: 'banner' | 'wallet_banner'
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
  kind?: 'deposit' | 'checkin'
  checkinTier?: 'starter' | 'premium' | 'elite' | null
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
export const getSpinConfig = (currency = 'PHP') => get<SpinConfig>('/admin/spin/config', { currency })
export const saveSpinConfig = (data: SpinConfig, currency = 'PHP') => req<SpinConfig>('PUT', '/admin/spin/config', { ...data, currency })
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
export const getRebateConfig = (currency = 'PHP') =>
  get<{ currency: string; config: RebateConfigItem[]; thresholds: RebateThresholdItem[] }>('/admin/rebate/config', { currency })
export const saveRebateConfig = (config: RebateConfigItem[], currency = 'PHP') =>
  req<{ saved: number }>('PUT', '/admin/rebate/config', { config, currency })
export const saveRebateThresholds = (thresholds: RebateThresholdItem[], currency = 'PHP') =>
  req<{ saved: number }>('PUT', '/admin/rebate/thresholds', { thresholds, currency })
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

// VIP 成长体系
export interface VipBenefitItem {
  level: number
  promotionBonus: number
  weeklySalary: number
  monthlySalary: number
  birthdayBonus: number
  negativeRebatePct: number
  retentionLine: number
  withdrawDailyLimit: number
  withdrawDailyCount: number
}
export interface VipRewardRecord {
  id: number
  userId: string
  displayName: string | null
  level: number
  type: string
  amount: number
  currencyCode: string
  periodKey: string
  status: string
  createdAt: string | null
  paidAt: string | null
}
export const getVipBenefits = (currency = 'PHP') =>
  get<{ currency: string; benefits: VipBenefitItem[] }>('/admin/vip/benefits', { currency })
export const saveVipBenefits = (benefits: VipBenefitItem[], currency = 'PHP') =>
  req<{ saved: number }>('PUT', '/admin/vip/benefits', { benefits, currency })
export const triggerVipNegativeRebate = (includeToday?: boolean) =>
  req<{ periodKey: string; users: number; totalAmount: number; skipped?: string }>('POST', '/admin/vip/negative-rebate/manual', { includeToday })
export const triggerVipWeeklySalary = (includeCurrentWeek?: boolean) =>
  req<{ periodKey: string; users: number; totalAmount: number }>('POST', '/admin/vip/weekly-salary/manual', { includeCurrentWeek })
export const triggerVipMonthlySalary = (includeCurrentMonth?: boolean) =>
  req<{ periodKey: string; users: number; totalAmount: number }>('POST', '/admin/vip/monthly-salary/manual', { includeCurrentMonth })
export const triggerVipBirthday = () =>
  req<{ users: number; totalAmount: number }>('POST', '/admin/vip/birthday/manual', {})
export const triggerVipRetention = () =>
  req<{ quarterKey: string; processed: number; demoted: number }>('POST', '/admin/vip/retention/manual', {})
export const getVipRecords = (params?: { page?: number; pageSize?: number; type?: string; userId?: string }) =>
  get<{ items: VipRewardRecord[]; total: number; page: number; pageSize: number }>('/admin/vip/records', params)

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

// ── 风控中心 ──────────────────────────────────────────────────────────────
export type RiskAction = 'tag_only' | 'limit' | 'deny' | 'escalate'
export interface RiskTagMeta { name: string; desc: string }

export interface RiskOverview {
  tags: { tagCode: string; source: string; count: number }[]
  hits24h: { checkpoint: string; action: string; count: number }[]
  profiledUsers: number
  highRiskUsers: number
  tagMeta: Record<string, RiskTagMeta>
}
export const getRiskOverview = () => get<RiskOverview>('/admin/risk/overview')

export interface RiskUserItem {
  userId: string; bonusTotal: number; netDeposit: number; bonusRatio: number
  withdrawCount: number; deviceSharedUsers: number; ipSharedUsers: number
  riskScore: number; computedAt: string
  tags: { tagCode: string; source: string }[]
}
export const getRiskUsers = (params?: { tag?: string; minScore?: number; limit?: number; userId?: string; minDeviceShared?: number; minBonusRatio?: number }) =>
  get<{ items: RiskUserItem[] }>('/admin/risk/users', params)

export interface RiskUserTag {
  tagCode: string; source: string; confidence: number
  evidence: unknown; assignedBy: string | null; createdAt: string
}
export interface RiskHit {
  id?: number; userId?: string | null; checkpoint: string; ruleCode: string; action: RiskAction
  matchedValue: string | null; detail: unknown; ip: string | null; deviceId: string | null; createdAt: string
}
export interface RiskUserDetail {
  signal: (Omit<RiskUserItem, 'tags'>) | null
  tags: RiskUserTag[]
  hits: RiskHit[]
  tagMeta: Record<string, RiskTagMeta>
}
export const getRiskUser = (userId: string) => get<RiskUserDetail>(`/admin/risk/users/${userId}`)
export const addRiskTag = (userId: string, data: { tagCode: string; reason?: string }) =>
  post<{ added: boolean }>(`/admin/risk/users/${userId}/tags`, data)
export const removeRiskTag = (userId: string, tagCode: string) =>
  req<{ removed: boolean }>('DELETE', `/admin/risk/users/${userId}/tags/${encodeURIComponent(tagCode)}`)

export interface RiskPolicyItem {
  checkpoint: string; ruleCode: string; action: RiskAction; enabled: boolean
  params: Record<string, number> | null; updatedAt: string
}
export const getRiskPolicies = () => get<{ items: RiskPolicyItem[]; actions: RiskAction[] }>('/admin/risk/policies')
export const saveRiskPolicies = (items: Omit<RiskPolicyItem, 'updatedAt'>[]) =>
  put<{ updated: number }>('/admin/risk/policies', { items })

export const getRiskHits = (params?: { checkpoint?: string; action?: string; limit?: number }) =>
  get<{ items: RiskHit[] }>('/admin/risk/hits', params)

// ── 社区营销自动发帖 ─────────────────────────────────────────────────────────
export type CmPlatform = 'telegram' | 'viber' | 'facebook'
export type CmCategory = 'promo' | 'winner' | 'hotgame' | 'sports' | 'checkin' | 'festival'
export interface CmButton { text: string; url: string }
export interface CmChannel {
  id: number; platform: CmPlatform; name: string
  config: Record<string, string>; dailyLimit: number; enabled: boolean
}
export interface CmTemplate {
  id: number; category: CmCategory; title: string; body: string
  imageUrl: string | null; buttons: CmButton[] | null; enabled: boolean; sort: number
}
export interface CmRule {
  id: number; name: string; category: CmCategory; channelIds: number[]
  slots: string[]; strategy: 'sequential' | 'random'; aiRewrite: boolean; cursor: number; enabled: boolean
}
export interface CmPostLog {
  id: number; ruleId: number | null; channelId: number; templateId: number | null
  content: string; imageUrl: string | null; buttons: CmButton[] | null
  status: 'pending' | 'sent' | 'failed' | 'skipped'; error: string | null
  sentAt: string | null; createdAt: string
}
export const cmListChannels = () => get<{ items: CmChannel[] }>('/admin/community/channels')
export const cmSaveChannel = (data: Partial<CmChannel>) => put<{ id: number }>('/admin/community/channels', data)
export const cmDeleteChannel = (id: number) => req('DELETE', `/admin/community/channels/${id}`)
export const cmListTemplates = (category?: string) =>
  get<{ items: CmTemplate[]; categories: CmCategory[] }>('/admin/community/templates', category ? { category } : undefined)
export const cmSaveTemplate = (data: Partial<CmTemplate>) => put<{ id: number }>('/admin/community/templates', data)
export const cmDeleteTemplate = (id: number) => req('DELETE', `/admin/community/templates/${id}`)
export const cmPreviewTemplate = (body: string, platform: CmPlatform, aiRewrite: boolean) =>
  post<{ rendered: string; content: string; aiApplied: boolean }>('/admin/community/templates/preview', { body, platform, aiRewrite })
export const cmListRules = () => get<{ items: CmRule[] }>('/admin/community/rules')
export const cmSaveRule = (data: Partial<CmRule>) => put<{ id: number }>('/admin/community/rules', data)
export const cmDeleteRule = (id: number) => req('DELETE', `/admin/community/rules/${id}`)
export const cmListPosts = (params?: { status?: string; limit?: number }) =>
  get<{ items: CmPostLog[] }>('/admin/community/posts', params)
export const cmSendNow = (data: { channelIds: number[]; content: string; imageUrl?: string; buttons?: CmButton[]; aiRewrite?: boolean }) =>
  post<{ results: Array<{ channelId: number; status: string; error?: string }> }>('/admin/community/posts/send-now', data)
export const cmApprovePost = (id: number) => post(`/admin/community/posts/${id}/approve`)
export const cmMarkManualPost = (id: number) => post(`/admin/community/posts/${id}/mark-manual`)
export const cmRejectPost = (id: number) => post(`/admin/community/posts/${id}/reject`)
export const cmSetViberWebhook = (id: number, url?: string) =>
  post<{ ok: boolean; detail: string }>(`/admin/community/channels/${id}/viber-webhook`, url ? { url } : {})

// ── TG 群发 ──────────────────────────────────────────────────────────────────
export type TbStatus = 'draft' | 'sending' | 'done' | 'canceled'
export interface TbButton { text: string; kind: 'url' | 'webapp'; url: string }
export interface TgBroadcast {
  id: number; title: string; content: string
  imageKey: string | null; imageUrl: string | null; buttons: TbButton[] | null
  status: TbStatus; total: number; sentCount: number; failedCount: number; blockedCount: number
  createdBy: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string
}
export interface TbFail { id: number; tgId: string; userId: string | null; blocked: boolean; error: string | null; createdAt: string }
export const tbList = () => get<{ items: TgBroadcast[] }>('/admin/broadcast')
export const tbAudience = () => get<{ count: number }>('/admin/broadcast/audience')
export const tbSave = (data: { id?: number; title: string; content: string; imageKey: string | null; buttons: TbButton[] }) =>
  put<{ id: number }>('/admin/broadcast', data)
export const tbDelete = (id: number) => req('DELETE', `/admin/broadcast/${id}`)
export const tbUploadImage = (imageData: string) =>
  post<{ imageKey: string; imageUrl: string }>('/admin/broadcast/upload', { imageData })
export const tbTestSend = (id: number, tgId: string) => post(`/admin/broadcast/${id}/test`, { tgId })
export const tbStart = (id: number) => post<{ total: number }>(`/admin/broadcast/${id}/send`)
export const tbCancel = (id: number) => post(`/admin/broadcast/${id}/cancel`)
export const tbFails = (id: number) => get<{ items: TbFail[] }>(`/admin/broadcast/${id}/fails`)

// ── 数据库备份管理（super_admin）─────────────────────────────
export interface DbBackupItem {
  name: string
  sizeBytes: number
  mtime: string
  type: 'daily' | 'manual' | 'preclean'
}
export const listDbBackups = () =>
  get<{ dir: string; keep: number; items: DbBackupItem[] }>('/admin/db-backup')
// 立即备份可能耗时（大库），单独放宽超时到 10 分钟
export const createDbBackup = async (): Promise<DbBackupItem> => {
  const resp = await http.request<ApiResp<DbBackupItem>>({
    method: 'POST', url: '/admin/db-backup', timeout: 600000,
  })
  if (resp.data.code !== 0) throw new Error(resp.data.message)
  return resp.data.data
}
export const deleteDbBackup = (name: string) =>
  del<{ name: string }>(`/admin/db-backup/${encodeURIComponent(name)}`)
export async function downloadDbBackup(name: string): Promise<void> {
  const token = localStorage.getItem('admin_token')
  const base = import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/v1'
  const res = await fetch(`${base}/admin/db-backup/${encodeURIComponent(name)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('下载失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
