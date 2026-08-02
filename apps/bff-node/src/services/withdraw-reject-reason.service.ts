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
  'This withdrawal account is already linked to another account.',
  'Withdrawal channel or address information is invalid. Please check and submit again.',
  'Wagering requirements are not completed yet.',
  'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.',
  'Please complete the required bonus wagering before submitting a withdrawal.',
  'Your reward records require additional verification before withdrawal. Please contact support.',
  'Your bet records require additional verification before withdrawal. Please contact support.',
  'Your account reward records require additional verification before withdrawal. Please contact support.',
  'Your withdrawal request requires transaction verification. Please contact support.',
  'Your recent bonus activity requires additional verification before withdrawal. Please contact support.',
  'Your cancelled bet records require additional verification before withdrawal. Please contact support.',
  'Your withdrawal request did not pass account security review. Please contact support.',
] as const

type UserReason = typeof USER_WITHDRAW_REJECT_REASONS[number]

// 审核规则命中 → 推荐的用户可见驳回话术。管理员驳回时据此自动预选，仍可手动改。
const RULE_RECOMMENDED_USER_REASON: Record<string, UserReason> = {
  turnover: 'Please complete the required wagering before submitting a withdrawal.',
  promo_turnover: 'Please complete the required bonus wagering before submitting a withdrawal.',
  large_amount: 'This withdrawal amount requires additional review. Please contact support for assistance.',
  withdraw_deposit_ratio: 'This withdrawal amount requires additional review. Please contact support for assistance.',
  large_profit: 'Your recent winnings require additional verification before withdrawal. Please contact support.',
  high_multiple_profit: 'Your recent gameplay activity requires additional verification before withdrawal. Please contact support.',
  high_multiple_profit_24h: 'Your recent short-term gameplay activity requires additional verification before withdrawal. Please contact support.',
  deposit_source: 'A qualifying successful deposit is required before withdrawal.',
  first_withdraw_no_deposit: 'Please complete a qualifying successful deposit before your first withdrawal.',
  kyc_name_mismatch: 'Withdrawal account information does not match your verified details.',
  withdraw_account_reuse: 'This withdrawal account is already linked to another account.',
  withdraw_owner_reuse: 'Withdrawal account information does not match your verified details.',
  same_name_review: 'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  fast_withdraw_after_kyc: 'This withdrawal amount requires additional review. Please contact support for assistance.',
  total_bonus: 'Your reward records require additional verification before withdrawal. Please contact support.',
  bonus_bet_abuse: 'Your recent bonus activity requires additional verification before withdrawal. Please contact support.',
  feature_bonus_ratio: 'Your recent bonus activity requires additional verification before withdrawal. Please contact support.',
  upline_blacklist: 'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  same_ip: 'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.',
  same_device_id: 'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.',
  same_device_fp: 'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.',
  tampered_bet: 'Your bet records require additional verification before withdrawal. Please contact support.',
  commission_anomaly: 'Your account reward records require additional verification before withdrawal. Please contact support.',
  upstream_reconcile: 'Your withdrawal request requires transaction verification. Please contact support.',
  cancel_pattern: 'Your cancelled bet records require additional verification before withdrawal. Please contact support.',
  risk_hit: 'Your withdrawal request did not pass account security review. Please contact support.',
  commission_surge: 'Your account reward records require additional verification before withdrawal. Please contact support.',
  fresh_downline_commission: 'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  commission_deposit_ratio: 'Your account reward records require additional verification before withdrawal. Please contact support.',
  downline_ip_overlap: 'Your account relationship information requires additional verification before withdrawal. Please contact support.',
}

/** 某审核规则命中时推荐的用户可见驳回话术，无映射返回 null */
export function recommendedUserReasonForRule(ruleCode: string): string | null {
  return RULE_RECOMMENDED_USER_REASON[ruleCode] ?? null
}

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
