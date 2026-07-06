import type { LoginProvider } from '@/types/api'

const LAST_LOGIN_KEY = 'betogo_last_login'
const REMEMBER_ME_KEY = 'betogo_remember_me'

export interface LastLogin {
  provider: LoginProvider
  identifier?: string
  displayName?: string
  avatarUrl?: string
}

export function getLastLogin(): LastLogin | null {
  try {
    const raw = localStorage.getItem(LAST_LOGIN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LastLogin
    return parsed.provider ? parsed : null
  } catch {
    return null
  }
}

export function saveLastLogin(data: LastLogin) {
  localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify(data))
}

export function clearLastLogin() {
  localStorage.removeItem(LAST_LOGIN_KEY)
}

export function isRememberMeEnabled(): boolean {
  return localStorage.getItem(REMEMBER_ME_KEY) !== '0'
}

export function setRememberMeEnabled(enabled: boolean) {
  localStorage.setItem(REMEMBER_ME_KEY, enabled ? '1' : '0')
}
