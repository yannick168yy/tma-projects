import type { IdentityProvider, UserIdentity, UserRecord } from '../types/domain.js'

export type LoginProvider = 'telegram' | 'google' | 'phone' | 'account'

function hasIdentity(identities: UserIdentity[], provider: IdentityProvider): boolean {
  return identities.some((item) => item.provider === provider)
}

function firstIdentity(identities: UserIdentity[], ...providers: IdentityProvider[]): UserIdentity | undefined {
  return identities.find((item) => providers.includes(item.provider))
}

export function resolveLoginProvider(identities: UserIdentity[]): LoginProvider {
  if (hasIdentity(identities, 'telegram') || hasIdentity(identities, 'telegram_oidc')) return 'telegram'
  if (hasIdentity(identities, 'google')) return 'google'
  if (hasIdentity(identities, 'phone')) return 'phone'
  if (hasIdentity(identities, 'account')) return 'account'
  return 'telegram'
}

export function toPublicUser(user: UserRecord, identities: UserIdentity[] = []) {
  const loginProvider = resolveLoginProvider(identities)
  const email = user.email || undefined
  const telegram = firstIdentity(identities, 'telegram', 'telegram_oidc')
  const account = firstIdentity(identities, 'account')

  return {
    id: user.id,
    telegramUserId: telegram?.provider === 'telegram' ? Number(telegram.identifier) : undefined,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    inviteCode: user.inviteCode,
    loginProvider,
    email,
    telegramUsername: telegram?.displayLabel,
    username: account?.identifier,
    // 各登录方式是否已绑定（绑定页用）
    boundTelegram: hasIdentity(identities, 'telegram') || hasIdentity(identities, 'telegram_oidc'),
    boundGoogle: hasIdentity(identities, 'google'),
    boundPhone: hasIdentity(identities, 'phone'),
    boundAccount: hasIdentity(identities, 'account'),
    // 首充嘉年华是否已发放（充值页首存奖励角标用）
    firstDepClaimed: user.firstDepClaimed,
  }
}
