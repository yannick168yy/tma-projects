import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaafficSmsProvider } from '../services/sms/index.js'

const env = {
  LAAFFIC_BASE_URL: 'https://api.laaffic.test/v3',
  LAAFFIC_API_KEY: 'key',
  LAAFFIC_API_SECRET: 'secret',
  LAAFFIC_APP_ID: 'app',
  LAAFFIC_SENDER_ID: 'BETOGO',
} as never

afterEach(() => vi.unstubAllGlobals())

describe('Laaffic 短信通道', () => {
  it('按印度国际号码提交短信并返回 msgId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: '0', reason: 'success', success: '1', fail: '0',
      array: [{ msgId: 'msg-1', number: '919876543210' }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new LaafficSmsProvider(env).sendSms('+91 98765-43210', 'OTP 123456')).resolves.toEqual({
      ok: true,
      providerMsgId: 'msg-1',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      appId: 'app',
      numbers: '919876543210',
      content: 'OTP 123456',
      trackClicks: 0,
      senderId: 'BETOGO',
    })
  })

  it('查询余额时合并现金、赠送与信用额度', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: '0', balance: '2.5', gift: '1', credit: '3',
    }), { status: 200 })))
    await expect(new LaafficSmsProvider(env).getBalance()).resolves.toBe(6.5)
  })

  it.each([
    ['0', 'delivered'],
    ['-1', 'sending'],
    ['1', 'failed'],
  ] as const)('映射回执状态 %s', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: '0', array: [{ msgId: 'msg-1', status }],
    }), { status: 200 })))
    await expect(new LaafficSmsProvider(env).getDeliveryStatus('msg-1')).resolves.toBe(expected)
  })
})
