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
  status: string; registeredAt: string; balanceCents: number
}
export const getUsers = (params: { page?: number; pageSize?: number; search?: string; status?: string }) =>
  get<{ total: number; items: AdminUser[] }>('/admin/users', params)
export const getUserDetail = (id: string) =>
  get<{ user: Record<string, unknown>; wallet: { available: number; frozen: number }; ledger: unknown[] }>(`/admin/users/${id}`)
export const updateUserStatus = (id: string, status: string, reason?: string) =>
  patch<{ status: string }>(`/admin/users/${id}/status`, { status, reason })
export const adjustBalance = (id: string, cents: number, note?: string) =>
  post<{ available: number }>(`/admin/users/${id}/adjust-balance`, { cents, note })

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

// Audit log
export interface AuditEntry {
  id: number; adminUsername: string; action: string; targetType: string | null
  targetId: string | null; detail: unknown; ip: string | null; createdAt: string
}
export const getAuditLog = (params: { page?: number; pageSize?: number }) =>
  get<{ items: AuditEntry[]; page: number }>('/admin/audit-log', params)
