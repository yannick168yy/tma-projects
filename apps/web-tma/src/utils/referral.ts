const REF_KEY = 'betogo_ref'

export function normalizeReferralCode(value: string): string {
  return value.trim().replace(/^(ref|inv)_/i, '').trim().toUpperCase()
}

export function getStoredReferral(): string | null {
  try {
    return localStorage.getItem(REF_KEY)
  } catch {
    return null
  }
}

export function clearStoredReferral(): void {
  try {
    localStorage.removeItem(REF_KEY)
  } catch {
    // ignore
  }
}

export function captureReferralFromUrl(): string | null {
  try {
    const url = new URL(window.location.href)
    const ref = url.searchParams.get('ref')?.trim() || url.searchParams.get('tgWebAppStartParam')?.trim()
    if (!ref) return null
    const code = normalizeReferralCode(ref)
    if (!code) return null
    localStorage.setItem(REF_KEY, code)
    return code
  } catch {
    return null
  }
}

export function getTelegramStartParam(): string {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.start_param?.trim()
      || new URL(window.location.href).searchParams.get('tgWebAppStartParam')?.trim()
      || ''
  } catch {
    return ''
  }
}
