import { describe, expect, it } from 'vitest'
import { buildDepositChannelExtra, generateSign, resolveDepositPayType } from '../services/unispay.service.js'

describe('UnisPay 签名', () => {
  it('按文档规则排除空值并生成 SHA-256 小写签名', () => {
    const params = {
      mchNo: 'M171925157713',
      mchOrderId: '1234567as94',
      timestamp: '1725300081000',
      payType: 102,
      notifyUrl: 'http://localhost:8080/test',
      amount: '105',
      xxx: '',
      yyyy: null,
    }

    expect(generateSign(params, '123456789')).toBe('fd732521e341b1c9f66b91593db983bd800e0e4e14b2c0ce2d921d48fcce2bde')
  })

  it('按印尼渠道类型映射代收 payType 和网银扩展参数', () => {
    expect(resolveDepositPayType('dana')).toBe(6211)
    expect(resolveDepositPayType('qris')).toBe(6212)
    expect(resolveDepositPayType('va')).toBe(6210)
    expect(buildDepositChannelExtra('va')).toBe('{"bank":"VA"}')
    expect(buildDepositChannelExtra('dana')).toBeUndefined()
  })
})
