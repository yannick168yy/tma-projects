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
  FileText,
  Shield,
  Heart,
  Info,
  X,
} from 'lucide-vue-next'
import HomeCategoryShortcut from '@/components/home/HomeCategoryShortcut.vue'
import GameCard from '@/components/home/GameCard.vue'
import HistoryCard from '@/components/home/HistoryCard.vue'
import EGameCard from '@/components/home/EGameCard.vue'
import LiveCard from '@/components/home/LiveCard.vue'
import { CATEGORIES } from '@/data/categories'
import { BANNERS, WINNERS, INFO_LINKS, PROVIDER_LOGOS } from '@/data/home'
import { fetchHomepageGames, launchGame, fetchProviders, fetchBettingActivity, type SlotGame, type GameHistoryItem, type BetRecord, type BetTab } from '@/api/slots'
import { ApiError } from '@/api/client'

const INFO_ICONS: Record<string, unknown> = { terms: FileText, privacy: Shield, responsible: Heart, about: Info }

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
const homepageGames = ref<{ popular: SlotGame[]; slots: SlotGame[]; live: SlotGame[]; fishing: SlotGame[]; crash: SlotGame[]; table: SlotGame[] }>({
  popular: [], slots: [], live: [], fishing: [], crash: [], table: [],
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

// ── 首页各区段（服务器每 3 小时统一刷新，所有用户看到相同推荐）────────────
const popularGames = computed(() => homepageGames.value.popular)
const slotsGames   = computed(() => homepageGames.value.slots)
const liveGames    = computed(() => homepageGames.value.live)
const fishingGames = computed(() => homepageGames.value.fishing)
const crashGames   = computed(() => homepageGames.value.crash)
const tableGames   = computed(() => homepageGames.value.table)

// ── Providers ────────────────────────────────────────────────────────────────
const providerList = ref<string[]>([])

// ── Betting Table ─────────────────────────────────────────────────────────────
const activeBetTab = ref<BetTab>('latest')
const latestBets = ref<BetRecord[]>([])
const weekBets   = ref<BetRecord[]>([])
const monthBets  = ref<BetRecord[]>([])
const betLoaded  = ref<Record<BetTab, boolean>>({ latest: false, week: false, month: false })

function formatBet(amount: number): string {
  return '₱ ' + amount.toLocaleString()
}

async function loadBetTab(tab: BetTab) {
  if (betLoaded.value[tab]) return
  betLoaded.value[tab] = true
  try {
    const data = await fetchBettingActivity(tab)
    if (tab === 'latest') latestBets.value = data
    else if (tab === 'week') weekBets.value = data
    else monthBets.value = data
  } catch { /* 静默失败 */ }
}

async function switchBetTab(tab: BetTab) {
  activeBetTab.value = tab
  await loadBetTab(tab)
}

// Latest Bets 需要双份数据实现无缝循环
const latestBetsLoop = computed(() => [...latestBets.value, ...latestBets.value])

// Information 底部抽屉
const infoModal = ref<string | null>(null)
function openInfo(key: string) { infoModal.value = key }
function closeInfo() { infoModal.value = null }

function providerChip(name: string) {
  return PROVIDER_LOGOS[name.toUpperCase()] ?? { abbr: name.slice(0, 4), gradient: 'from-slate-600 to-slate-700' }
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

  // 并行加载 providers 和 latest bets
  fetchProviders()
    .then((list) => {
      // JILI 固定第一位
      const others = list.filter((p) => p.toUpperCase() !== 'JILI')
      providerList.value = ['JILI', ...others]
    })
    .catch(() => { providerList.value = ['JILI'] })

  loadBetTab('latest')
})

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

    <!-- ── PROVIDERS ─────────────────────────────────────────────────── -->
    <section class="mt-8 px-4">
      <h3 class="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">
        {{ t('home.providersSection') }}
      </h3>
      <div class="flex gap-2.5 overflow-x-auto hide-scrollbar pb-1">
        <div
          v-for="p in providerList"
          :key="p"
          class="flex-shrink-0 w-[88px] h-11 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-sm"
          :class="providerChip(p).gradient"
        >
          <span class="font-display font-black text-white text-sm tracking-wider drop-shadow">
            {{ providerChip(p).abbr }}
          </span>
        </div>
      </div>
    </section>

    <!-- ── BETTING TABLE ──────────────────────────────────────────────── -->
    <section class="mt-8 px-4">
      <h3 class="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">
        {{ t('home.bettingTable') }}
      </h3>

      <!-- 页签 -->
      <div class="flex gap-1 mb-3 bg-secondary rounded-xl p-1">
        <button
          v-for="tab in (['latest', 'week', 'month'] as BetTab[])"
          :key="tab"
          type="button"
          class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors"
          :class="activeBetTab === tab
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground'"
          @click="switchBetTab(tab)"
        >
          {{ tab === 'latest' ? t('home.latestBets') : tab === 'week' ? t('home.topWeek') : t('home.topMonth') }}
        </button>
      </div>

      <!-- Latest Bets: 竖向无缝滚动，高度与 Week/Month 一致 -->
      <div v-if="activeBetTab === 'latest'" class="relative overflow-hidden rounded-xl bg-secondary h-[520px]">
        <div v-if="latestBets.length === 0" class="space-y-px pt-1">
          <div v-for="n in 8" :key="n" class="flex items-center gap-3 px-3 py-2.5">
            <div class="w-10 h-10 rounded-lg animate-pulse bg-white/10 flex-shrink-0" />
            <div class="flex-1 space-y-1.5">
              <div class="h-3 w-28 rounded animate-pulse bg-white/10" />
              <div class="h-2 w-16 rounded animate-pulse bg-white/10" />
            </div>
            <div class="h-3 w-16 rounded animate-pulse bg-white/10" />
          </div>
        </div>
        <div v-else class="animate-scroll-up">
          <button
            v-for="(rec, i) in latestBetsLoop"
            :key="i"
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 active:bg-white/5 transition-colors text-left"
            @click="onGameTap(rec.uuid)"
          >
            <img
              v-if="rec.imageUrl"
              :src="rec.imageUrl"
              :alt="rec.name"
              class="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5"
            />
            <div v-else class="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-xs font-bold text-foreground truncate">{{ rec.name }}</p>
              <p class="text-[10px] text-muted-foreground">{{ rec.provider }}</p>
            </div>
            <span class="text-xs font-bold text-primary flex-shrink-0">{{ formatBet(rec.betAmount) }}</span>
          </button>
        </div>
      </div>

      <!-- Top of the Week / Month: 排行榜，高度与 Latest 一致 -->
      <div v-else class="rounded-xl bg-secondary overflow-y-auto h-[520px]">
        <div v-if="(activeBetTab === 'week' ? weekBets : monthBets).length === 0" class="space-y-px pt-1">
          <div v-for="n in 8" :key="n" class="flex items-center gap-3 px-3 py-2.5 border-b border-white/5">
            <div class="w-5 h-5 rounded animate-pulse bg-white/10 flex-shrink-0" />
            <div class="w-10 h-10 rounded-lg animate-pulse bg-white/10 flex-shrink-0" />
            <div class="flex-1 space-y-1.5">
              <div class="h-3 w-28 rounded animate-pulse bg-white/10" />
              <div class="h-2 w-16 rounded animate-pulse bg-white/10" />
            </div>
            <div class="h-3 w-16 rounded animate-pulse bg-white/10" />
          </div>
        </div>
        <button
          v-for="(rec, idx) in (activeBetTab === 'week' ? weekBets : monthBets)"
          :key="rec.uuid"
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/5 last:border-0 active:bg-white/5 transition-colors text-left"
          @click="onGameTap(rec.uuid)"
        >
          <span
            class="w-5 text-center text-xs font-black flex-shrink-0"
            :class="idx === 0 ? 'text-primary' : idx === 1 ? 'text-white/50' : idx === 2 ? 'text-amber-600' : 'text-muted-foreground'"
          >
            #{{ idx + 1 }}
          </span>
          <img
            v-if="rec.imageUrl"
            :src="rec.imageUrl"
            :alt="rec.name"
            class="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5"
          />
          <div v-else class="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-foreground truncate">{{ rec.name }}</p>
            <p class="text-[10px] text-muted-foreground">{{ rec.provider }}</p>
          </div>
          <span class="text-xs font-bold text-primary flex-shrink-0">{{ formatBet(rec.betAmount) }}</span>
        </button>
      </div>
    </section>

    <!-- ── INFORMATION ────────────────────────────────────────────────── -->
    <section class="mt-8 px-4">
      <h3 class="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">
        {{ t('home.infoSection') }}
      </h3>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="link in INFO_LINKS"
          :key="link.key"
          type="button"
          class="bg-secondary border border-border rounded-2xl p-4 text-left flex flex-col gap-3 active:scale-95 transition-transform"
          @click="openInfo(link.key)"
        >
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center"
            :class="{
              'bg-amber-500/15': link.key === 'terms',
              'bg-blue-500/15':  link.key === 'privacy',
              'bg-rose-500/15':  link.key === 'responsible',
              'bg-emerald-500/15': link.key === 'about',
            }"
          >
            <component
              :is="INFO_ICONS[link.key]"
              :size="16"
              :class="{
                'text-amber-400':   link.key === 'terms',
                'text-blue-400':    link.key === 'privacy',
                'text-rose-400':    link.key === 'responsible',
                'text-emerald-400': link.key === 'about',
              }"
            />
          </div>
          <div class="flex items-end justify-between gap-1 flex-1">
            <p class="text-xs font-bold text-foreground leading-snug">
              {{ t(`home.info${link.key.charAt(0).toUpperCase() + link.key.slice(1)}`) }}
            </p>
            <ChevronRight :size="14" class="text-muted-foreground flex-shrink-0" />
          </div>
        </button>
      </div>
    </section>

    <!-- Information 底部抽屉 -->
    <Teleport to="body">
      <Transition name="sheet-fade">
        <div v-if="infoModal" class="fixed inset-0 z-50 flex flex-col justify-end">
          <div class="absolute inset-0 bg-black/60" @click="closeInfo()" />
          <Transition name="sheet-slide">
            <div v-if="infoModal" class="relative bg-card rounded-t-2xl max-h-[82vh] flex flex-col">
              <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
                <h2 class="font-display font-black text-base text-foreground">
                  {{ t(`home.infoDetails.${infoModal}.title`) }}
                </h2>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
                  @click="closeInfo()"
                >
                  <X :size="15" class="text-muted-foreground" />
                </button>
              </div>
              <div class="overflow-y-auto px-5 py-4 text-sm text-foreground/75 leading-relaxed whitespace-pre-line">
                {{ t(`home.infoDetails.${infoModal}.content`) }}
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>

    <!-- ── SUPPORT ────────────────────────────────────────────────────── -->
    <section class="mt-8 px-4">
      <h3 class="text-muted-foreground font-black text-xs font-display tracking-widest mb-3">
        {{ t('home.supportSection') }}
      </h3>
      <button
        type="button"
        class="w-full bg-secondary rounded-xl p-4 flex items-center justify-between border border-border"
        @click="emit('openCs')"
      >
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Headphones :size="16" class="text-primary" />
          </div>
          <span class="text-sm font-bold text-foreground">{{ t('home.supportOnline') }}</span>
        </div>
        <ChevronRight :size="16" class="text-muted-foreground" />
      </button>
    </section>

    <!-- 版权 -->
    <div class="mt-6 mb-4 px-4 text-center">
      <p class="text-[10px] text-muted-foreground/50">© 2025 BetoGo · 18+</p>
    </div>
  </div>
</template>
