import type { UserRecord } from '../types/domain.js'

export type LoginProvider = 'telegram' | 'google' | 'phone' | 'account'

export function resolveLoginProvider(user: UserRecord): LoginProvider {
  if (user.telegramUserId != null || user.telegramOidcSub) return 'telegram'
  if (user.googleSub) return 'google'
  if (user.phoneAccount) return 'phone'
  if (user.username) return 'account'
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
    username: user.username,
    // 各登录方式是否已绑定（绑定页用）
    boundTelegram: user.telegramUserId != null || Boolean(user.telegramOidcSub),
    boundGoogle: Boolean(user.googleSub),
    boundPhone: Boolean(user.phoneAccount),
    boundAccount: Boolean(user.username),
  }
}
