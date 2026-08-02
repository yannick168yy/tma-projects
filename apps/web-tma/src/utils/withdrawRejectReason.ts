// 取款拒绝话术多语言：后端存的英文句(见 bff withdraw-reject-reason.service.ts 的
// USER_WITHDRAW_REJECT_REASONS)是订单里的稳定标识；前端按用户语言渲染——命中映射走 i18n，
// 未命中(自定义/未来新增未同步的话术)回退英文原文，保证不空、存量老订单也能正常显示。
type Translate = (key: string, opts?: Record<string, unknown>) => string

const REJECT_REASON_KEY: Record<string, string> = {
  'Withdrawal rejected. Please contact support for details.': 'generic',
  'Please complete the required wagering before submitting a withdrawal.': 'wagering',
  'This withdrawal amount requires additional review. Please contact support for assistance.': 'largeAmount',
  'Your recent winnings require additional verification before withdrawal. Please contact support.': 'winnings',
  'Your recent gameplay activity requires additional verification before withdrawal. Please contact support.': 'gameplay',
  'Your recent short-term gameplay activity requires additional verification before withdrawal. Please contact support.': 'shortGameplay',
  'A qualifying successful deposit is required before withdrawal.': 'depositRequired',
  'Please complete a qualifying successful deposit before your first withdrawal.': 'firstDeposit',
  'Withdrawal account information does not match your verified details.': 'accountMismatch',
  'This withdrawal account is already linked to another account.': 'accountLinked',
  'Withdrawal channel or address information is invalid. Please check and submit again.': 'invalidChannel',
  'Wagering requirements are not completed yet.': 'wageringLegacy',
  'Your account relationship information requires additional verification before withdrawal. Please contact support.': 'relationship',
  'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.': 'ipDevice',
  'Please complete the required bonus wagering before submitting a withdrawal.': 'bonusWagering',
  'Your reward records require additional verification before withdrawal. Please contact support.': 'rewardRecords',
  'Your bet records require additional verification before withdrawal. Please contact support.': 'betRecords',
  'Your account reward records require additional verification before withdrawal. Please contact support.': 'accountReward',
  'Your withdrawal request requires transaction verification. Please contact support.': 'transactionVerify',
  'Your recent bonus activity requires additional verification before withdrawal. Please contact support.': 'bonusActivity',
  'Your cancelled bet records require additional verification before withdrawal. Please contact support.': 'cancelledBets',
  'Your withdrawal request did not pass account security review. Please contact support.': 'securityReview',
  'The name on your withdrawal account matches another registered account. Please contact support to verify your identity.': 'nameMatch',
}

export function formatWithdrawRejectReason(reason: string | null | undefined, t: Translate): string | null {
  if (!reason) return reason ?? null
  const key = REJECT_REASON_KEY[reason]
  return key ? t(`wallet.rejectReasons.${key}`, { defaultValue: reason }) : reason
}
