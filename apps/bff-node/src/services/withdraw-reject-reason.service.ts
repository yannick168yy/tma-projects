export const USER_WITHDRAW_REJECT_REASON = 'Withdrawal rejected. Please contact support for details.'

export function resolveUserWithdrawRejectReason(status: string, userReason?: string | null): string | null {
  if (status !== 'rejected' && status !== 'admin_rejected') return null
  const reason = userReason?.trim()
  return reason || USER_WITHDRAW_REJECT_REASON
}
