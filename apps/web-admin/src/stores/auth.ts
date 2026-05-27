import { defineStore } from 'pinia'
import { ref } from 'vue'
import { adminLogin, adminLogout } from '../api.js'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('admin_token') ?? '')
  const role = ref(localStorage.getItem('admin_role') ?? '')

  const isLoggedIn = () => !!token.value

  async function login(username: string, password: string) {
    const res = await adminLogin(username, password)
    token.value = res.token
    role.value = res.role
    localStorage.setItem('admin_token', res.token)
    localStorage.setItem('admin_role', res.role)
  }

  async function logout() {
    try { await adminLogout() } catch { /* ignore */ }
    token.value = ''
    role.value = ''
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_role')
  }

  return { token, role, isLoggedIn, login, logout }
})
