export const USER_WITHDRAW_REJECT_REASON = 'Withdrawal rejected. Please contact support for details.'
export const USER_WITHDRAW_REJECT_REASONS = [
  USER_WITHDRAW_REJECT_REASON,
  'Withdrawal account information does not match your verified details.',
  'Withdrawal channel or address information is invalid. Please check and submit again.',
  'Wagering requirements are not completed yet.',
  'Your withdrawal request did not pass account security review. Please contact support.',
] as const

export function normalizeUserWithdrawRejectReason(reason?: string | null): string {
  const trimmed = reason?.trim()
  if (!trimmed) return USER_WITHDRAW_REJECT_REASON
  return USER_WITHDRAW_REJECT_REASONS.includes(trimmed as typeof USER_WITHDRAW_REJECT_REASONS[number])
    ? trimmed
    : USER_WITHDRAW_REJECT_REASON
}

export function resolveUserWithdrawRejectReason(status: string, userReason?: string | null): string | null {
  if (status !== 'rejected' && status !== 'admin_rejected') return null
  const reason = userReason?.trim()
  return reason || USER_WITHDRAW_REJECT_REASON
}
