import { apiRequest } from '@/api/client'
import * as mock from '@/api/mock/promotion.mock'
import type { PromoHighlight, RedPacketRecord, ReferralRecord } from '@/types/api'

const useMock = import.meta.env.VITE_USE_MOCK_API !== 'false'

export async function fetchPromoHighlights(): Promise<PromoHighlight[]> {
  if (useMock) return mock.mockGetHighlights()
  const list = await apiRequest<Array<{ promoId: string; highlight: boolean; flagLabel: string | null }>>(
    '/promotions',
  )
  return list.map((p) => ({
    promoId: p.promoId as PromoHighlight['promoId'],
    highlight: p.highlight,
    flagLabel: p.flagLabel,
  }))
}

export async function claimTrialBonus(): Promise<{ amountPhp: number }> {
  if (useMock) return mock.mockClaimTrial()
  return apiRequest<{ amountPhp: number }>('/promotions/trial-play/claim', { method: 'POST' })
}

export async function claimReferralBonus(): Promise<{ amountPhp: number }> {
  if (useMock) return mock.mockClaimReferral()
  return apiRequest<{ amountPhp: number }>('/promotions/referral/claim', { method: 'POST' })
}

export async function claimFirstDepBonus(): Promise<{ amountPhp: number }> {
  if (useMock) return mock.mockClaimFirstDep()
  return apiRequest<{ amountPhp: number }>('/promotions/firstdep/claim', { method: 'POST' })
}

export async function fetchReferralRecords(): Promise<ReferralRecord[]> {
  if (useMock) return mock.mockReferralRecords()
  const data = await apiRequest<{ items: ReferralRecord[] }>('/promotions/referral/records')
  return data.items
}

export async function fetchRedPacketRecords(): Promise<RedPacketRecord[]> {
  if (useMock) return mock.mockRedPacketRecords()
  const data = await apiRequest<{ items: RedPacketRecord[] }>('/promotions/red-packets')
  return data.items
}

