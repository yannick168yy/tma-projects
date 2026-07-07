import { create } from 'zustand'
import {
  claimFirstDepBonus,
  claimTrialBonus,
  fetchPromoHighlights,
  fetchRedPacketRecords,
  fetchTeamStatus,
  enableAgent as apiEnableAgent,
  fetchTeamDownlines,
  fetchTeamCommissions,
  fetchTeamWallet,
  submitTeamWithdrawal,
  fetchTeamWithdrawals,
  fetchPromoConfig,
  type TeamDownline,
  type TeamCommissionItem,
  type TeamCommissionSummary,
  type TeamWithdrawal,
  type PromoConfig,
} from '@/api/promotion'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { i18n } from '@/i18n'
import { analytics } from '@/utils/analytics'
import type { PromoHighlight, PromoId, RedPacketRecord, TeamAgentStatus } from '@/types/api'

interface PromotionState {
  promoConfig: PromoConfig | null
  highlights: PromoHighlight[]
  redPacketRecords: RedPacketRecord[]
  redPacketSheet: { open: boolean; amountPhp: number; title: string }
  teamStatus: TeamAgentStatus | null
  teamStatusLoading: boolean
  teamDownlines: { 1: TeamDownline[]; 2: TeamDownline[]; 3: TeamDownline[] }
  teamDownlineTotals: { 1: number; 2: number; 3: number }
  teamDownlinePages: { 1: number; 2: number; 3: number }
  teamDownlineLoading: boolean
  teamCommissionSummary: TeamCommissionSummary | null
  teamCommissionItems: TeamCommissionItem[]
  teamCommissionMonth: string
  teamCommissionLoading: boolean
  teamWallet: { availableCents: number; frozenCents: number; lifetimeEarnedCents: number } | null
  teamWithdrawals: TeamWithdrawal[]
  teamWithdrawalsTotal: number
  teamWithdrawalsPage: number
  teamWithdrawalsLoading: boolean
  trialClaiming: boolean
}

interface PromotionActions {
  loadPromoConfig: () => Promise<void>
  setHighlights: (rows: PromoHighlight[]) => void
  refreshHighlights: () => Promise<void>
  loadLists: () => Promise<void>
  showRedPacket: (title: string, amountPhp: number) => void
  closeRedPacket: () => void
  loadTeamStatus: () => Promise<void>
  enableAgent: () => Promise<{ ok: boolean }>
  loadTeamDownlines: (level: 1 | 2 | 3, page?: number) => Promise<void>
  loadTeamCommissions: (period: string) => Promise<void>
  loadTeamWallet: () => Promise<void>
  submitWithdrawal: (amountCents: number) => Promise<{ ok: boolean; message?: string }>
  loadTeamWithdrawals: (page?: number) => Promise<void>
  claimPromo: (id: PromoId) => Promise<{ ok: boolean; code?: number; message?: string }>
  claimTrialIfEligible: () => Promise<{ ok: boolean; alreadyClaimed?: boolean; message?: string }>
}

export const usePromotionStore = create<PromotionState & PromotionActions>((set, get) => ({
  promoConfig: null,
  highlights: [],
  redPacketRecords: [],
  redPacketSheet: { open: false, amountPhp: 0, title: '' },
  teamStatus: null,
  teamStatusLoading: false,
  teamDownlines: { 1: [], 2: [], 3: [] },
  teamDownlineTotals: { 1: 0, 2: 0, 3: 0 },
  teamDownlinePages: { 1: 1, 2: 1, 3: 1 },
  teamDownlineLoading: false,
  teamCommissionSummary: null,
  teamCommissionItems: [],
  teamCommissionMonth: '',
  teamCommissionLoading: false,
  teamWallet: null,
  teamWithdrawals: [],
  teamWithdrawalsTotal: 0,
  teamWithdrawalsPage: 1,
  teamWithdrawalsLoading: false,
  trialClaiming: false,

  async loadPromoConfig() {
    const cfg = await fetchPromoConfig()
    set({ promoConfig: cfg })
  },
  setHighlights(rows) { set({ highlights: rows }) },

  async refreshHighlights() {
    set({ highlights: await fetchPromoHighlights() })
  },

  async loadLists() {
    set({ redPacketRecords: await fetchRedPacketRecords() })
  },

  showRedPacket(title, amountPhp) {
    set({ redPacketSheet: { open: true, amountPhp, title } })
  },

  closeRedPacket() {
    set({ redPacketSheet: { open: false, amountPhp: 0, title: '' } })
  },

  async loadTeamStatus() {
    if (get().teamStatusLoading) return
    set({ teamStatusLoading: true })
    try {
      set({ teamStatus: await fetchTeamStatus() })
    } catch { /* 未登录或接口不可用 */ } finally {
      set({ teamStatusLoading: false })
    }
  },

  async enableAgent() {
    try {
      await apiEnableAgent()
      await get().loadTeamStatus()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },

  async loadTeamDownlines(level, page = 1) {
    set({ teamDownlineLoading: true })
    try {
      const data = await fetchTeamDownlines(level, page)
      const prev = get().teamDownlines
      set({
        teamDownlines: {
          ...prev,
          [level]: page === 1 ? data.items : [...prev[level], ...data.items],
        },
        teamDownlineTotals: { ...get().teamDownlineTotals, [level]: data.total },
        teamDownlinePages: { ...get().teamDownlinePages, [level]: page },
      })
    } finally {
      set({ teamDownlineLoading: false })
    }
  },

  async loadTeamCommissions(period) {
    set({ teamCommissionLoading: true })
    try {
      const data = await fetchTeamCommissions(period)
      set({
        teamCommissionSummary: data.summary,
        teamCommissionItems: data.items,
        teamCommissionMonth: data.month,
      })
    } finally {
      set({ teamCommissionLoading: false })
    }
  },

  async loadTeamWallet() {
    set({ teamWallet: await fetchTeamWallet() })
  },

  async submitWithdrawal(amountCents) {
    try {
      await submitTeamWithdrawal(amountCents)
      await Promise.all([
        get().loadTeamWallet(),
        get().loadTeamWithdrawals(1),
        get().loadTeamStatus(),
      ])
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : i18n.t('team.withdrawFailed') }
    }
  },

  async loadTeamWithdrawals(page = 1) {
    set({ teamWithdrawalsLoading: true })
    try {
      const data = await fetchTeamWithdrawals(page)
      set({
        teamWithdrawals: data.items,
        teamWithdrawalsTotal: data.total,
        teamWithdrawalsPage: data.page,
      })
    } finally {
      set({ teamWithdrawalsLoading: false })
    }
  },

  async claimPromo(id) {
    const titleKey =
      id === 'trial'
        ? 'bonuses.promos.trial.title'
        : 'bonuses.promos.firstdep.title'
    try {
      let amountPhp = 0
      if (id === 'trial') ({ amountPhp } = await claimTrialBonus())
      else if (id === 'firstdep') ({ amountPhp } = await claimFirstDepBonus())
      analytics.promoClaimSuccess(id, amountPhp)
      await useWalletStore.getState().refresh()
      await get().refreshHighlights()
      await get().loadLists()
      get().showRedPacket(i18n.t(titleKey), amountPhp)
      if (id === 'trial') useAuthStore.getState().clearTrialEligible()
      return { ok: true }
    } catch (e) {
      if (id === 'trial' && e instanceof ApiError && e.code === 409) {
        useAuthStore.getState().clearTrialEligible()
        await get().refreshHighlights()
      }
      const message =
        id === 'trial' && e instanceof ApiError && e.code === 409
          ? i18n.t('bonuses.promos.trial.alreadyClaimed')
          : e instanceof Error
            ? e.message
            : i18n.t('bonuses.promos.trial.claimFailed')
      return { ok: false, code: e instanceof ApiError ? e.code : undefined, message }
    }
  },

  async claimTrialIfEligible() {
    const trialHighlight = getHighlightMap().get('trial')
    const authEligible = useAuthStore.getState().trialEligible
    if (!trialHighlight?.highlight && !authEligible) {
      return { ok: false, alreadyClaimed: true }
    }
    if (get().trialClaiming) return { ok: false, message: i18n.t('bonuses.promos.trial.claiming') }
    set({ trialClaiming: true })
    try {
      const result = await get().claimPromo('trial')
      if (!result.ok && result.code === 409) {
        return { ok: false, alreadyClaimed: true, message: result.message }
      }
      return result
    } finally {
      set({ trialClaiming: false })
    }
  },
}))

export function getHighlightMap() {
  const map = new Map<PromoId, PromoHighlight>()
  for (const h of usePromotionStore.getState().highlights) map.set(h.promoId, h)
  return map
}
