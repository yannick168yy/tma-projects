import { create } from 'zustand'
import { PLATFORM_ROLE_KEY, PLATFORM_TOKEN_KEY } from '../api'

interface AuthState {
  token: string | null
  role: string | null
  username: string | null
  signIn: (token: string, role: string, username: string) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(PLATFORM_TOKEN_KEY),
  role: localStorage.getItem(PLATFORM_ROLE_KEY),
  username: localStorage.getItem('platform_username'),
  signIn: (token, role, username) => {
    localStorage.setItem(PLATFORM_TOKEN_KEY, token)
    localStorage.setItem(PLATFORM_ROLE_KEY, role)
    localStorage.setItem('platform_username', username)
    set({ token, role, username })
  },
  signOut: () => {
    localStorage.removeItem(PLATFORM_TOKEN_KEY)
    localStorage.removeItem(PLATFORM_ROLE_KEY)
    localStorage.removeItem('platform_username')
    set({ token: null, role: null, username: null })
  },
}))
