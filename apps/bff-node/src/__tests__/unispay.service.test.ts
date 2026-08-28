import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { buildDepositChannelExtra, createDeposit, generateSign, resolveDepositPayType } from '../services/unispay.service.js'

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

  it('商户配置缺失时不向 UnisPay 发起请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const env = {
      UNISPAY_MCH_NO: '',
      UNISPAY_API_KEY: '',
      UNISPAY_BASE_URL: 'https://asia666.unispay.vip',
    } as Env

    await expect(createDeposit({
      amount: 100000,
      channelName: 'dana',
      merchantSerial: 'UPD_TEST',
      notifyUrl: 'https://www.188facai.com/api/v1/callback/unispay',
      returnUrl: 'https://www.188facai.com',
    }, env)).rejects.toThrow('UnisPay 商户配置缺失')
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
