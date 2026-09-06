import { create } from 'zustand'
import { PLATFORM_ROLE_KEY, PLATFORM_TOKEN_KEY } from '../api'

const SETUP_KEY = 'platform_totp_setup_required'

interface AuthState {
  token: string | null
  role: string | null
  username: string | null
  /** 受限会话：必须先绑完 Google Authenticator 才能用后台 */
  totpSetupRequired: boolean
  signIn: (token: string, role: string, username: string, totpSetupRequired?: boolean) => void
  clearTotpSetupRequired: () => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(PLATFORM_TOKEN_KEY),
  role: localStorage.getItem(PLATFORM_ROLE_KEY),
  username: localStorage.getItem('platform_username'),
  totpSetupRequired: localStorage.getItem(SETUP_KEY) === '1',
  signIn: (token, role, username, totpSetupRequired = false) => {
    localStorage.setItem(PLATFORM_TOKEN_KEY, token)
    localStorage.setItem(PLATFORM_ROLE_KEY, role)
    localStorage.setItem('platform_username', username)
    if (totpSetupRequired) localStorage.setItem(SETUP_KEY, '1')
    else localStorage.removeItem(SETUP_KEY)
    set({ token, role, username, totpSetupRequired })
  },
  clearTotpSetupRequired: () => {
    localStorage.removeItem(SETUP_KEY)
    set({ totpSetupRequired: false })
  },
  signOut: () => {
    localStorage.removeItem(PLATFORM_TOKEN_KEY)
    localStorage.removeItem(PLATFORM_ROLE_KEY)
    localStorage.removeItem('platform_username')
    localStorage.removeItem(SETUP_KEY)
    set({ token: null, role: null, username: null, totpSetupRequired: false })
  },
}))
