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
  betType: string; amount: number; status: string; createdAt: string
}
export const getUsers = (params: { page?: number; pageSize?: number; search?: string; status?: string }) =>
  get<{ total: number; items: AdminUser[] }>('/admin/users', params)
export const getUserDetail = (id: string) =>
  get<{
    user: Record<string, unknown>
    wallet: { available: number; frozen: number }
    ledger: unknown[]
    loginLogs: LoginLog[]
    betOrders: BetOrder[]
  }>(`/admin/users/${id}`)
export const updateUserStatus = (id: string, status: string, reason?: string) =>
  patch<{ status: string }>(`/admin/users/${id}/status`, { status, reason })
export const updateUserLabel = (id: string, label: string) =>
  patch<{ label: string }>(`/admin/users/${id}/label`, { label })
export interface UserProfileData { firstName: string; lastName: string; gender: string; dobMonth: string; dobDay: string; dobYear: string; phone?: string; email?: string }
export const updateUserProfile = (id: string, profile: Partial<UserProfileData>) =>
  patch<{ profile: UserProfileData }>(`/admin/users/${id}/profile`, profile)
export const adjustBalance = (id: string, amount: number, opPassword: string, note?: string) =>
  post<{ available: number; orderId: string }>(`/admin/users/${id}/adjust-balance`, { amount, opPassword, note })

// Settings - op password
export const getOpPasswordStatus = () =>
  get<{ configured: boolean }>('/admin/settings/op-password')
export const setOpPassword = (newPassword: string, currentPassword?: string) =>
  post('/admin/settings/op-password', { newPassword, currentPassword })

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
  status: string; createdAt: string; completedAt: string | null; rejectReason: string | null
}
export const getWithdrawals = (params: { page?: number; pageSize?: number; userId?: string; status?: string }) =>
  get<{ total: number; items: AdminWithdrawal[] }>('/admin/withdrawals', params)
export const approveWithdrawal = (orderId: string) =>
  post<{ orderId: string; status: string }>(`/admin/withdrawals/${orderId}/approve`)
export const rejectWithdrawal = (orderId: string, reason: string) =>
  post<{ orderId: string; status: string }>(`/admin/withdrawals/${orderId}/reject`, { reason })

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
  weightMin?: number; weightMax?: number
  sortField?: string; sortOrder?: 'asc' | 'desc'
}) =>
  get<{ total: number; items: AdminGame[]; providers: string[] }>('/admin/games', params)
export const toggleGame = (uuid: string, isActive: boolean) =>
  patch<{ uuid: string; isActive: boolean }>(`/admin/games/${uuid}/toggle`, { isActive })
export const syncGames = () =>
  post<{ synced: number }>('/admin/games/sync', {})
export const translateGames = () =>
  post<{ translated: number; errors: number; total: number }>('/admin/games/translate', {})

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
  rates: Record<string, number>  // { EUR: 62.15, USD: 58.43, USDT: 58.0, TON: 350.0 }
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

// 投注记录
export interface BetOrderRecord {
  id: number; userId: string; aggregatorId: string; providerId: string
  providerTxnId: string; roundId: string | null
  betType: 'bet' | 'win' | 'refund' | 'cancel'
  amount: number; currencyCode: string
  originalAmount: number | null; exchangeRate: number | null
  status: 'pending' | 'settled' | 'failed'
  createdAt: string; settledAt: string | null
}
export interface BetOrderStats {
  totalBet: number; totalWin: number; roundCount: number
}
export const getBetOrders = (params: {
  page?: number; pageSize?: number
  userId?: string; status?: string; betType?: string
  dateFrom?: string; dateTo?: string
}) => get<{ total: number; page: number; pageSize: number; stats: BetOrderStats; items: BetOrderRecord[] }>('/admin/bet-orders', params)

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
