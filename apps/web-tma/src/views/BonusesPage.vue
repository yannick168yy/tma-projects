<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trophy, ChevronDown, Users, Wallet } from 'lucide-vue-next'
import { BONUS_WINNERS, PROMOS, PROMO_STATS } from '@/data/promos'
import { usePromotionStore } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ promoFilter?: string | null }>()
const emit = defineEmits<{ openWallet: []; openTeam: [] }>()

const { t } = useI18n()
const promotionStore = usePromotionStore()
const auth = useAuthStore()

const expanded = ref<string | null>(props.promoFilter ?? null)
const agentActivating = ref(false)
const agentExpanded = ref(false)

const teamStatus = computed(() => promotionStore.teamStatus)

onMounted(() => {
  if (auth.isLoggedIn) promotionStore.loadTeamStatus()
})

async function onActivateAgent() {
  if (!(await auth.ensureLoggedIn(t('auth.signInProfile')))) return
  agentActivating.value = true
  await promotionStore.enableAgent()
  agentActivating.value = false
}

function phpDisplay(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const localizedPromos = computed(() =>
  PROMOS.map((p) => {
    const base = `bonuses.promos.${p.id}`
    const stepList =
      p.id === 'referral'
        ? [t(`${base}.step1`), t(`${base}.step2`), t(`${base}.step3`)]
        : [t(`${base}.step1`), t(`${base}.step2`)]
    return {
      ...p,
      tag: t(`${base}.tag`),
      title: t(`${base}.title`),
      tagline: t(`${base}.tagline`),
      rewardLabel: t(`${base}.rewardLabel`),
      desc: t(`${base}.desc`),
      badge: t(`${base}.badge`),
      cta: t(`${base}.cta`),
      steps: stepList,
      expiry: p.expiry === 'Ongoing' ? t('common.ongoing') : t('common.limitedTime'),
    }
  }),
)

const localizedStats = computed(() =>
  PROMO_STATS.map((s, i) => {
    const keys = ['distributed', 'active', 'winnersToday'] as const
    return { ...s, label: t(`bonuses.stats.${keys[i]}`) }
  }),
)

watch(
  () => props.promoFilter,
  (id) => {
    if (id) {
      expanded.value = id
      setTimeout(() => {
        document.getElementById(`promo-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="page-main">
    <div
      class="relative px-4 pt-3 pb-5 overflow-hidden"
      style="background: linear-gradient(160deg, #1a0060 0%, #080b14 60%)"
    >
      <p class="text-muted-foreground text-[11px] uppercase tracking-widest font-bold mb-1">
        {{ t('bonuses.exclusive') }}
      </p>
      <h1 class="text-white font-black leading-tight mb-1 font-display text-[1.8rem]">
        {{ t('bonuses.titleLine1') }}<br /><span class="text-primary">{{ t('bonuses.titleLine2') }}</span>
      </h1>
      <p class="text-white/50 text-xs max-w-[220px] leading-relaxed">{{ t('bonuses.heroSub') }}</p>
      <div class="flex gap-3 mt-4">
        <div
          v-for="s in localizedStats"
          :key="s.label"
          class="flex-1 bg-white/5 rounded-xl px-2.5 py-2 text-center border border-white/8"
        >
          <p class="text-base leading-none mb-0.5">{{ s.icon }}</p>
          <p class="text-primary font-black text-sm leading-none">{{ s.value }}</p>
          <p class="text-white/40 text-[9px] mt-0.5 leading-tight">{{ s.label }}</p>
        </div>
      </div>
    </div>

    <div class="mx-4 mt-3 bg-secondary rounded-xl px-3 py-2 flex items-center gap-2 overflow-hidden">
      <div class="flex-shrink-0 flex items-center gap-1 text-primary">
        <Trophy :size="12" />
        <span class="text-[10px] font-black uppercase whitespace-nowrap">{{ t('bonuses.recentClaims') }}</span>
      </div>
      <div class="w-px h-3 bg-border flex-shrink-0" />
      <div class="overflow-hidden flex-1">
        <div class="flex gap-5 animate-marquee whitespace-nowrap" style="animation-duration: 14s">
          <span v-for="(w, i) in [...BONUS_WINNERS, ...BONUS_WINNERS]" :key="i" class="text-[11px] flex-shrink-0">
            <span class="text-primary font-bold">{{ w.name }}</span>
            <span class="text-white/50"> {{ t('common.claimed') }} </span>
            <span class="text-emerald-400 font-bold">{{ w.amount }}</span>
            <span class="text-white/30"> · {{ w.promo }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="px-4 mt-4 space-y-3">
      <!-- ── 三级分销代理卡 ── -->
      <div class="rounded-2xl overflow-hidden border border-amber-500/30">
        <!-- 头部渐变区 -->
        <div class="relative bg-gradient-to-br from-[#78350f] via-[#92400e] to-[#b45309] px-4 py-4">
          <span class="text-3xl absolute top-3 right-4">🏆</span>
          <span class="text-[10px] font-black uppercase tracking-widest text-amber-300">{{ t('bonuses.promos.agent.tag') }}</span>

          <!-- 未开启 -->
          <template v-if="!teamStatus?.isAgent">
            <h2 class="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">{{ t('bonuses.promos.agent.title') }}</h2>
            <p class="text-white/60 text-xs mt-0.5">{{ t('bonuses.promos.agent.tagline') }}</p>
            <div class="flex gap-2 mt-3">
              <div class="flex-1 bg-black/30 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-lg leading-none">25%</div>
                <div class="text-white/50 text-[9px] mt-0.5">{{ t('bonuses.promos.agent.rateL1') }}</div>
              </div>
              <div class="flex-1 bg-black/30 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-lg leading-none">8%</div>
                <div class="text-white/50 text-[9px] mt-0.5">{{ t('bonuses.promos.agent.rateL2') }}</div>
              </div>
              <div class="flex-1 bg-black/30 rounded-xl p-2 text-center">
                <div class="text-amber-400 font-black text-lg leading-none">3%</div>
                <div class="text-white/50 text-[9px] mt-0.5">{{ t('bonuses.promos.agent.rateL3') }}</div>
              </div>
            </div>
          </template>

          <!-- 已开启 -->
          <template v-else>
            <h2 class="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">{{ t('bonuses.promos.agent.title') }}</h2>
            <div class="flex gap-2 mt-3">
              <div class="flex-1 bg-black/30 rounded-xl px-3 py-2">
                <div class="flex items-center gap-1 mb-0.5">
                  <Users :size="10" class="text-amber-400" />
                  <span class="text-white/50 text-[9px]">{{ t('bonuses.promos.agent.teamLabel') }}</span>
                </div>
                <div class="text-amber-400 font-black text-sm leading-none">
                  L1 {{ teamStatus.l1Count }} · L2 {{ teamStatus.l2Count }} · L3 {{ teamStatus.l3Count }}
                </div>
              </div>
              <div class="bg-black/30 rounded-xl px-3 py-2 text-right">
                <div class="flex items-center justify-end gap-1 mb-0.5">
                  <Wallet :size="10" class="text-amber-400" />
                  <span class="text-white/50 text-[9px]">{{ t('bonuses.promos.agent.commissionLabel') }}</span>
                </div>
                <div class="text-amber-400 font-black text-sm leading-none">{{ phpDisplay(teamStatus.availableCents) }}</div>
              </div>
            </div>
            <div v-if="!teamStatus.activated" class="mt-2 bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-1.5">
              <p class="text-amber-300 text-[10px] leading-relaxed">{{ t('bonuses.promos.agent.activationHint') }}</p>
            </div>
          </template>
        </div>

        <!-- 卡片底部 -->
        <div class="bg-card px-4 py-3">
          <p class="text-muted-foreground text-xs leading-relaxed">{{ t('bonuses.promos.agent.desc') }}</p>

          <!-- 活动说明折叠 -->
          <button
            type="button"
            class="w-full flex items-center justify-between mt-3 py-2 border-t border-border"
            @click="agentExpanded = !agentExpanded"
          >
            <span class="text-foreground text-xs font-bold">{{ t('bonuses.howItWorks') }}</span>
            <ChevronDown :size="14" class="text-muted-foreground transition-transform duration-200" :class="agentExpanded ? 'rotate-180' : ''" />
          </button>
          <div v-if="agentExpanded" class="pb-2 space-y-2">
            <div v-for="(step, i) in [t('bonuses.promos.agent.step1'), t('bonuses.promos.agent.step2'), t('bonuses.promos.agent.step3')]" :key="i" class="flex items-start gap-2.5">
              <div class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[11px] text-black mt-0.5 bg-amber-400">{{ i + 1 }}</div>
              <span class="text-foreground/80 text-xs leading-relaxed">{{ step }}</span>
            </div>
          </div>

          <!-- CTA 按钮 -->
          <button
            v-if="!teamStatus?.isAgent"
            type="button"
            class="w-full mt-3 py-3 rounded-xl text-black font-black text-sm transition-opacity bg-amber-500 hover:bg-amber-400"
            :class="agentActivating ? 'opacity-60 pointer-events-none' : ''"
            @click="onActivateAgent"
          >
            {{ agentActivating ? t('bonuses.promos.agent.activating') : t('bonuses.promos.agent.cta') }}
          </button>
          <button
            v-else
            type="button"
            class="w-full mt-3 py-3 rounded-xl text-black font-black text-sm bg-amber-500 hover:bg-amber-400 transition-colors"
            @click="emit('openTeam')"
          >
            {{ t('bonuses.promos.agent.ctaActive') }}
          </button>
        </div>
      </div>
      <!-- ── 三级分销代理卡 结束 ── -->

      <div
        v-for="p in localizedPromos"
        :id="`promo-${p.id}`"
        :key="p.id"
        class="rounded-2xl overflow-hidden border"
        :class="[
          p.highlight ? 'border-purple-500/40' : 'border-white/8',
          promoFilter === p.id ? 'ring-2 ring-primary/60' : '',
        ]"
      >
        <div class="relative bg-gradient-to-br px-4 py-4" :class="p.gradient">
          <div
            v-if="p.highlight"
            class="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 rounded-full"
          >
            {{ t('bonuses.featuredBadge') }}
          </div>
          <div class="flex items-start justify-between">
            <div class="flex-1 pr-12">
              <span class="text-[10px] font-black uppercase tracking-widest" :style="{ color: p.accentColor }">
                {{ p.tag }}
              </span>
              <h2 class="text-white font-black leading-tight mt-0.5 font-display text-[1.3rem]">{{ p.title }}</h2>
              <p class="text-white/60 text-xs mt-0.5">{{ p.tagline }}</p>
            </div>
            <span class="text-3xl">{{ p.icon }}</span>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <div class="bg-black/30 rounded-xl px-3 py-1.5 flex items-baseline gap-1.5">
              <span class="text-white font-black text-xl leading-none font-display">{{ p.reward }}</span>
              <span class="text-white/60 text-xs">{{ p.rewardLabel }}</span>
            </div>
            <span class="text-[10px] font-black px-2 py-1 rounded-full" :class="p.badgeColor">{{ p.badge }}</span>
            <span class="ml-auto text-[10px] text-white/40 font-semibold">🕐 {{ p.expiry }}</span>
          </div>
        </div>

        <div class="bg-card px-4 py-3">
          <p class="text-muted-foreground text-xs leading-relaxed">{{ p.desc }}</p>
          <button
            type="button"
            class="w-full flex items-center justify-between mt-3 py-2 border-t border-border"
            @click="expanded = expanded === p.id ? null : p.id"
          >
            <span class="text-foreground text-xs font-bold">{{ t('bonuses.howItWorks') }}</span>
            <ChevronDown
              :size="14"
              class="text-muted-foreground transition-transform duration-200"
              :class="expanded === p.id ? 'rotate-180' : ''"
            />
          </button>
          <div v-if="expanded === p.id" class="pb-2 space-y-2">
            <div v-for="(step, i) in p.steps" :key="i" class="flex items-start gap-2.5">
              <div
                class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[11px] text-black mt-0.5"
                :style="{ background: p.accentColor }"
              >
                {{ i + 1 }}
              </div>
              <span class="text-foreground/80 text-xs leading-relaxed">{{ step }}</span>
            </div>
          </div>
          <button
            type="button"
            class="w-full mt-3 py-3 rounded-xl text-white font-black text-sm transition-colors"
            :class="p.ctaColor"
            @click="p.id === 'firstdep' ? emit('openWallet') : undefined"
          >
            {{ p.cta }}
          </button>
        </div>
      </div>
    </div>

    <div class="mx-4 mt-4 mb-2 bg-secondary/50 rounded-xl px-4 py-3 border border-border">
      <p class="text-muted-foreground text-[11px] leading-relaxed text-center">{{ t('bonuses.disclaimer') }}</p>
    </div>
  </div>
</template>
