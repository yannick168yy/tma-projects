import { create } from 'zustand'
import { adminLogin, adminLogout } from '../api'

interface AuthState {
  token: string
  /**
   * localStorage 里的角色，只用于首屏渲染时少闪一下菜单。
   * **不能用来做权限判断** —— 用户改得动它。判断一律用 verifiedRole。
   */
  role: string
  /** 服务端会话下发的角色。null = 还没拉到 */
  verifiedRole: string | null
  setVerifiedRole: (role: string) => void
  isLoggedIn: () => boolean
  login: (username: string, password: string) => Promise<void>
  setSession: (token: string, role: string) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('admin_token') ?? '',
  role: localStorage.getItem('admin_role') ?? '',
  verifiedRole: null,
  setVerifiedRole: (role) => {
    // 服务端说了算：顺手纠正本地缓存，避免下次首屏用错角色渲染菜单
    localStorage.setItem('admin_role', role)
    set({ verifiedRole: role, role })
  },
  isLoggedIn: () => !!get().token,
  setSession(token, role) {
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_role', role)
    set({ token, role, verifiedRole: role })
  },
  async login(username, password) {
    const res = await adminLogin(username, password)
    if ('requiresTotp' in res && res.requiresTotp) throw new Error('需要 Google Authenticator 验证')
    get().setSession(res.token, res.role)
  },
  async logout() {
    try { await adminLogout() } catch { /* ignore */ }
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_role')
    set({ token: '', role: '', verifiedRole: null })
  },
}))
