import { apiRequest } from '@/api/client'
import * as mock from '@/api/mock/promotion.mock'
import type { PromoHighlight, RedPacketRecord, ReferralRecord, TeamAgentStatus } from '@/types/api'

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

export async function fetchTeamStatus(): Promise<TeamAgentStatus> {
  return apiRequest<TeamAgentStatus>('/promotions/team/status')
}

export async function enableAgent(): Promise<void> {
  await apiRequest<{ isAgent: boolean }>('/promotions/team/enable', { method: 'POST' })
}

export interface TeamDownline {
  userId: string
  displayName: string
  activated: boolean
  activatedAt: string | null
  registeredAt: string
}

export interface TeamCommissionItem {
  fromUserId: string
  displayName: string
  level: number
  ggrCents: number
  ratePct: number
  commissionCents: number
  status: string
  paidAt: string | null
}

export interface TeamCommissionSummary {
  l1Cents: number
  l2Cents: number
  l3Cents: number
  totalCents: number
}

export interface TeamWithdrawal {
  id: number
  amountCents: number
  status: string
  rejectReason: string | null
  reviewedAt: string | null
  createdAt: string
}

export async function fetchTeamDownlines(level: 1 | 2 | 3, page: number): Promise<{ items: TeamDownline[]; total: number; page: number }> {
  return apiRequest(`/promotions/team/downlines?level=${level}&page=${page}`)
}

export async function fetchTeamCommissions(period: string): Promise<{ summary: TeamCommissionSummary; items: TeamCommissionItem[]; period: string }> {
  return apiRequest(`/promotions/team/commissions?period=${period}`)
}

export async function fetchTeamWallet(): Promise<{ availableCents: number; frozenCents: number; lifetimeEarnedCents: number }> {
  return apiRequest('/promotions/team/wallet')
}

export async function submitTeamWithdrawal(amountCents: number): Promise<{ withdrawalId: number }> {
  return apiRequest('/promotions/team/withdraw', { method: 'POST', body: JSON.stringify({ amount_cents: amountCents }) })
}

export async function fetchTeamWithdrawals(page: number): Promise<{ items: TeamWithdrawal[]; total: number; page: number }> {
  return apiRequest(`/promotions/team/withdrawals?page=${page}`)
}

export interface TeamTreeNode {
  userId: string
  displayName: string
  isAgent: boolean
  thisMonthCents: number
  ggrCents: number
  children: TeamTreeNode[]
}

export async function fetchTeamTree(period: string): Promise<{ l1Members: TeamTreeNode[] }> {
  return apiRequest(`/promotions/team/tree?period=${encodeURIComponent(period)}`)
}

export interface PromoConfig {
  trial:    { amount: number; enabled: boolean }
  referral: { inviterAmount: number; inviteeAmount: number; enabled: boolean }
  firstdep: { matchPct: number; maxBonus: number; minDeposit: number; turnoverX: number; enabled: boolean }
}

const DEFAULT_PROMO_CONFIG: PromoConfig = {
  trial:    { amount: 88, enabled: true },
  referral: { inviterAmount: 50, inviteeAmount: 30, enabled: true },
  firstdep: { matchPct: 120, maxBonus: 1000, minDeposit: 100, turnoverX: 15, enabled: true },
}

export async function fetchPromoConfig(): Promise<PromoConfig> {
  if (useMock) return DEFAULT_PROMO_CONFIG
  try {
    return await apiRequest<PromoConfig>('/promotions/config')
  } catch {
    return DEFAULT_PROMO_CONFIG
  }
}

