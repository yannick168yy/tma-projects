import { describe, expect, it } from 'vitest'
import { normalizePhone, normalizePhoneID, normalizePhoneIN, normalizePhonePH } from '../utils/phone.js'

describe('手机号归一化', () => {
  it.each([
    ['0812 3456 7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['+62 812-3456-7890', '+6281234567890'],
    ['81234567890', '+6281234567890'],
  ])('支持印尼号码 %s', (raw, expected) => {
    expect(normalizePhoneID(raw)).toBe(expected)
    expect(normalizePhone(raw)).toBe(expected)
  })

  it.each([
    ['09171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['+63 917-123-4567', '+639171234567'],
  ])('保持菲律宾号码兼容 %s', (raw, expected) => {
    expect(normalizePhonePH(raw)).toBe(expected)
    expect(normalizePhone(raw)).toBe(expected)
  })

  it.each([
    ['09876543210', '+919876543210'],
    ['9876543210', '+919876543210'],
    ['6123456789', '+916123456789'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('印度站本地写法 %s', (raw, expected) => {
    expect(normalizePhoneIN(raw)).toBe(expected)
    expect(normalizePhone(raw, 'IN')).toBe(expected)
  })

  it('显式 +91 在任何站点都识别为印度号', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210')
    expect(normalizePhone('919876543210', 'ID')).toBe('+919876543210')
  })

  it('本地 09 开头按站点市场区分菲律宾与印度', () => {
    expect(normalizePhone('09171234567')).toBe('+639171234567')
    expect(normalizePhone('09171234567', 'IN')).toBe('+919171234567')
    expect(normalizePhone('+639171234567', 'IN')).toBe('+639171234567')
  })

  it.each(['5123456789', '98765', '+9112345'])('拒绝无效印度号码 %s', (raw) => {
    expect(normalizePhone(raw, 'IN')).toBeNull()
  })

  it.each(['08123', '+62123456789', '07123456789', 'abc'])('拒绝无效号码 %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })
})
