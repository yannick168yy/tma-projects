import type { UserRecord } from '../types/domain.js'

export type LoginProvider = 'telegram' | 'google'

export function resolveLoginProvider(user: UserRecord): LoginProvider {
  if (user.telegramUserId != null) return 'telegram'
  if (user.googleSub) return 'google'
  return 'telegram'
}

export function toPublicUser(user: UserRecord) {
  const loginProvider = resolveLoginProvider(user)
  const email =
    loginProvider === 'google'
      ? user.email ?? user.profile.email ?? undefined
      : user.profile.email || undefined

  return {
    id: user.id,
    telegramUserId: user.telegramUserId,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    inviteCode: user.inviteCode,
    loginProvider,
    email,
    telegramUsername: user.telegramUsername,
  }
}
