<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Zap,
  Trophy,
  TrendingUp,
  Clock,
  BarChart3,
  Gamepad2,
  Spade,
  Headphones,
} from 'lucide-vue-next'
import GameCard from '@/components/home/GameCard.vue'
import HistoryCard from '@/components/home/HistoryCard.vue'
import EGameCard from '@/components/home/EGameCard.vue'
import LiveCard from '@/components/home/LiveCard.vue'
import { CATEGORIES } from '@/data/categories'
import {
  BANNERS,
  GAME_TABS,
  HISTORY_GAMES,
  POPULAR_GAMES,
  EGAMES,
  LIVE_GAMES,
  WINNERS,
  PROVIDERS,
  type GameTabId,
} from '@/data/home'

const emit = defineEmits<{
  openSearch: []
  openPromo: [promo: string | null]
}>()

const activeBanner = ref(0)
const activeTab = ref<GameTabId>('all')
const currentBanner = computed(() => BANNERS[activeBanner.value]!)
const marqueeWinners = computed(() => [...WINNERS, ...WINNERS])

function tabIcon(id: GameTabId) {
  switch (id) {
    case 'all':
      return Spade
    case 'slots':
      return Zap
    case 'egames':
      return Gamepad2
    case 'sports':
      return BarChart3
    default:
      return null
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto overflow-x-hidden pb-20 hide-scrollbar">
    <div class="flex gap-3 px-4 pb-3 overflow-x-auto hide-scrollbar">
      <button
        v-for="c in CATEGORIES"
        :key="c.label"
        type="button"
        class="flex-shrink-0 flex flex-col items-center gap-1.5 pt-2.5"
        @click="emit('openPromo', c.promo)"
      >
        <div
          class="relative rounded-2xl bg-gradient-to-br flex flex-col items-center justify-end w-[110px] h-[59px]"
          :class="c.color"
          style="box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45)"
        >
          <div class="flex-1 flex items-center justify-center w-full">
            <span class="text-[36px] leading-none">{{ c.icon }}</span>
          </div>
          <div
            v-if="c.badge"
            class="absolute flex items-center gap-0.5 bg-red-500 text-white font-black z-10 whitespace-nowrap"
            style="top: -11px; left: 8px; font-size: 11px; padding: 4px 7px 4px 5px; border-radius: 6px 6px 6px 0; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5)"
          >
            🔥 {{ c.badge }}
            <span
              class="absolute"
              style="bottom: -6px; left: 0; width: 0; height: 0; border-left: 6px solid #ef4444; border-bottom: 6px solid transparent"
            />
          </div>
        </div>
        <span class="text-[12px] text-white/80 font-bold">{{ c.label }}</span>
      </button>
    </div>

    <div class="px-4">
      <div class="relative rounded-2xl overflow-hidden h-56 select-none">
        <div class="absolute inset-0 bg-gradient-to-br" :class="currentBanner.gradient" />
        <div class="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5" />
        <div class="absolute -bottom-6 -left-6 w-20 h-20 rounded-full bg-white/5" />
        <div class="absolute inset-0 p-4 flex flex-col justify-between">
          <div class="flex items-start justify-between">
            <span class="text-xs font-bold px-2 py-0.5 rounded-full" :class="currentBanner.badgeColor">
              {{ currentBanner.tag }}
            </span>
            <span class="text-3xl">{{ currentBanner.badge }}</span>
          </div>
          <div>
            <h2 class="text-white font-black leading-tight mb-1 whitespace-pre-line font-display text-[1.55rem]">
              {{ currentBanner.title }}
            </h2>
            <p class="text-white/70 text-xs">{{ currentBanner.sub }}</p>
          </div>
        </div>
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          <button
            v-for="(_, i) in BANNERS"
            :key="i"
            type="button"
            class="h-1.5 rounded-full transition-all"
            :class="i === activeBanner ? 'w-5 bg-white' : 'w-1.5 bg-white/40'"
            @click="activeBanner = i"
          />
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 px-4 mt-4 overflow-x-auto hide-scrollbar">
      <button
        type="button"
        class="flex-shrink-0 w-9 h-9 rounded-xl bg-secondary flex items-center justify-center"
        @click="emit('openSearch')"
      >
        <Search :size="15" class="text-muted-foreground" />
      </button>
      <button
        v-for="t in GAME_TABS"
        :key="t.id"
        type="button"
        class="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors"
        :class="
          activeTab === t.id
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = t.id"
      >
        <component :is="tabIcon(t.id)" v-if="tabIcon(t.id)" :size="13" />
        <span v-else class="text-sm leading-none">🐓</span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <section class="mt-5">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Clock :size="15" class="text-muted-foreground" />
          <h3 class="text-foreground font-black text-sm font-display">GAME HISTORY</h3>
        </div>
        <div class="flex gap-1">
          <button type="button" class="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
            <ChevronLeft :size="13" class="text-muted-foreground" />
          </button>
          <button type="button" class="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
            <ChevronRight :size="13" class="text-muted-foreground" />
          </button>
        </div>
      </div>
      <div class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <HistoryCard v-for="g in HISTORY_GAMES" :key="g.id" :game="g" />
      </div>
    </section>

    <div class="mx-4 mt-4 bg-secondary rounded-xl p-3 flex items-center gap-2 overflow-hidden">
      <div class="flex-shrink-0 flex items-center gap-1.5 text-primary">
        <Trophy :size="13" />
        <span class="text-xs font-bold uppercase tracking-wide whitespace-nowrap">Recent Wins</span>
      </div>
      <div class="w-px h-4 bg-border flex-shrink-0" />
      <div class="overflow-hidden flex-1">
        <div class="flex gap-6 animate-marquee whitespace-nowrap">
          <span v-for="(w, i) in marqueeWinners" :key="i" class="text-xs text-foreground/80 flex-shrink-0">
            <span class="text-primary font-bold">{{ w.name }}</span>
            won
            <span class="text-emerald-400 font-bold">{{ w.amount }}</span>
            ·
            <span class="text-muted-foreground">{{ w.game }}</span>
          </span>
        </div>
      </div>
    </div>

    <section class="mt-5 px-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <TrendingUp :size="15" class="text-primary" />
          <h3 class="text-foreground font-black text-sm font-display">POPULAR GAMES</h3>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="bg-secondary/60 text-xs font-bold text-muted-foreground px-3 py-1 rounded-full">
            All
          </button>
          <button type="button" class="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
            <ChevronLeft :size="13" class="text-muted-foreground" />
          </button>
          <button type="button" class="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
            <ChevronRight :size="13" class="text-muted-foreground" />
          </button>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <GameCard v-for="g in POPULAR_GAMES" :key="g.id" :game="g" />
      </div>
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Gamepad2 :size="15" class="text-violet-400" />
          <h3 class="text-foreground font-black text-sm font-display">E-GAMES ZONE</h3>
          <span class="bg-violet-500/20 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full">FEATURED</span>
        </div>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          See all
          <ChevronRight :size="12" />
        </button>
      </div>
      <div class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <EGameCard v-for="g in EGAMES" :key="g.id" :game="g" />
      </div>
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <h3 class="text-foreground font-black text-sm font-display">LIVE GAMES</h3>
        </div>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          See all
          <ChevronRight :size="12" />
        </button>
      </div>
      <div class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <LiveCard v-for="g in LIVE_GAMES" :key="g.id" :game="g" />
      </div>
    </section>

    <section class="mt-6 px-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-foreground font-black text-sm font-display">GAME PROVIDERS</h3>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          All
          <ChevronRight :size="12" />
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="p in PROVIDERS"
          :key="p.name"
          type="button"
          class="rounded-xl bg-secondary border border-border hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-1 py-3"
        >
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center" :class="p.color">
            <span class="text-white font-black text-[10px]">{{ p.abbr }}</span>
          </div>
          <span class="text-muted-foreground text-[10px] font-bold">{{ p.name }}</span>
        </button>
      </div>
    </section>

    <div
      class="mx-4 mt-6 mb-4 bg-gradient-to-r from-secondary to-[#1a2540] rounded-2xl p-4 flex items-center justify-between border border-border"
    >
      <div>
        <p class="text-foreground font-bold text-sm">24/7 Customer Support</p>
        <p class="text-muted-foreground text-xs mt-0.5">Always here for you · Laging handa</p>
      </div>
      <button type="button" class="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow shadow-amber-500/20">
        <Headphones :size="18" class="text-primary-foreground" />
      </button>
    </div>
  </div>
</template>
