<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, Copy, Share2, Link2, Users, Wallet, TrendingUp, CheckCircle2, Clock, XCircle } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { usePromotionStore } from '@/stores/promotion'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const store = usePromotionStore()

const activeTab = ref<'team' | 'commissions' | 'withdraw'>('team')
const activeLevel = ref<1 | 2 | 3>(1)
const copyTip = ref(false)
const withdrawInput = ref('')
const withdrawing = ref(false)
const withdrawError = ref('')
const commissionPeriod = ref(currentPeriod())

const teamStatus    = computed(() => store.teamStatus)
const teamWallet    = computed(() => store.teamWallet)
const inviteCode    = computed(() => auth.user?.inviteCode ?? '')
const deepLink      = computed(() => `https://t.me/BetoGoBot/app?startapp=ref_${inviteCode.value}`)

const downlines       = computed(() => store.teamDownlines[activeLevel.value])
const downlineTotal   = computed(() => store.teamDownlineTotals[activeLevel.value])
const downlinePage    = computed(() => store.teamDownlinePages[activeLevel.value])
const downlineLoading = computed(() => store.teamDownlineLoading)
const hasMoreDownlines = computed(() =>
  downlines.value.length < downlineTotal.value
)

const commissionSummary = computed(() => store.teamCommissionSummary)
const commissionItems   = computed(() => store.teamCommissionItems)
const commissionLoading = computed(() => store.teamCommissionLoading)

const withdrawals        = computed(() => store.teamWithdrawals)
const withdrawalsLoading = computed(() => store.teamWithdrawalsLoading)

onMounted(async () => {
  await Promise.all([
    store.loadTeamStatus(),
    store.loadTeamDownlines(1, 1),
    store.loadTeamCommissions(commissionPeriod.value),
    store.loadTeamWallet(),
    store.loadTeamWithdrawals(1),
  ])
})

watch(activeLevel, (lvl) => {
  if (!store.teamDownlines[lvl].length) store.loadTeamDownlines(lvl, 1)
})

watch(commissionPeriod, (p) => store.loadTeamCommissions(p))

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function copyLink() {
  await navigator.clipboard.writeText(deepLink.value).catch(() => {})
  copyTip.value = true
  setTimeout(() => { copyTip.value = false }, 1800)
}

function shareToTelegram() {
  const text = encodeURIComponent(`Join BetoGo — use my code ${inviteCode.value}!\n${deepLink.value}`)
  window.open(`https://t.me/share/url?url=${encodeURIComponent(deepLink.value)}&text=${text}`, '_blank')
}

async function shareToWeb() {
  const shareData = {
    title: 'BetoGo',
    text: `Join BetoGo — use my code ${inviteCode.value}!`,
    url: deepLink.value,
  }
  if (navigator.share) {
    try { await navigator.share(shareData) } catch { /* cancelled */ }
  } else {
    await copyLink()
  }
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function loadMoreDownlines() {
  store.loadTeamDownlines(activeLevel.value, downlinePage.value + 1)
}

async function submitWithdraw() {
  withdrawError.value = ''
  const cents = Math.round(parseFloat(withdrawInput.value) * 100)
  if (!cents || cents <= 0) { withdrawError.value = '请输入有效金额'; return }
  withdrawing.value = true
  const res = await store.submitWithdrawal(cents)
  withdrawing.value = false
  if (res.ok) {
    withdrawInput.value = ''
  } else {
    withdrawError.value = res.message ?? '提现失败，请重试'
  }
}

const statusColor: Record<string, string> = {
  pending:  'text-amber-400',
  paid:     'text-emerald-400',
  voided:   'text-muted-foreground',
  approved: 'text-emerald-400',
  rejected: 'text-red-400',
}

const levelBadge: Record<number, string> = {
  1: 'bg-amber-500/20 text-amber-400',
  2: 'bg-blue-500/20 text-blue-400',
  3: 'bg-purple-500/20 text-purple-400',
}

const tabs = [
  { id: 'team'        as const, label: t('team.tabTeam'),        icon: Users },
  { id: 'commissions' as const, label: t('team.tabCommissions'),  icon: TrendingUp },
  { id: 'withdraw'    as const, label: t('team.tabWithdraw'),     icon: Wallet },
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
      <p v-if="copyTip" class="text-center text-xs text-amber-400 -mt-1 mb-2">{{ t('team.copied') }}</p>
      <div class="flex gap-2">
        <button type="button"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm"
          @click="shareToTelegram">
          <Share2 :size="14" />
          {{ t('team.shareOnTelegram') }}
        </button>
        <button type="button"
          class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/50 text-amber-400 font-black text-sm"
          @click="shareToWeb">
          <Link2 :size="14" />
          {{ t('team.shareLink') }}
        </button>
      </div>
    </div>

    <!-- 快捷统计 -->
    <div class="grid grid-cols-3 gap-0 border-b border-border flex-shrink-0">
      <div v-for="lvl in [1,2,3]" :key="lvl" class="py-3 text-center" :class="lvl < 3 ? 'border-r border-border' : ''">
        <div class="text-lg font-black text-amber-400 leading-none">{{ teamStatus?.[`l${lvl}Count` as 'l1Count'|'l2Count'|'l3Count'] ?? 0 }}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">L{{ lvl }}</div>
      </div>
    </div>

    <!-- Tab 导航 -->
    <div class="flex border-b border-border flex-shrink-0">
      <button v-for="tab in tabs" :key="tab.id" type="button"
        class="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition-colors"
        :class="activeTab === tab.id ? 'text-amber-400 border-b-2 border-amber-400 -mb-px' : 'text-muted-foreground'"
        @click="activeTab = tab.id">
        <component :is="tab.icon" :size="15" />
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div class="flex-1 overflow-y-auto page-scroll">

      <!-- ── Tab1：我的团队 ── -->
      <template v-if="activeTab === 'team'">
        <!-- L1/L2/L3 切换 -->
        <div class="flex gap-2 px-4 pt-4 pb-3">
          <button v-for="lvl in ([1,2,3] as const)" :key="lvl" type="button"
            class="flex-1 py-1.5 rounded-full text-xs font-bold transition-colors"
            :class="activeLevel === lvl
              ? 'bg-amber-500 text-black'
              : 'bg-secondary text-muted-foreground'"
            @click="activeLevel = lvl">
            L{{ lvl }} {{ t('team.tabTeam') }} ({{ store.teamDownlineTotals[lvl] }})
          </button>
        </div>

        <!-- 下线列表 -->
        <div class="px-4 space-y-2 pb-4">
          <div v-if="downlineLoading && !downlines.length" class="space-y-2">
            <div v-for="n in 5" :key="n" class="h-14 animate-pulse rounded-xl bg-secondary" />
          </div>

          <div v-else-if="!downlines.length" class="py-12 text-center text-muted-foreground">
            <Users :size="36" class="mx-auto mb-3 opacity-30" />
            <p class="text-sm">{{ t('team.noDownlines') }}</p>
          </div>

          <div v-for="dl in downlines" :key="dl.userId"
            class="flex items-center gap-3 bg-secondary rounded-xl px-3 py-3">
            <div class="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <span class="text-amber-400 font-black text-sm">{{ dl.maskedName[0] }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-foreground font-bold text-sm leading-none mb-0.5">{{ dl.maskedName }}</p>
              <p class="text-muted-foreground text-[10px]">{{ new Date(dl.registeredAt).toLocaleDateString() }}</p>
            </div>
            <div class="flex-shrink-0">
              <span v-if="dl.activated"
                class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                {{ t('team.activated') }}
              </span>
              <span v-else
                class="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                {{ t('team.pending') }}
              </span>
            </div>
          </div>

          <!-- 加载更多 -->
          <button v-if="hasMoreDownlines && !downlineLoading" type="button"
            class="w-full py-2.5 text-xs font-bold text-amber-400 bg-amber-500/10 rounded-xl"
            @click="loadMoreDownlines">
            {{ t('team.loadMore') }}
          </button>
          <div v-if="downlineLoading && downlines.length" class="text-center text-xs text-muted-foreground py-2">
            Loading...
          </div>
        </div>
      </template>

      <!-- ── Tab2：收益明细 ── -->
      <template v-else-if="activeTab === 'commissions'">
        <!-- 月份选择 -->
        <div class="px-4 pt-4 pb-3">
          <input type="month" v-model="commissionPeriod"
            class="w-full bg-secondary text-foreground rounded-xl px-3 py-2 text-sm border border-border outline-none focus:ring-1 focus:ring-amber-500" />
        </div>

        <!-- 汇总卡 -->
        <div class="px-4 pb-3">
          <div class="bg-gradient-to-br from-[#78350f]/30 to-transparent rounded-2xl border border-amber-500/20 p-3">
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div class="bg-black/20 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-base leading-none">{{ phpDisplay(commissionSummary?.l1Cents ?? 0) }}</div>
                <div class="text-white/50 text-[9px] mt-0.5">L1 · 25%</div>
              </div>
              <div class="bg-black/20 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-base leading-none">{{ phpDisplay(commissionSummary?.l2Cents ?? 0) }}</div>
                <div class="text-white/50 text-[9px] mt-0.5">L2 · 8%</div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-black/20 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-base leading-none">{{ phpDisplay(commissionSummary?.l3Cents ?? 0) }}</div>
                <div class="text-white/50 text-[9px] mt-0.5">L3 · 3%</div>
              </div>
              <div class="bg-amber-500/20 rounded-xl p-2 text-center border border-amber-500/30">
                <div class="text-amber-300 font-black text-base leading-none">{{ phpDisplay(commissionSummary?.totalCents ?? 0) }}</div>
                <div class="text-amber-300/60 text-[9px] mt-0.5">{{ t('team.total') }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 明细列表 -->
        <div class="px-4 space-y-2 pb-4">
          <div v-if="commissionLoading" class="space-y-2">
            <div v-for="n in 5" :key="n" class="h-14 animate-pulse rounded-xl bg-secondary" />
          </div>

          <div v-else-if="!commissionItems.length" class="py-8 text-center text-muted-foreground">
            <TrendingUp :size="36" class="mx-auto mb-3 opacity-30" />
            <p class="text-sm">{{ t('team.noCommissions') }}</p>
          </div>

          <div v-for="(item, i) in commissionItems" :key="i"
            class="flex items-center gap-3 bg-secondary rounded-xl px-3 py-2.5">
            <span class="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
              :class="levelBadge[item.level]">
              L{{ item.level }}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-foreground font-bold text-xs leading-none mb-0.5">{{ item.maskedName }}</p>
              <p class="text-muted-foreground text-[10px]">GGR {{ phpDisplay(item.ggrCents) }} × {{ item.ratePct }}%</p>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="text-amber-400 font-black text-sm leading-none">{{ phpDisplay(item.commissionCents) }}</p>
              <p class="text-[9px] mt-0.5" :class="statusColor[item.status] ?? 'text-muted-foreground'">
                {{ item.status }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Tab3：提现 ── -->
      <template v-else>
        <!-- 余额卡 -->
        <div class="px-4 pt-4 pb-3">
          <div class="bg-gradient-to-br from-[#78350f]/30 to-transparent rounded-2xl border border-amber-500/20 p-4 text-center">
            <p class="text-[10px] font-bold uppercase tracking-widest text-amber-400/70 mb-1">{{ t('team.available') }}</p>
            <p class="text-4xl font-black text-amber-400 leading-none mb-2">
              {{ phpDisplay(teamWallet?.availableCents ?? 0) }}
            </p>
            <div class="flex justify-center gap-4 text-[10px] text-muted-foreground">
              <span>{{ t('team.frozen') }}: {{ phpDisplay(teamWallet?.frozenCents ?? 0) }}</span>
              <span>{{ t('team.lifetime') }}: {{ phpDisplay(teamWallet?.lifetimeEarnedCents ?? 0) }}</span>
            </div>
          </div>
        </div>

        <!-- 提现表单 -->
        <div class="px-4 pb-4">
          <div class="bg-secondary rounded-2xl p-4 mb-3">
            <p class="text-xs font-bold text-foreground mb-2">{{ t('team.withdrawAmount') }}</p>
            <div class="flex gap-2">
              <div class="flex-1 relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">₱</span>
                <input type="number" v-model="withdrawInput"
                  :placeholder="`${t('team.minWithdraw')} ₱50`"
                  min="50" step="1"
                  class="w-full bg-background rounded-xl pl-7 pr-3 py-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-amber-500 border border-border" />
              </div>
              <button type="button"
                class="px-3 py-2.5 bg-amber-500/20 text-amber-400 rounded-xl text-xs font-bold"
                @click="withdrawInput = String((teamWallet?.availableCents ?? 0) / 100)">
                {{ t('team.max') }}
              </button>
            </div>
            <p v-if="withdrawError" class="text-red-400 text-xs mt-1.5">{{ withdrawError }}</p>
            <p class="text-muted-foreground text-[10px] mt-1.5">{{ t('team.withdrawHint') }}</p>
          </div>

          <button type="button"
            class="w-full py-3 rounded-xl font-black text-sm transition-opacity"
            :class="withdrawing ? 'bg-amber-500/50 text-black/50' : 'bg-amber-500 text-black'"
            :disabled="withdrawing"
            @click="submitWithdraw">
            {{ withdrawing ? t('team.withdrawing') : t('team.withdrawSubmit') }}
          </button>
        </div>

        <!-- 提现记录 -->
        <div class="px-4 pb-6">
          <p class="text-xs font-bold text-foreground mb-2">{{ t('team.withdrawHistory') }}</p>

          <div v-if="withdrawalsLoading" class="space-y-2">
            <div v-for="n in 3" :key="n" class="h-14 animate-pulse rounded-xl bg-secondary" />
          </div>

          <div v-else-if="!withdrawals.length" class="py-6 text-center text-muted-foreground text-xs">
            {{ t('team.noWithdrawals') }}
          </div>

          <div v-for="wd in withdrawals" :key="wd.id"
            class="flex items-center gap-3 bg-secondary rounded-xl px-3 py-3 mb-2">
            <component
              :is="wd.status === 'approved' ? CheckCircle2 : wd.status === 'rejected' ? XCircle : Clock"
              :size="18"
              :class="statusColor[wd.status] ?? 'text-muted-foreground'"
              class="flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-foreground font-bold text-sm leading-none mb-0.5">{{ phpDisplay(wd.amountCents) }}</p>
              <p class="text-muted-foreground text-[10px]">{{ new Date(wd.createdAt).toLocaleDateString() }}</p>
              <p v-if="wd.rejectReason" class="text-red-400 text-[10px] mt-0.5">{{ wd.rejectReason }}</p>
            </div>
            <span class="text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
              :class="{
                'bg-amber-500/20 text-amber-400': wd.status === 'pending',
                'bg-emerald-500/20 text-emerald-400': wd.status === 'approved',
                'bg-red-500/20 text-red-400': wd.status === 'rejected',
              }">
              {{ wd.status }}
            </span>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>
