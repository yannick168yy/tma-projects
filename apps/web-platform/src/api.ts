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
