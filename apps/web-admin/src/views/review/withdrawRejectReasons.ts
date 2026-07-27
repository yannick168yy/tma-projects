export const WITHDRAW_USER_REJECT_REASON_OPTIONS = [
  {
    label: '通用：审核未通过，请联系客服',
    value: 'Withdrawal rejected. Please contact support for details.',
  },
  {
    label: '收款信息与实名资料不匹配',
    value: 'Withdrawal account information does not match your verified details.',
  },
  {
    label: '收款账号或地址无效',
    value: 'Withdrawal channel or address information is invalid. Please check and submit again.',
  },
  {
    label: '流水要求未完成',
    value: 'Wagering requirements are not completed yet.',
  },
  {
    label: '账户安全审核未通过',
    value: 'Your withdrawal request did not pass account security review. Please contact support.',
  },
]

export const DEFAULT_WITHDRAW_USER_REJECT_REASON = WITHDRAW_USER_REJECT_REASON_OPTIONS[0].value
