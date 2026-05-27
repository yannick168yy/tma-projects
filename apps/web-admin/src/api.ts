import axios from 'axios'

const BASE = (import.meta.env.VITE_ADMIN_API_BASE_URL as string | undefined) ?? '/api/v1'

export const http = axios.create({ baseURL: BASE })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_role')
      window.location.href = '/login'
    }
    return Promise.reject(err)
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
  pendingWithdrawCount: number; totalBalanceCents: number
}>('/admin/dashboard')

// Users
export interface AdminUser {
  id: string; displayName: string; email: string | null; telegramUsername: string | null
  status: string; label: string
  lastLoginAt: string | null; lastLoginRegion: string | null
  registerRegion: string | null
  registeredAt: string; balanceCents: number
}
export interface LoginLog {
  id: number; ip: string | null; region: string | null; userAgent: string | null; authMethod: string; createdAt: string
}
export interface BetOrder {
  id: number; providerTxnId: string; roundId: string | null
  betType: string; amountCents: number; status: string; createdAt: string
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
export const adjustBalance = (id: string, cents: number, opPassword: string, note?: string) =>
  post<{ available: number; orderId: string }>(`/admin/users/${id}/adjust-balance`, { cents, opPassword, note })

// Settings - op password
export const getOpPasswordStatus = () =>
  get<{ configured: boolean }>('/admin/settings/op-password')
export const setOpPassword = (newPassword: string, currentPassword?: string) =>
  post('/admin/settings/op-password', { newPassword, currentPassword })

// Deposits
export interface AdminDeposit {
  orderId: string; userId: string; amount: number; currency: string; channelId: string
  status: string; createdAt: string; paidAt: string | null; creditedCents: number | null
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
  uuid: string; name: string; provider: string; category: string | null
  subCategory: string | null; imageUrl: string | null
  hasDemo: boolean; hasLobby: boolean; isMobile: boolean; isActive: boolean; updatedAt: string
}
export const getAdminGames = (params: { page?: number; pageSize?: number; provider?: string; search?: string; isActive?: boolean }) =>
  get<{ total: number; items: AdminGame[]; providers: string[] }>('/admin/games', params)
export const toggleGame = (uuid: string, isActive: boolean) =>
  patch<{ uuid: string; isActive: boolean }>(`/admin/games/${uuid}/toggle`, { isActive })

// Audit log
export interface AuditEntry {
  id: number; adminUsername: string; action: string; targetType: string | null
  targetId: string | null; detail: unknown; ip: string | null; createdAt: string
}
export const getAuditLog = (params: { page?: number; pageSize?: number }) =>
  get<{ items: AuditEntry[]; page: number }>('/admin/audit-log', params)
