export const WITHDRAW_USER_REJECT_REASON_OPTIONS = [
  {
    label: '通用：审核未通过，请联系客服',
    value: 'Withdrawal rejected. Please contact support for details.',
  },
  {
    label: '流水检查：常规流水未完成',
    value: 'Please complete the required wagering before submitting a withdrawal.',
  },
  {
    label: '大额取款：金额需要复核',
    value: 'This withdrawal amount requires additional review. Please contact support for assistance.',
  },
  {
    label: '大额盈利：近期盈利需要复核',
    value: 'Your recent winnings require additional verification before withdrawal. Please contact support.',
  },
  {
    label: '高倍盈利：盈利倍数需要复核',
    value: 'Your recent gameplay activity requires additional verification before withdrawal. Please contact support.',
  },
  {
    label: '24小时高倍盈利：短时盈利需要复核',
    value: 'Your recent short-term gameplay activity requires additional verification before withdrawal. Please contact support.',
  },
  {
    label: '存款来源：缺少合格真实存款',
    value: 'A qualifying successful deposit is required before withdrawal.',
  },
  {
    label: '首次取款：需先完成真实存款',
    value: 'Please complete a qualifying successful deposit before your first withdrawal.',
  },
  {
    label: '收款信息：实名资料不匹配',
    value: 'Withdrawal account information does not match your verified details.',
  },
  {
    label: '收款信息：账号或地址无效',
    value: 'Withdrawal channel or address information is invalid. Please check and submit again.',
  },
  {
    label: '历史兼容：流水要求未完成',
    value: 'Wagering requirements are not completed yet.',
  },
  {
    label: '上线状态：账号关系需要核验',
    value: 'Your account relationship information requires additional verification before withdrawal. Please contact support.',
  },
  {
    label: '同IP同设备：账号环境需要核验',
    value: 'Your account login environment requires additional verification before withdrawal. Please contact support.',
  },
  {
    label: '优惠流水：活动流水未完成',
    value: 'Please complete the required bonus wagering before submitting a withdrawal.',
  },
  {
    label: '总优惠金额：优惠领取需要复核',
    value: 'Your reward records require additional verification before withdrawal. Please contact support.',
  },
  {
    label: '注单核验：投注记录需要复核',
    value: 'Your bet records require additional verification before withdrawal. Please contact support.',
  },
  {
    label: '佣金异常：佣金记录需要复核',
    value: 'Your account reward records require additional verification before withdrawal. Please contact support.',
  },
  {
    label: '上游对账：交易记录需要核验',
    value: 'Your withdrawal request requires transaction verification. Please contact support.',
  },
  {
    label: '上游彩金异常：奖励记录需要核验',
    value: 'Your recent bonus activity requires additional verification before withdrawal. Please contact support.',
  },
  {
    label: '取消注单异常：投注记录需要复核',
    value: 'Your cancelled bet records require additional verification before withdrawal. Please contact support.',
  },
  {
    label: '风控命中：账户安全审核未通过',
    value: 'Your withdrawal request did not pass account security review. Please contact support.',
  },
]

export const DEFAULT_WITHDRAW_USER_REJECT_REASON = WITHDRAW_USER_REJECT_REASON_OPTIONS[0].value
