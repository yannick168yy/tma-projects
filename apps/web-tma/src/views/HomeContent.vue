<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { usePromotionStore } from '@/stores/promotion'
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
import HomeCategoryShortcut from '@/components/home/HomeCategoryShortcut.vue'
import SlotsSection from '@/components/home/SlotsSection.vue'
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
  gameTap: []
  openSlotsLobby: []
}>()

const { t } = useI18n()
const promotion = usePromotionStore()
const { highlightMap } = storeToRefs(promotion)

const localizedBanners = computed(() =>
  BANNERS.map((b) => ({
    ...b,
    tag: t(`home.banners.${b.id}.tag`),
    title: t(`home.banners.${b.id}.title`),
    sub: t(`home.banners.${b.id}.sub`),
  })),
)

function categoryBadge(promo: string | null, fallback: string | null) {
  if (!promo) return fallback
  const h = highlightMap.value.get(promo as 'trial' | 'referral' | 'firstdep')
  if (h?.highlight && h.flagLabel) return h.flagLabel
  return fallback
}

function categoryClaimable(promo: string | null) {
  if (!promo) return false
  const h = highlightMap.value.get(promo as 'trial' | 'referral' | 'firstdep')
  return Boolean(h?.highlight)
}

const activeBanner = ref(0)
const activeTab = ref<GameTabId>('all')
const bannerTrackRef = ref<HTMLElement | null>(null)
const bannerDrag = ref({
  startX: 0,
  startY: 0,
  startScroll: 0,
  axis: null as 'x' | 'y' | null,
})
const marqueeWinners = computed(() => [...WINNERS, ...WINNERS])

function onBannerScroll() {
  const el = bannerTrackRef.value
  if (!el || el.clientWidth <= 0) return
  const idx = Math.round(el.scrollLeft / el.clientWidth)
  activeBanner.value = Math.max(0, Math.min(BANNERS.length - 1, idx))
}

function scrollToBanner(index: number) {
  const el = bannerTrackRef.value
  if (!el) return
  el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
  activeBanner.value = index
}

function snapBannerToNearest() {
  const el = bannerTrackRef.value
  if (!el || el.clientWidth <= 0) return
  const idx = Math.round(el.scrollLeft / el.clientWidth)
  const clamped = Math.max(0, Math.min(BANNERS.length - 1, idx))
  el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' })
  activeBanner.value = clamped
}

function onBannerTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  bannerDrag.value = {
    startX: t.clientX,
    startY: t.clientY,
    startScroll: bannerTrackRef.value?.scrollLeft ?? 0,
    axis: null,
  }
}

function onBannerTouchMove(e: TouchEvent) {
  const el = bannerTrackRef.value
  const t = e.touches[0]
  if (!el || !t) return

  const dx = t.clientX - bannerDrag.value.startX
  const dy = t.clientY - bannerDrag.value.startY
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)

  if (bannerDrag.value.axis === null && (adx > 8 || ady > 8)) {
    bannerDrag.value.axis = adx >= ady ? 'x' : 'y'
  }

  if (bannerDrag.value.axis !== 'x') return

  e.preventDefault()
  el.scrollLeft = bannerDrag.value.startScroll - dx
}

function onBannerTouchEnd() {
  if (bannerDrag.value.axis === 'x') {
    snapBannerToNearest()
  }
  bannerDrag.value.axis = null
}

watch(bannerTrackRef, (el) => {
  if (!el) return
  const ro = new ResizeObserver(() => onBannerScroll())
  ro.observe(el)
})

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
  <div class="page-scroll pb-20 hide-scrollbar">
    <div class="category-shortcut-row flex gap-3 px-4 pb-3 pt-3 overflow-x-auto hide-scrollbar">
      <HomeCategoryShortcut
        v-for="c in CATEGORIES"
        :key="c.id"
        :category="c"
        :claimable="categoryClaimable(c.promo)"
        :claim-label="categoryBadge(c.promo, c.badge)"
        @click="emit('openPromo', c.promo)"
      />
    </div>

    <div class="px-4">
      <div class="relative h-56 overflow-hidden rounded-2xl">
        <div
          ref="bannerTrackRef"
          class="banner-carousel flex h-full snap-x snap-mandatory hide-scrollbar"
          @scroll.passive="onBannerScroll"
          @touchstart="onBannerTouchStart"
          @touchmove="onBannerTouchMove"
          @touchend="onBannerTouchEnd"
          @touchcancel="onBannerTouchEnd"
        >
          <article
            v-for="banner in localizedBanners"
            :key="banner.id"
            class="relative h-56 w-full flex-shrink-0 snap-center"
          >
            <div class="absolute inset-0 bg-gradient-to-br" :class="banner.gradient" />
            <div class="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/5" />
            <div class="absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/5" />
            <div class="absolute inset-0 flex flex-col justify-between p-4">
              <div class="flex items-start justify-between">
                <span class="rounded-full px-2 py-0.5 text-xs font-bold" :class="banner.badgeColor">
                  {{ banner.tag }}
                </span>
                <span class="text-3xl">{{ banner.badge }}</span>
              </div>
              <div>
                <h2 class="mb-1 whitespace-pre-line font-display text-[1.55rem] font-black leading-tight text-white">
                  {{ banner.title }}
                </h2>
                <p class="text-xs text-white/70">{{ banner.sub }}</p>
              </div>
            </div>
          </article>
        </div>
        <div class="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          <button
            v-for="(_, i) in BANNERS"
            :key="i"
            type="button"
            class="pointer-events-auto h-1.5 rounded-full transition-all"
            :class="i === activeBanner ? 'w-5 bg-white' : 'w-1.5 bg-white/40'"
            @click="scrollToBanner(i)"
          />
        </div>
      </div>
    </div>

    <!-- Slotegrator games section (auto-hides if SG not configured) -->
    <SlotsSection @open-lobby="emit('openSlotsLobby')" @game-tap="emit('gameTap')" />

    <div class="flex items-center gap-2 px-4 mt-4 overflow-x-auto hide-scrollbar">
      <button
        type="button"
        class="flex-shrink-0 w-9 h-9 rounded-xl bg-secondary flex items-center justify-center"
        @click="emit('openSearch')"
      >
        <Search :size="15" class="text-muted-foreground" />
      </button>
      <button
        v-for="tab in GAME_TABS"
        :key="tab.id"
        type="button"
        class="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors"
        :class="
          activeTab === tab.id
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = tab.id"
      >
        <component :is="tabIcon(tab.id)" v-if="tabIcon(tab.id)" :size="13" />
        <span v-else class="text-sm leading-none">🐓</span>
        <span>{{ t(`home.gameTabs.${tab.id}`) }}</span>
      </button>
    </div>

    <section class="mt-5">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Clock :size="15" class="text-muted-foreground" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.gameHistory') }}</h3>
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
        <HistoryCard v-for="g in HISTORY_GAMES" :key="g.id" :game="g" @tap="emit('gameTap')" />
      </div>
    </section>

    <div class="mx-4 mt-4 bg-secondary rounded-xl p-3 flex items-center gap-2 overflow-hidden">
      <div class="flex-shrink-0 flex items-center gap-1.5 text-primary">
        <Trophy :size="13" />
        <span class="text-xs font-bold uppercase tracking-wide whitespace-nowrap">{{ t('home.recentWins') }}</span>
      </div>
      <div class="w-px h-4 bg-border flex-shrink-0" />
      <div class="overflow-hidden flex-1">
        <div class="flex gap-6 animate-marquee whitespace-nowrap">
          <span v-for="(w, i) in marqueeWinners" :key="i" class="text-xs text-foreground/80 flex-shrink-0">
            <span class="text-primary font-bold">{{ w.name }}</span>
            {{ t('common.won') }}
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
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.popularGames') }}</h3>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="bg-secondary/60 text-xs font-bold text-muted-foreground px-3 py-1 rounded-full">
            {{ t('common.all') }}
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
        <GameCard v-for="g in POPULAR_GAMES" :key="g.id" :game="g" @tap="emit('gameTap')" />
      </div>
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Gamepad2 :size="15" class="text-violet-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.egamesZone') }}</h3>
          <span class="bg-violet-500/20 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full">{{ t('common.featured') }}</span>
        </div>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          {{ t('common.seeAll') }}
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
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.liveGames') }}</h3>
        </div>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <LiveCard v-for="g in LIVE_GAMES" :key="g.id" :game="g" />
      </div>
    </section>

    <section class="mt-6 px-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-foreground font-black text-sm font-display">{{ t('home.gameProviders') }}</h3>
        <button type="button" class="text-primary text-xs font-bold flex items-center gap-0.5">
          {{ t('common.all') }}
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
        <p class="text-foreground font-bold text-sm">{{ t('home.supportTitle') }}</p>
        <p class="text-muted-foreground text-xs mt-0.5">{{ t('home.supportSub') }}</p>
      </div>
      <button type="button" class="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow shadow-amber-500/20">
        <Headphones :size="18" class="text-primary-foreground" />
      </button>
    </div>
  </div>
</template>
