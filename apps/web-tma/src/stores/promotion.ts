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
