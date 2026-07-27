import { describe, expect, it } from 'vitest'
import { compareKycNames } from '../services/kyc.service.js'

describe('KYC 姓名匹配', () => {
  it('允许证件姓名和用户输入姓名顺序颠倒', () => {
    expect(compareKycNames('Juan Dela Cruz', 'Cruz, Juan Dela')).toMatchObject({
      matched: true,
      reason: 'reordered',
    })
  })

  it('允许中间名缩写', () => {
    expect(compareKycNames('Maria Ana Santos', 'Santos Maria A')).toMatchObject({
      matched: true,
      reason: 'middle_initial',
    })
  })

  it('允许后缀和标点格式差异', () => {
    expect(compareKycNames('John Paul Reyes Jr.', 'REYES, JOHN PAUL JR')).toMatchObject({
      matched: true,
      reason: 'reordered',
    })
  })

  it('允许缺少中间名但核心首尾姓名一致', () => {
    expect(compareKycNames('Maria Santos', 'Maria Clara Santos')).toMatchObject({
      matched: true,
      reason: 'core_tokens',
    })
  })

  it('核心姓名明显不一致时拒绝', () => {
    expect(compareKycNames('Juan Cruz', 'Pedro Cruz')).toMatchObject({
      matched: false,
      reason: 'mismatch',
    })
    expect(compareKycNames('Maria Santos', 'Maria Gomez')).toMatchObject({
      matched: false,
      reason: 'mismatch',
    })
  })
})
