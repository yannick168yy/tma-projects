import { beforeEach, describe, expect, it } from 'vitest'
import {
  federationEnabled, hashIdentity, hintOf, normalizeIdentity,
} from '../services/risk-federation.service.js'

const PEPPER = 'test-pepper-at-least-16-chars'

describe('跨租户联防的摘要与归一化（P3-6）', () => {
  beforeEach(() => { process.env.RISK_FEDERATION_PEPPER = PEPPER })

  it('没配 pepper 时联防关闭：手机号只有 10 位数字，不加盐的摘要能被穷举反查', () => {
    delete process.env.RISK_FEDERATION_PEPPER
    expect(federationEnabled()).toBe(false)
    expect(hashIdentity('phone', '09171234567')).toBeNull()
    process.env.RISK_FEDERATION_PEPPER = 'short'
    expect(federationEnabled()).toBe(false)
  })

  it('手机号归一化吃掉国码与写法差异 —— 不归一化等于联防静默不生效', () => {
    const a = hashIdentity('phone', '+63 917 123 4567')
    const b = hashIdentity('phone', '09171234567')
    const c = hashIdentity('phone', '639171234567')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('卡号忽略空格与横线，证件号忽略大小写', () => {
    expect(normalizeIdentity('bank_card', '6222 0202-1234 5678')).toBe('6222020212345678')
    expect(normalizeIdentity('id_no', 'ph-a1234567')).toBe('PHA1234567')
  })

  it('IPv4 映射前缀不影响比对', () => {
    expect(hashIdentity('ip', '::ffff:203.0.113.7')).toBe(hashIdentity('ip', '203.0.113.7'))
  })

  it('不同类型同值互不串号：设备 abc 与手机号 abc 不该撞在一起', () => {
    expect(hashIdentity('device', '1234567890')).not.toBe(hashIdentity('phone', '1234567890'))
  })

  it('换 pepper 后摘要全变：pepper 泄露时可以整体轮换', () => {
    const before = hashIdentity('phone', '09171234567')
    process.env.RISK_FEDERATION_PEPPER = 'another-pepper-at-least-16'
    expect(hashIdentity('phone', '09171234567')).not.toBe(before)
  })

  it('掩码保留尾 4 位供人工核对，IP 只留前两段', () => {
    expect(hintOf('phone', '+63 917 123 4567')).toBe('****4567')
    expect(hintOf('ip', '203.0.113.7')).toBe('203.0.*.*')
    expect(hintOf('device', 'abc')).toBe('***')
  })
})
