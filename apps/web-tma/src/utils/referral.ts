const REF_KEY = 'betogo_ref'

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
    const ref = url.searchParams.get('ref')?.trim()
    if (!ref) return null
    const code = ref.toUpperCase()
    localStorage.setItem(REF_KEY, code)
    return code
  } catch {
    return null
  }
}
