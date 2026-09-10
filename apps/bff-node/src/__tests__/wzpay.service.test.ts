import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { createDeposit, createWithdrawal, generateSign, generateWzpayContact, getBalance, queryDeposit } from '../services/wzpay.service.js'

const env = {
  WZPAY_BASE_URL: 'https://api.wzpay.club',
  WZPAY_MERCHANT_ID: '10114',
  WZPAY_API_KEY: 'secret',
} as Env

describe('WZPAY 服务', () => {
  it('根据用户 ID 稳定生成符合格式的虚拟联系方式', () => {
    const first = generateWzpayContact('BG-10001')
    expect(first).toEqual(generateWzpayContact('BG-10001'))
    expect(first).not.toEqual(generateWzpayContact('BG-10002'))
    expect(first.phone).toMatch(/^0812\d{8}$/)
    expect(first.email).toMatch(/^wzpay-[a-f0-9]{16}@188facai\.com$/)
  })

  it('按 ASCII 顺序生成 MD5 小写签名并排除空值', () => {
    expect(generateSign({ merchantId: '10114', currency: 'IDR', empty: '', sign: 'ignored' }, 'secret'))
      .toBe('c19e69638574a4691f1fd78cbfdc321d')
  })

  it('缺少商户密钥时不发起请求', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(getBalance({ ...env, WZPAY_API_KEY: '' })).rejects.toThrow('WZPAY 商户配置缺失')
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('代收按实际接口要求将所有非空字段加入签名', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      msg: '成功',
      data: { orderId: 'P1', outTradeId: 'WZD_1', amount: '100000', status: 0, payUrl: 'https://pay', qrCode: '' },
    })))
    await expect(createDeposit({
      amount: 100000,
      channelName: 'qris',
      merchantSerial: 'WZD_1',
      phone: '081234567890',
      name: 'Test User',
      email: 'test@example.com',
      notifyUrl: 'https://www.188facai.com/api/v1/callback/wzpay',
      callbackUrl: 'https://www.188facai.com',
    }, env)).resolves.toMatchObject({ platformId: 'P1', payUrl: 'https://pay' })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    const { sign, ...unsigned } = body
    expect(sign).toBe(generateSign(unsigned, 'secret'))
    expect(body).toMatchObject({ method: 'QRIS', currency: 'IDR', directConnect: '1' })
    fetchMock.mockRestore()
  })

  it('代付按银行与钱包类型提交官方编码', async () => {
    const successResponse = () => new Response(JSON.stringify({
      code: 0,
      msg: '成功',
      data: { orderId: 'P3', outTradeId: 'WZW_1', amount: '100000', status: 0 },
    }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(successResponse())
      .mockResolvedValueOnce(successResponse())
    const base = {
      merchantSerial: 'WZW_1', amount: 100000, targetOwner: 'Test User', targetAccount: '1234567890',
      accountMobile: '081288706603', accountEmail: 'wzpay-test@188facai.com',
      notifyUrl: 'https://www.188facai.com/api/v1/callback/wzpay',
    }

    await createWithdrawal({ ...base, channelName: 'bni' }, env)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      method: 'BANK', bankCode: '009', bankName: 'Bank Negara Indonesia',
    })

    await createWithdrawal({ ...base, channelName: 'dana' }, env)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      method: 'WALLET', bankCode: '10002', bankName: 'Dana',
    })
    fetchMock.mockRestore()
  })

  it('查询兼容 200 成功码和下划线字段，余额固定查询 IDR', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: '200', msg: '成功', data: [{ order_id: 'P2', out_trade_id: 'WZD_2', amount: '50000', status: 1 }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: '0', msg: '成功', data: { merchantId: '10114', currency: 'IDR', balance: 900000 },
      })))

    await expect(queryDeposit('WZD_2', env)).resolves.toEqual({
      platformId: 'P2', merchantSerial: 'WZD_2', amount: 50000, state: 1,
    })
    await expect(getBalance(env)).resolves.toEqual({ balance: 900000, frozen: 0, currency: 'IDR' })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.wzpay.club/core/api/order/query',
      'https://api.wzpay.club/core/api/balance/query',
    ])
    fetchMock.mockRestore()
  })
})
