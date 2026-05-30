<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { usePromotionStore } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import {
  Search,
  ChevronRight,
  Trophy,
  TrendingUp,
  Clock,
  Gamepad2,
  Headphones,
  Fish,
  Zap,
  LayoutGrid,
  Sparkles,
  RefreshCw,
} from 'lucide-vue-next'
import HomeCategoryShortcut from '@/components/home/HomeCategoryShortcut.vue'
import GameCard from '@/components/home/GameCard.vue'
import HistoryCard from '@/components/home/HistoryCard.vue'
import EGameCard from '@/components/home/EGameCard.vue'
import LiveCard from '@/components/home/LiveCard.vue'
import { CATEGORIES } from '@/data/categories'
import { BANNERS, WINNERS } from '@/data/home'
import { fetchHomepageGames, launchGame, type SlotGame, type GameHistoryItem } from '@/api/slots'
import { ApiError } from '@/api/client'

const HISTORY_STORAGE_KEY = 'betogo_game_history'
const HISTORY_MAX = 10

function readLocalHistory(): GameHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as GameHistoryItem[]) : []
  } catch {
    return []
  }
}

function writeLocalHistory(game: SlotGame) {
  try {
    const existing = readLocalHistory().filter((g) => g.uuid !== game.uuid)
    const updated: GameHistoryItem[] = [
      {
        uuid: game.uuid,
        name: game.name,
        provider: game.provider,
        imageUrl: game.imageUrl,
        imageHqUrl: game.imageHqUrl,
        lastPlayedAt: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, HISTORY_MAX)
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated))
  } catch { /* silent */ }
}

type CategoryLobbyParams = {
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus'
  title: string
}

const emit = defineEmits<{
  openSearch: []
  openPromo: [promo: string | null]
  gameTap: []
  openSlotsLobby: []
  openCategoryLobby: [params: CategoryLobbyParams]
  openCs: []
  openGame: [url: string]
}>()

const { t } = useI18n()
const promotion = usePromotionStore()
const auth = useAuthStore()
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

// ── Banner ──────────────────────────────────────────────────────────────────
const activeBanner = ref(0)
const bannerTrackRef = ref<HTMLElement | null>(null)
const bannerDrag = ref({
  startX: 0, startY: 0, startScroll: 0,
  axis: null as 'x' | 'y' | null, lastX: 0, lastT: 0,
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
    startX: t.clientX, startY: t.clientY,
    startScroll: bannerTrackRef.value?.scrollLeft ?? 0,
    axis: null, lastX: t.clientX, lastT: Date.now(),
  }
}

function onBannerTouchMove(e: TouchEvent) {
  const el = bannerTrackRef.value
  const t = e.touches[0]
  if (!el || !t) return
  const dx = t.clientX - bannerDrag.value.startX
  const dy = t.clientY - bannerDrag.value.startY
  if (bannerDrag.value.axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    bannerDrag.value.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  }
  if (bannerDrag.value.axis !== 'x') return
  e.preventDefault()
  el.scrollLeft = bannerDrag.value.startScroll - dx
  bannerDrag.value.lastX = t.clientX
  bannerDrag.value.lastT = Date.now()
}

function onBannerTouchEnd() {
  if (bannerDrag.value.axis === 'x') {
    const el = bannerTrackRef.value
    if (el && el.clientWidth > 0) {
      const dx = bannerDrag.value.startX - bannerDrag.value.lastX
      const dt = Math.max(1, Date.now() - bannerDrag.value.lastT)
      const velocity = dx / dt
      const threshold = el.clientWidth * 0.18
      const cur = activeBanner.value
      if (dx > threshold || velocity > 0.35) {
        const next = Math.min(BANNERS.length - 1, cur + 1)
        el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
        activeBanner.value = next
      } else if (dx < -threshold || velocity < -0.35) {
        const prev = Math.max(0, cur - 1)
        el.scrollTo({ left: prev * el.clientWidth, behavior: 'smooth' })
        activeBanner.value = prev
      } else {
        snapBannerToNearest()
      }
    }
  }
  bannerDrag.value.axis = null
}

watch(bannerTrackRef, (el) => {
  if (!el) return
  const ro = new ResizeObserver(() => onBannerScroll())
  ro.observe(el)
})

// ── Game data ────────────────────────────────────────────────────────────────
const launchingUuid = ref<string | null>(null)
const homepageGames = ref<{ popular: SlotGame[]; slots: SlotGame[]; live: SlotGame[]; fishing: SlotGame[]; crash: SlotGame[]; table: SlotGame[]; recommended: SlotGame[] }>({
  popular: [], slots: [], live: [], fishing: [], crash: [], table: [], recommended: [],
})
const historyGames = ref<GameHistoryItem[]>([])
const gamesLoading = ref(true)

const gameMap = computed(() => {
  const m = new Map<string, SlotGame>()
  const { popular, slots, live, fishing, crash, table } = homepageGames.value
  for (const g of [...popular, ...slots, ...live, ...fishing, ...crash, ...table]) {
    if (!m.has(g.uuid)) m.set(g.uuid, g)
  }
  return m
})

async function onGameTap(uuid: string) {
  if (!(await auth.ensureLoggedIn(t('auth.signInPlay')))) return
  if (launchingUuid.value) return
  launchingUuid.value = uuid
  try {
    const { url } = await launchGame(uuid)
    const game = gameMap.value.get(uuid)
    if (game) {
      writeLocalHistory(game)
      historyGames.value = readLocalHistory()
    }
    emit('openGame', url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Launch failed')
  } finally {
    launchingUuid.value = null
  }
}

onMounted(async () => {
  historyGames.value = readLocalHistory()
  gamesLoading.value = true
  try {
    const result = await fetchHomepageGames()
    homepageGames.value = result
  } catch {
    // 静默失败，各区段保持空数组
  }
  gamesLoading.value = false
})

// ── 首页各区段（服务器每 3 小时统一刷新，所有用户看到相同推荐）────────────
const popularGames = computed(() => homepageGames.value.popular)
const slotsGames   = computed(() => homepageGames.value.slots)
const liveGames    = computed(() => homepageGames.value.live)
const fishingGames = computed(() => homepageGames.value.fishing)
const crashGames   = computed(() => homepageGames.value.crash)
const tableGames   = computed(() => homepageGames.value.table)

// ── 猜你喜欢：服务端返回 36 款，前端本地分页每次展示 12 款 ─────────────────
const recPage = ref(0)
const recommendedPool = computed(() => homepageGames.value.recommended)
const recommendedGames = computed(() => {
  const start = recPage.value * 12
  return recommendedPool.value.slice(start, start + 12)
})
function shuffleRec() {
  const total = Math.ceil(recommendedPool.value.length / 12)
  recPage.value = total > 1 ? (recPage.value + 1) % total : 0
}
</script>

<template>
  <div class="page-main">
    <!-- 分类快捷入口 -->
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

    <!-- Banner 轮播 -->
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

    <!-- 搜索按钮 -->
    <div class="flex items-center px-4 mt-4">
      <button
        type="button"
        class="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-xl bg-secondary text-muted-foreground"
        @click="emit('openSearch')"
      >
        <Search :size="14" />
        <span class="text-xs">{{ t('search.placeholder') }}</span>
      </button>
    </div>

    <!-- GAME HISTORY -->
    <section class="mt-5">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Clock :size="15" class="text-muted-foreground" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.gameHistory') }}</h3>
        </div>
      </div>
      <div v-if="historyGames.length > 0" class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <HistoryCard
          v-for="g in historyGames"
          :key="g.uuid"
          :game="g"
          @tap="onGameTap(g.uuid)"
        />
      </div>
      <div v-else class="px-4">
        <p class="text-muted-foreground text-xs">{{ t('home.noHistory') }}</p>
      </div>
    </section>

    <!-- Recent Wins 跑马灯 -->
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

    <!-- POPULAR GAMES (by ph_bonus) -->
    <section class="mt-5 px-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <TrendingUp :size="15" class="text-primary" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.popularGames') }}</h3>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortBy: 'ph_bonus', title: t('home.popularGames') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="grid grid-cols-3 gap-2">
        <div v-for="n in 6" :key="n" class="aspect-[3/4] animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else-if="popularGames.length > 0" class="grid grid-cols-3 gap-2">
        <GameCard v-for="g in popularGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- E-GAMES ZONE (slots) -->
    <section v-if="gamesLoading || slotsGames.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Gamepad2 :size="15" class="text-violet-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.egamesZone') }}</h3>
          <span class="bg-violet-500/20 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full">{{ t('common.featured') }}</span>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortCategory: 'slots', sortBy: 'weight', title: t('home.egamesZone') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="flex gap-3 px-4">
        <div v-for="n in 6" :key="n" class="flex-shrink-0 w-32 h-20 animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <EGameCard v-for="g in slotsGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- LIVE GAMES -->
    <section v-if="gamesLoading || liveGames.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.liveGames') }}</h3>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortCategory: 'live', sortBy: 'weight', title: t('home.liveGames') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="flex gap-3 px-4">
        <div v-for="n in 6" :key="n" class="flex-shrink-0 w-36 h-20 animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <LiveCard v-for="g in liveGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- FISHING GAMES -->
    <section v-if="gamesLoading || fishingGames.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Fish :size="15" class="text-cyan-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.fishingZone') }}</h3>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortCategory: 'fishing', sortBy: 'weight', title: t('home.fishingZone') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="flex gap-3 px-4">
        <div v-for="n in 6" :key="n" class="flex-shrink-0 w-32 h-20 animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <EGameCard v-for="g in fishingGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- CRASH GAMES -->
    <section v-if="gamesLoading || crashGames.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Zap :size="15" class="text-orange-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.crashZone') }}</h3>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortCategory: 'crash', sortBy: 'weight', title: t('home.crashZone') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="flex gap-3 px-4">
        <div v-for="n in 6" :key="n" class="flex-shrink-0 w-32 h-20 animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <EGameCard v-for="g in crashGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- TABLE GAMES -->
    <section v-if="gamesLoading || tableGames.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <LayoutGrid :size="15" class="text-blue-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.tableZone') }}</h3>
        </div>
        <button
          type="button"
          class="text-primary text-xs font-bold flex items-center gap-0.5"
          @click="emit('openCategoryLobby', { sortCategory: 'table', sortBy: 'weight', title: t('home.tableZone') })"
        >
          {{ t('common.seeAll') }}
          <ChevronRight :size="12" />
        </button>
      </div>
      <div v-if="gamesLoading" class="flex gap-3 px-4">
        <div v-for="n in 6" :key="n" class="flex-shrink-0 w-32 h-20 animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="flex gap-3 px-4 overflow-x-auto hide-scrollbar">
        <EGameCard v-for="g in tableGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- FOR YOU 推荐 -->
    <section v-if="gamesLoading || recommendedPool.length > 0" class="mt-6">
      <div class="flex items-center justify-between px-4 mb-3">
        <div class="flex items-center gap-2">
          <Sparkles :size="15" class="text-yellow-400" />
          <h3 class="text-foreground font-black text-sm font-display">{{ t('home.forYou') }}</h3>
        </div>
        <button
          type="button"
          class="flex items-center gap-1 text-primary text-xs font-bold"
          @click="shuffleRec"
        >
          <RefreshCw :size="11" />
          {{ t('home.shuffle') }}
        </button>
      </div>
      <div v-if="gamesLoading" class="grid grid-cols-3 gap-2 px-4">
        <div v-for="n in 12" :key="n" class="aspect-[3/4] animate-pulse rounded-xl bg-secondary" />
      </div>
      <div v-else class="grid grid-cols-3 gap-2 px-4">
        <GameCard v-for="g in recommendedGames" :key="g.uuid" :game="g" @tap="onGameTap(g.uuid)" />
      </div>
    </section>

    <!-- 客服入口 -->
    <div
      class="mx-4 mt-6 mb-4 bg-gradient-to-r from-secondary to-[#1a2540] rounded-2xl p-4 flex items-center justify-between border border-border"
    >
      <div>
        <p class="text-foreground font-bold text-sm">{{ t('home.supportTitle') }}</p>
        <p class="text-muted-foreground text-xs mt-0.5">{{ t('home.supportSub') }}</p>
      </div>
      <button
        type="button"
        class="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow shadow-amber-500/20"
        @click="emit('openCs')"
      >
        <Headphones :size="18" class="text-primary-foreground" />
      </button>
    </div>
  </div>
</template>
