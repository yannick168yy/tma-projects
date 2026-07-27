export const USER_WITHDRAW_REJECT_REASON = 'Withdrawal rejected. Please contact support for details.'
export const USER_WITHDRAW_REJECT_REASONS = [
  USER_WITHDRAW_REJECT_REASON,
  'Please complete the required wagering before submitting a withdrawal.',
  'This withdrawal amount requires additional review. Please contact support for assistance.',
  'Your recent winnings require additional verification before withdrawal. Please contact support.',
  'Your recent gameplay activity requires additional verification before withdrawal. Please contact support.',
  'Your recent short-term gameplay activity requires additional verification before withdrawal. Please contact support.',
  'A qualifying successful deposit is required before withdrawal.',
  'Please complete a qualifying successful deposit before your first withdrawal.',
  'Withdrawal account information does not match your verified details.',
  'Withdrawal channel or address information is invalid. Please check and submit again.',
  'Wagering requirements are not completed yet.',
  'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  'Your account login environment requires additional verification before withdrawal. Please contact support.',
  'Please complete the required bonus wagering before submitting a withdrawal.',
  'Your reward records require additional verification before withdrawal. Please contact support.',
  'Your bet records require additional verification before withdrawal. Please contact support.',
  'Your account reward records require additional verification before withdrawal. Please contact support.',
  'Your withdrawal request requires transaction verification. Please contact support.',
  'Your recent bonus activity requires additional verification before withdrawal. Please contact support.',
  'Your cancelled bet records require additional verification before withdrawal. Please contact support.',
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
