<script setup lang="ts">
import { ref, watch } from 'vue'
import { Trophy, ChevronDown } from 'lucide-vue-next'
import { BONUS_WINNERS, PROMOS, PROMO_STATS } from '@/data/promos'

const props = defineProps<{ promoFilter?: string | null }>()
const emit = defineEmits<{ openWallet: [] }>()

const expanded = ref<string | null>(props.promoFilter ?? null)

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
  <div class="page-scroll pb-20 hide-scrollbar">
    <div
      class="relative px-4 pt-3 pb-5 overflow-hidden"
      style="background: linear-gradient(160deg, #1a0060 0%, #080b14 60%)"
    >
      <p class="text-muted-foreground text-[11px] uppercase tracking-widest font-bold mb-1">TarsierWin Exclusive</p>
      <h1 class="text-white font-black leading-tight mb-1 font-display text-[1.8rem]">
        PROMOTIONS<br /><span class="text-primary">& BONUSES</span>
      </h1>
      <p class="text-white/50 text-xs max-w-[220px] leading-relaxed">
        Claim your rewards every step of the way — from your very first play to every referral.
      </p>
      <div class="flex gap-3 mt-4">
        <div
          v-for="s in PROMO_STATS"
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
        <span class="text-[10px] font-black uppercase whitespace-nowrap">Recent Claims</span>
      </div>
      <div class="w-px h-3 bg-border flex-shrink-0" />
      <div class="overflow-hidden flex-1">
        <div class="flex gap-5 animate-marquee whitespace-nowrap" style="animation-duration: 14s">
          <span v-for="(w, i) in [...BONUS_WINNERS, ...BONUS_WINNERS]" :key="i" class="text-[11px] flex-shrink-0">
            <span class="text-primary font-bold">{{ w.name }}</span>
            <span class="text-white/50"> claimed </span>
            <span class="text-emerald-400 font-bold">{{ w.amount }}</span>
            <span class="text-white/30"> · {{ w.promo }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="px-4 mt-4 space-y-3">
      <div
        v-for="p in PROMOS"
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
            ⭐ FEATURED
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
            <span class="text-foreground text-xs font-bold">How it works</span>
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
      <p class="text-muted-foreground text-[11px] leading-relaxed text-center">
        All bonuses are subject to TarsierWin Terms & Conditions. Wagering requirements apply. 18+
      </p>
    </div>
  </div>
</template>
