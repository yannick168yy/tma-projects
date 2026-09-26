import { describe, expect, it } from 'vitest'
import { buildKycStatusResponse, compareKycNames, isAcceptedKycDocType, normalizeDocType } from '../services/kyc.service.js'
import type { KycSubmission } from '../types/domain.js'

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

describe('KYC 市场证件清单', () => {
  it('印度市场接受 OVD 清单并拒绝菲律宾证件', () => {
    expect(isAcceptedKycDocType('IN', 'aadhaar')).toBe(true)
    expect(isAcceptedKycDocType('IN', 'Voter ID')).toBe(true)
    expect(isAcceptedKycDocType('IN', 'mgnrega')).toBe(true)
    expect(isAcceptedKycDocType('IN', 'npr')).toBe(true)
    expect(isAcceptedKycDocType('IN', 'philid')).toBe(false)
  })

  it('兼容 Aadhaar 与印度证件常见别名', () => {
    expect(normalizeDocType('Aadhar')).toBe('aadhaar')
    expect(normalizeDocType('EPIC')).toBe('voter_id')
    expect(normalizeDocType('NPR Smart Card')).toBe('npr_letter')
  })

  it('切换到印度市场后不沿用菲律宾证件的已通过状态', () => {
    const status = buildKycStatusResponse({
      status: 'approved',
      market: 'PH',
      docType: 'philid',
      docVerified: true,
      faceVerified: true,
    } as KycSubmission, 'IN')

    expect(status).toMatchObject({ status: 'none', market: 'IN', docVerified: false, faceVerified: false })
  })

  it('印度市场沿用印度证件的已通过状态', () => {
    const status = buildKycStatusResponse({
      status: 'approved',
      market: 'IN',
      docType: 'aadhaar',
      docVerified: true,
      faceVerified: true,
    } as KycSubmission, 'IN')

    expect(status).toMatchObject({ status: 'approved', market: 'IN', docVerified: true, faceVerified: true })
  })
})
