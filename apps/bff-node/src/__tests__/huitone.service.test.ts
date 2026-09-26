import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import {
  createDeposit,
  createWithdrawal,
  generateCustomerContact,
  generateSign,
  getBalance,
  queryOrder,
  queryUpi,
} from '../services/huitone.service.js'

const env = {
  HUITONE_BASE_URL: 'https://api.huitone.test',
  HUITONE_MERCHANT_ID: 'M1001',
  HUITONE_MERCHANT_KEY: 'secret',
} as Env

describe('Huitone 服务', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('按 ASCII 顺序拼接非空参数和商户密钥，生成大写 MD5', () => {
    expect(generateSign({ timestamp: '2', mchtId: '1', empty: '', sign: 'ignored' }, 'secret'))
      .toBe('C873B54AC508BB33FB88F11279B085BC')
  })

  it('为不同用户稳定生成不同的印度手机号和邮箱', () => {
    const first = generateCustomerContact('BG-10001')
    expect(first).toEqual(generateCustomerContact('BG-10001'))
    expect(first).not.toEqual(generateCustomerContact('BG-10002'))
    expect(first.mobile).toMatch(/^[6-9]\d{9}$/)
    expect(first.email).toMatch(/^huitone-[a-f0-9]{16}@188facai\.com$/)
  })

  it('代收把所有参数转换成字符串并使用文档路径', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1726150472463)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        outTradeNo: 'HTD_1', transNo: 'P1', link: 'https://pay.test/1',
        upi: 'test@upi', upiLink: 'upi://pay', walletList: [{ walletCode: 'paytm', clickUrl: 'paytm://pay' }],
      },
    })))

    await expect(createDeposit({
      amount: 100,
      merchantSerial: 'HTD_1',
      notifyUrl: 'https://merchant.test/callback',
      name: 'Test User',
      mobile: '9876543210',
      email: 'test@example.com',
    }, env)).resolves.toMatchObject({ platformId: 'P1', payUrl: 'https://pay.test/1', upi: 'test@upi' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.huitone.test/v1/pay/payIn')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    const { sign, ...unsigned } = body
    expect(unsigned).toMatchObject({ mchtId: 'M1001', timestamp: '1726150472463', transAmt: '100' })
    expect(sign).toBe(generateSign(unsigned, 'secret'))
    expect(Object.values(unsigned).every((value) => typeof value === 'string')).toBe(true)
  })

  it('代付规范化 IFSC 并拒绝空 IFSC', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { outTradeNo: 'HTW_1', transNo: 'P2' },
    })))
    const base = {
      amount: 100.5,
      merchantSerial: 'HTW_1',
      notifyUrl: 'https://merchant.test/callback',
      accountName: 'Test User',
      accountNo: '1234567890',
    }
    await expect(createWithdrawal({ ...base, ifsc: '' }, env)).rejects.toThrow('IFSC')
    await createWithdrawal({ ...base, ifsc: 'hdfc0001234' }, env)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      transAmt: '100.50', ifsc: 'HDFC0001234', accountNo: '1234567890',
    })
  })

  it('查单和余额使用带签名的 GET 查询参数', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          transNo: 'P3', outTradeNo: 'HTD_2', transStatus: 'SUCCESS', transAmt: 200,
          completionTime: '2024-12-10 03:22:39', utr: 'U1',
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { balanceAmt: 1234.56 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: false })))

    await expect(queryOrder({ outTradeNo: 'HTD_2' }, env)).resolves.toMatchObject({ status: 'SUCCESS', amount: 200 })
    await expect(getBalance(env)).resolves.toEqual({ balance: 1234.56, frozen: 0, currency: 'INR' })
    await expect(queryUpi('test@upi', env)).resolves.toBe(false)
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/v1/pay/query', '/v1/pay/balance', '/v1/pay/query/upi',
    ])
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('GET')
      const parsed = new URL(String(url))
      expect(parsed.searchParams.get('mchtId')).toBe('M1001')
      expect(parsed.searchParams.get('sign')).toMatch(/^[A-F0-9]{32}$/)
    }
  })

  it('缺少密钥时不发送请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(getBalance({ ...env, HUITONE_MERCHANT_KEY: '' })).rejects.toThrow('商户配置缺失')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
