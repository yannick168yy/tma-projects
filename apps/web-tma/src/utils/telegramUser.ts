/** Read Telegram user from WebApp SDK (available after init, no extra login step). */
export function getTelegramWebAppUser(): {
  id?: number
  username?: string
  first_name?: string
  last_name?: string
  photo_url?: string
} | null {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user
  if (!user?.id) return null
  return user
}

export function formatTelegramHandle(username?: string | null): string | null {
  if (!username?.trim()) return null
  const clean = username.trim().replace(/^@/, '')
  return clean ? `@${clean}` : null
}
