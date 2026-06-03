import { create } from 'zustand'
import { adminLogin, adminLogout } from '../api'

interface AuthState {
  token: string
  role: string
  isLoggedIn: () => boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('admin_token') ?? '',
  role: localStorage.getItem('admin_role') ?? '',
  isLoggedIn: () => !!get().token,
  async login(username, password) {
    const res = await adminLogin(username, password)
    localStorage.setItem('admin_token', res.token)
    localStorage.setItem('admin_role', res.role)
    set({ token: res.token, role: res.role })
  },
  async logout() {
    try { await adminLogout() } catch { /* ignore */ }
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_role')
    set({ token: '', role: '' })
  },
}))
