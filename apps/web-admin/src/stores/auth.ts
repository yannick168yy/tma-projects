import { create } from 'zustand'
import { adminLogin, adminLogout } from '../api'

interface AuthState {
  token: string
  role: string
  isLoggedIn: () => boolean
  login: (username: string, password: string) => Promise<void>
  setSession: (token: string, role: string) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('admin_token') ?? '',
  role: localStorage.getItem('admin_role') ?? '',
  isLoggedIn: () => !!get().token,
  setSession(token, role) {
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_role', role)
    set({ token, role })
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
    set({ token: '', role: '' })
  },
}))
