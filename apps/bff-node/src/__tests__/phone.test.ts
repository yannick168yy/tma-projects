import { describe, expect, it } from 'vitest'
import { normalizePhone, normalizePhoneID, normalizePhonePH } from '../utils/phone.js'

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

  it.each(['08123', '+62123456789', '07123456789', 'abc'])('拒绝无效号码 %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })
})
