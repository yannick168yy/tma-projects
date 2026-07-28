import { describe, expect, it } from 'vitest'
import {
  USER_WITHDRAW_REJECT_REASON,
  normalizeUserWithdrawRejectReason,
  recommendedUserReasonForRule,
  resolveUserWithdrawRejectReason,
} from '../services/withdraw-reject-reason.service.js'

describe('提款用户可见拒绝原因', () => {
  it('后台拒绝且未配置用户原因时返回通用文案', () => {
    expect(resolveUserWithdrawRejectReason('admin_rejected', null)).toBe(USER_WITHDRAW_REJECT_REASON)
    expect(resolveUserWithdrawRejectReason('rejected', '')).toBe(USER_WITHDRAW_REJECT_REASON)
  })

  it('已有用户可见原因时返回该原因', () => {
    expect(resolveUserWithdrawRejectReason('admin_rejected', 'Please verify your wallet account.')).toBe('Please verify your wallet account.')
  })

  it('非拒绝状态不返回原因', () => {
    expect(resolveUserWithdrawRejectReason('pending', 'internal note')).toBeNull()
    expect(resolveUserWithdrawRejectReason('failed', 'provider failed')).toBeNull()
  })

  it('后台提交的用户原因必须来自允许列表', () => {
    const allowed = 'Your recent winnings require additional verification before withdrawal. Please contact support.'
    expect(normalizeUserWithdrawRejectReason(allowed)).toBe(allowed)
    expect(normalizeUserWithdrawRejectReason('high_multiple_profit risk hit')).toBe(USER_WITHDRAW_REJECT_REASON)
  })

  it('同IP同设备命中时推荐明确原因', () => {
    const reason = 'Your withdrawal was rejected because your account shares the same IP address or device with other accounts.'
    expect(recommendedUserReasonForRule('same_ip_device')).toBe(reason)
    expect(normalizeUserWithdrawRejectReason(reason)).toBe(reason)
  })
})
