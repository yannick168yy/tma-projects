import { apiRequest } from '@/api/client'
import * as mock from '@/api/mock/promotion.mock'
import type { PromoHighlight, RedPacketRecord, TeamAgentStatus } from '@/types/api'

// 显式 'true' 才启用 mock：构建变量缺失时绝不能默认走假数据
const useMock = import.meta.env.VITE_USE_MOCK_API === 'true'

export async function fetchPromoHighlights(currency = 'PHP'): Promise<PromoHighlight[]> {
  if (useMock) return mock.mockGetHighlights()
  const list = await apiRequest<Array<{ promoId: string; highlight: boolean; flagLabel: string | null }>>(
    `/promotions?currency=${encodeURIComponent(currency)}`,
  )
  return list.map((p) => ({
    promoId: p.promoId as PromoHighlight['promoId'],
    highlight: p.highlight,
    flagLabel: p.flagLabel,
  }))
}

export async function claimTrialBonus(currency = 'PHP'): Promise<{ amountPhp: number; currency?: string }> {
  if (useMock) return mock.mockClaimTrial()
  return apiRequest<{ amountPhp: number; currency?: string }>('/promotions/trial-play/claim', { method: 'POST', body: JSON.stringify({ currency }) })
}

export interface AppdlStatus {
  enabled: boolean
  amountPhp: number
  turnoverX: number
  turnoverDays: number
  claimed: boolean
}

export async function fetchAppdlStatus(currency = 'PHP'): Promise<AppdlStatus> {
  return apiRequest<AppdlStatus>(`/promotions/app-download?currency=${encodeURIComponent(currency)}`)
}

export async function claimAppdlBonus(source: 'pwa' | 'apk', currency = 'PHP'): Promise<{ amountPhp: number; currency?: string }> {
  return apiRequest<{ amountPhp: number }>('/promotions/app-download/claim', {
    method: 'POST',
    body: JSON.stringify({ source, currency }),
  })
}

export async function claimFirstDepBonus(): Promise<{ amountPhp: number }> {
  if (useMock) return mock.mockClaimFirstDep()
  return apiRequest<{ amountPhp: number }>('/promotions/firstdep/claim', { method: 'POST' })
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

export interface CurrencyBreakdownItem {
  currency: string
  betCents: number
  fxRate?: number
}

export interface TeamCommissionItem {
  fromUserId: string
  displayName: string
  level: number
  period: string
  turnoverCents: number
  phpEquivCents: number
  ratePct: number
  commissionCents: number
  currency: 'PHP' | 'IDR'
  status: string
  paidAt: string | null
  currencyBreakdown: CurrencyBreakdownItem[] | null
}

export interface TeamCommissionSummary {
  l1Cents: number
  l2Cents: number
  l3Cents: number
  totalCents: number
  paidCents: number
}

export interface TeamWithdrawal {
  id: number
  currency: 'PHP' | 'IDR'
  amountCents: number
  status: string
  rejectReason: string | null
  reviewedAt: string | null
  createdAt: string
}

export async function fetchTeamDownlines(level: 1 | 2 | 3, page: number): Promise<{ items: TeamDownline[]; total: number; page: number }> {
  return apiRequest(`/promotions/team/downlines?level=${level}&page=${page}`)
}

export async function fetchTeamCommissions(month: string): Promise<{ summary: TeamCommissionSummary; items: TeamCommissionItem[]; month: string; currency: 'PHP' | 'IDR' }> {
  return apiRequest(`/promotions/team/commissions?month=${month}`)
}

export async function fetchTeamWallet(): Promise<{ currency: 'PHP' | 'IDR'; availableCents: number; frozenCents: number; lifetimeEarnedCents: number; minWithdrawalCents: number }> {
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
  turnoverCents: number
  currencyBreakdown: { currency: string; betCents: number }[]
  children: TeamTreeNode[]
}

export async function fetchTeamTree(month: string): Promise<{ currency: 'PHP' | 'IDR'; l1Members: TeamTreeNode[] }> {
  return apiRequest(`/promotions/team/tree?month=${encodeURIComponent(month)}`)
}

export interface FirstDepTier { depositAmount: number; bonusAmount: number }

export interface PopupConfig {
  id: string
  enabled: boolean
  order: number
  audience: 'all' | 'guest' | 'no_deposit' | 'new' | 'deposited'
  frequency: 'daily' | 'once' | 'always'
}

/** 按弹窗覆盖人群判断是否对当前用户展示；frequency 由各调用点自行处理（常驻入口不消费） */
export function matchPopupAudience(audience: PopupConfig['audience'], loggedIn: boolean, deposited: boolean): boolean {
  switch (audience) {
    case 'guest':      return !loggedIn
    case 'no_deposit': return !deposited
    case 'new':        return loggedIn && !deposited
    case 'deposited':  return loggedIn && deposited
    default:           return true
  }
}

export type BonusCardId = 'checkin' | 'agent' | 'trial' | 'appdl' | 'firstdep' | 'lossrebate'
export interface BonusCard {
  id: BonusCardId
  enabled: boolean
  order: number
  audience: PopupConfig['audience']
}

/** 负盈利返水（路线A）：统一费率、每日、全等级；用于前台展示统一返水率 */
export interface LossRebateConfig {
  enabled: boolean
  ratePct: number
  minDeposit: number
  /** 参与返水的品类白名单（对应 game.sortCategory：slots/fishing/table/live/sports/other）；后端已下发 */
  eligibleCats?: string[]
}

export interface PromoConfig {
  trial:    { amount: number; amountByCcy?: Record<string, number>; enabled: boolean }
  firstdep: { enabled: boolean; turnoverX: number; turnoverDays?: number; tiers: Record<string, FirstDepTier[]> }
  appdl:    { amount: number; amountByCcy?: Record<string, number>; enabled: boolean; turnoverX: number; turnoverDays?: number }
  lossRebate?: LossRebateConfig
  popups?:  PopupConfig[]
  checkinEnabled?: boolean
  bonusCards?: BonusCard[]
}

// ── 复充限时优惠 ──
export interface RedepOffer {
  active: boolean
  currency?: string
  endsAt?: string
  minDeposit?: number
  bonusAmount?: number
}

/** 进站拉取复充限时优惠（登录态）；符合人群时后端惰性开窗，窗口内重复拉取返回同一倒计时。按币种独立 */
export async function fetchRedepOffer(currency?: string): Promise<RedepOffer> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : ''
  return apiRequest<RedepOffer>(`/promotions/redep-offer${qs}`)
}

export interface NewPlayerSummary {
  registered: boolean
  currency: string
  totalShowcase: number
  tasks: {
    trial:    { enabled: boolean; amount: number; claimed: boolean }
    appdl:    { enabled: boolean; amount: number; claimed: boolean }
    firstdep: { enabled: boolean; maxBonus: number; done: boolean }
  }
  cashback: { dailyCap: number; monthlyCap: number; topRatePct: number }
}

export async function fetchNewPlayerSummary(currency = 'PHP'): Promise<NewPlayerSummary> {
  return apiRequest<NewPlayerSummary>(`/promotions/new-player-summary?currency=${encodeURIComponent(currency)}`)
}

// ── 每日签到 ──
export type CheckinTier = 'starter' | 'premium' | 'elite'
export interface CheckinReward { tier: CheckinTier; n: number }
export interface CheckinStatus {
  enabled: boolean
  today: string
  todayClaimed: boolean
  todayTrack: 'base' | 'enhanced' | null
  enhancedEligibleToday: boolean
  canUpgradeToday: boolean
  streak: number
  cycleDay: number
  monthDays: number
  cycle: { day: number; base: CheckinReward; enh: CheckinReward }[]
  milestones: { atDays: number; tier: CheckinTier; n: number; reached: boolean }[]
}
export interface CheckinClaimResult {
  track: 'base' | 'enhanced'
  streak: number
  cycleDay: number
  monthDays: number
  upgraded: boolean
  grantedChances: number
  milestoneHit: number
}
export async function fetchCheckinStatus(currency = 'PHP'): Promise<CheckinStatus> {
  return apiRequest<CheckinStatus>(`/promotions/checkin/status?currency=${encodeURIComponent(currency)}`)
}
export async function claimCheckin(currency = 'PHP'): Promise<CheckinClaimResult> {
  return apiRequest<CheckinClaimResult>('/promotions/checkin/claim', { method: 'POST', body: JSON.stringify({ currency }) })
}

const DEFAULT_PROMO_CONFIG: PromoConfig = {
  trial:    { amount: 88, enabled: true },
  appdl:    { amount: 66, enabled: false, turnoverX: 5 },
  firstdep: {
    enabled: true,
    turnoverX: 15,
    tiers: {
      PHP: [
        { depositAmount: 100, bonusAmount: 15 }, { depositAmount: 200, bonusAmount: 30 },
        { depositAmount: 500, bonusAmount: 60 }, { depositAmount: 1000, bonusAmount: 70 },
        { depositAmount: 2000, bonusAmount: 100 }, { depositAmount: 5000, bonusAmount: 100 },
        { depositAmount: 10000, bonusAmount: 150 }, { depositAmount: 20000, bonusAmount: 500 },
        { depositAmount: 50000, bonusAmount: 1000 },
      ],
    },
  },
}

export async function fetchPromoConfig(): Promise<PromoConfig> {
  if (useMock) return DEFAULT_PROMO_CONFIG
  try {
    return await apiRequest<PromoConfig>('/promotions/config')
  } catch {
    return DEFAULT_PROMO_CONFIG
  }
}
