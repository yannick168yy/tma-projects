<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, Copy, Share2, Users, Wallet, TrendingUp } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const promotionStore = usePromotionStore()

const activeTab = ref<'team' | 'commissions' | 'withdraw'>('team')
const copyTip = ref(false)

const teamStatus = computed(() => promotionStore.teamStatus)
const inviteCode = computed(() => auth.user?.inviteCode ?? '')
const deepLink = computed(() => `https://t.me/BetoGoBot/app?startapp=ref_${inviteCode.value}`)

onMounted(() => {
  promotionStore.loadTeamStatus()
})

async function copyLink() {
  await navigator.clipboard.writeText(deepLink.value)
  copyTip.value = true
  setTimeout(() => { copyTip.value = false }, 1800)
}

function shareToTelegram() {
  const text = encodeURIComponent(`Join BetoGo with my code ${inviteCode.value}! ${deepLink.value}`)
  window.open(`https://t.me/share/url?url=${encodeURIComponent(deepLink.value)}&text=${text}`, '_blank')
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const tabs = [
  { id: 'team' as const, label: t('team.tabTeam'), icon: Users },
  { id: 'commissions' as const, label: t('team.tabCommissions'), icon: TrendingUp },
  { id: 'withdraw' as const, label: t('team.tabWithdraw'), icon: Wallet },
]
</script>

<template>
  <div class="min-h-full bg-background flex flex-col">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 border-b border-border px-4 py-3 flex-shrink-0">
      <button type="button" class="flex-shrink-0 text-muted-foreground" @click="emit('close')">
        <ChevronLeft :size="22" />
      </button>
      <h2 class="flex-1 text-sm font-bold text-foreground">{{ t('team.title') }}</h2>
      <span class="text-xs font-black text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">AGENT</span>
    </div>

    <!-- 邀请链接区 -->
    <div class="px-4 py-4 bg-gradient-to-br from-[#78350f]/40 via-[#92400e]/20 to-transparent border-b border-border flex-shrink-0">
      <p class="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-2">{{ t('team.myReferralCode') }}</p>
      <div class="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2 border border-amber-500/20 mb-3">
        <span class="flex-1 font-black text-amber-400 tracking-widest text-sm">{{ inviteCode }}</span>
        <button type="button" class="text-muted-foreground hover:text-amber-400 transition-colors" @click="copyLink">
          <Copy :size="15" />
        </button>
      </div>
      <div v-if="copyTip" class="text-center text-xs text-amber-400 mb-2 -mt-1">{{ t('team.copied') }}</div>
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm"
        @click="shareToTelegram"
      >
        <Share2 :size="14" />
        {{ t('team.shareOnTelegram') }}
      </button>
    </div>

    <!-- 快捷统计 -->
    <div class="grid grid-cols-3 gap-0 border-b border-border flex-shrink-0">
      <div class="py-3 text-center border-r border-border">
        <div class="text-lg font-black text-amber-400 leading-none">{{ teamStatus?.l1Count ?? 0 }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">L1</div>
      </div>
      <div class="py-3 text-center border-r border-border">
        <div class="text-lg font-black text-amber-400 leading-none">{{ teamStatus?.l2Count ?? 0 }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">L2</div>
      </div>
      <div class="py-3 text-center">
        <div class="text-lg font-black text-amber-400 leading-none">{{ teamStatus?.l3Count ?? 0 }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">L3</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-border flex-shrink-0">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors"
        :class="activeTab === tab.id ? 'text-amber-400 border-b-2 border-amber-400 -mb-px' : 'text-muted-foreground'"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" :size="15" />
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="flex-1 overflow-y-auto page-scroll">
      <!-- 我的团队 -->
      <div v-if="activeTab === 'team'" class="px-4 py-6 text-center text-muted-foreground">
        <Users :size="40" class="mx-auto mb-3 opacity-30" />
        <p class="text-sm font-bold text-foreground mb-1">{{ t('team.comingSoon') }}</p>
        <p class="text-xs leading-relaxed">{{ t('team.comingSoonDesc') }}</p>
      </div>

      <!-- 收益明细 -->
      <div v-else-if="activeTab === 'commissions'" class="px-4 py-6 text-center text-muted-foreground">
        <TrendingUp :size="40" class="mx-auto mb-3 opacity-30" />
        <p class="text-sm font-bold text-foreground mb-1">{{ t('team.comingSoon') }}</p>
        <p class="text-xs leading-relaxed">{{ t('team.comingSoonDesc') }}</p>
      </div>

      <!-- 提现 -->
      <div v-else class="px-4 py-4">
        <div class="bg-secondary rounded-2xl px-4 py-4 text-center mb-4">
          <p class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{{ t('team.available') }}</p>
          <p class="text-3xl font-black text-amber-400">{{ phpDisplay(teamStatus?.availableCents ?? 0) }}</p>
          <p class="text-[10px] text-muted-foreground mt-1">{{ t('team.lifetime') }}: {{ phpDisplay(teamStatus?.lifetimeEarnedCents ?? 0) }}</p>
        </div>
        <div class="py-6 text-center text-muted-foreground">
          <Wallet :size="40" class="mx-auto mb-3 opacity-30" />
          <p class="text-sm font-bold text-foreground mb-1">{{ t('team.comingSoon') }}</p>
          <p class="text-xs leading-relaxed">{{ t('team.comingSoonDesc') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
