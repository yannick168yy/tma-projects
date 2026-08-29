import { describe, expect, it } from 'vitest'
import { PHP_TO_IDR_SEED, toIdrHundred } from '../utils/idr.js'

describe('IDR 活动金额初始化', () => {
  it('按固定参考汇率换算并四舍五入到百位', () => {
    expect(PHP_TO_IDR_SEED).toBe(287)
    expect(toIdrHundred(20)).toBe(5700)
    expect(toIdrHundred(50)).toBe(14400)
    expect(toIdrHundred(75)).toBe(21500)
    expect(toIdrHundred(500)).toBe(143500)
  })

  it('正数最低为 100 IDR，零金额保持为零', () => {
    expect(toIdrHundred(0)).toBe(0)
    expect(toIdrHundred(0.01)).toBe(100)
  })
})
