import { defineStore } from 'pinia'
import {
  claimFirstDepBonus,
  claimReferralBonus,
  claimTrialBonus,
  fetchPromoHighlights,
  fetchRedPacketRecords,
  fetchReferralRecords,
  fetchTeamStatus,
  enableAgent as apiEnableAgent,
  fetchTeamDownlines,
  fetchTeamCommissions,
  fetchTeamWallet,
  submitTeamWithdrawal,
  fetchTeamWithdrawals,
  type TeamDownline,
  type TeamCommissionItem,
  type TeamCommissionSummary,
  type TeamWithdrawal,
} from '@/api/promotion'
import { creditWallet } from '@/api/wallet'
import { useWalletStore } from '@/stores/wallet'
import type { PromoHighlight, PromoId, RedPacketRecord, ReferralRecord, TeamAgentStatus } from '@/types/api'

export const usePromotionStore = defineStore('promotion', {
  state: () => ({
    highlights: [] as PromoHighlight[],
    referralRecords: [] as ReferralRecord[],
    redPacketRecords: [] as RedPacketRecord[],
    redPacketSheet: { open: false, amountPhp: 0, title: '' },
    teamStatus: null as TeamAgentStatus | null,
    teamStatusLoading: false,
    // 分销中心详情
    teamDownlines: { 1: [] as TeamDownline[], 2: [] as TeamDownline[], 3: [] as TeamDownline[] },
    teamDownlineTotals: { 1: 0, 2: 0, 3: 0 },
    teamDownlinePages: { 1: 1, 2: 1, 3: 1 },
    teamDownlineLoading: false,
    teamCommissionSummary: null as TeamCommissionSummary | null,
    teamCommissionItems: [] as TeamCommissionItem[],
    teamCommissionPeriod: '',
    teamCommissionLoading: false,
    teamWallet: null as { availableCents: number; frozenCents: number; lifetimeEarnedCents: number } | null,
    teamWithdrawals: [] as TeamWithdrawal[],
    teamWithdrawalsTotal: 0,
    teamWithdrawalsPage: 1,
    teamWithdrawalsLoading: false,
  }),

  getters: {
    highlightMap: (s) => {
      const map = new Map<PromoId, PromoHighlight>()
      for (const h of s.highlights) map.set(h.promoId, h)
      return map
    },
  },

  actions: {
    setHighlights(rows: PromoHighlight[]) {
      this.highlights = rows
    },

    async refreshHighlights() {
      this.highlights = await fetchPromoHighlights()
    },

    async loadLists() {
      ;[this.referralRecords, this.redPacketRecords] = await Promise.all([
        fetchReferralRecords(),
        fetchRedPacketRecords(),
      ])
    },

    showRedPacket(title: string, amountPhp: number) {
      this.redPacketSheet = { open: true, amountPhp, title }
    },

    closeRedPacket() {
      this.redPacketSheet = { open: false, amountPhp: 0, title: '' }
    },

    async loadTeamStatus() {
      if (this.teamStatusLoading) return
      this.teamStatusLoading = true
      try {
        this.teamStatus = await fetchTeamStatus()
      } catch {
        // 未登录或接口暂不可用，不阻塞页面
      } finally {
        this.teamStatusLoading = false
      }
    },

    async enableAgent(): Promise<{ ok: boolean }> {
      try {
        await apiEnableAgent()
        await this.loadTeamStatus()
        return { ok: true }
      } catch (e) {
        return { ok: false }
      }
    },

    async loadTeamDownlines(level: 1 | 2 | 3, page = 1) {
      this.teamDownlineLoading = true
      try {
        const data = await fetchTeamDownlines(level, page)
        if (page === 1) this.teamDownlines[level] = data.items
        else this.teamDownlines[level] = [...this.teamDownlines[level], ...data.items]
        this.teamDownlineTotals[level] = data.total
        this.teamDownlinePages[level] = page
      } finally {
        this.teamDownlineLoading = false
      }
    },

    async loadTeamCommissions(period: string) {
      this.teamCommissionLoading = true
      try {
        const data = await fetchTeamCommissions(period)
        this.teamCommissionSummary = data.summary
        this.teamCommissionItems = data.items
        this.teamCommissionPeriod = data.period
      } finally {
        this.teamCommissionLoading = false
      }
    },

    async loadTeamWallet() {
      this.teamWallet = await fetchTeamWallet()
    },

    async submitWithdrawal(amountCents: number): Promise<{ ok: boolean; message?: string }> {
      try {
        await submitTeamWithdrawal(amountCents)
        await Promise.all([this.loadTeamWallet(), this.loadTeamWithdrawals(1), this.loadTeamStatus()])
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : '提现失败' }
      }
    },

    async loadTeamWithdrawals(page = 1) {
      this.teamWithdrawalsLoading = true
      try {
        const data = await fetchTeamWithdrawals(page)
        this.teamWithdrawals = data.items
        this.teamWithdrawalsTotal = data.total
        this.teamWithdrawalsPage = data.page
      } finally {
        this.teamWithdrawalsLoading = false
      }
    },

    async claimPromo(id: PromoId): Promise<{ ok: boolean; message?: string }> {
      try {
        let amountPhp = 0
        if (id === 'trial') ({ amountPhp } = await claimTrialBonus())
        else if (id === 'referral') ({ amountPhp } = await claimReferralBonus())
        else if (id === 'firstdep') ({ amountPhp } = await claimFirstDepBonus())
        await creditWallet(amountPhp * 100)
        await useWalletStore().refresh()
        await this.refreshHighlights()
        await this.loadLists()
        this.showRedPacket('Bonus credited', amountPhp)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Claim failed' }
      }
    },
  },
})
