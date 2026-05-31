<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Trophy, RefreshCw } from 'lucide-vue-next'
import PeryaCarnivalHero from '@/components/bingo/PeryaCarnivalHero.vue'
import SlotGameCard from '@/components/home/SlotGameCard.vue'
import { fetchGames, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { PERYA_WINNERS } from '@/data/bingo'

const emit = defineEmits<{
  openWallet: []
  gameTap: []
  openGame: [url: string]
}>()

const { t } = useI18n()
const auth = useAuthStore()
const { isLoggedIn } = storeToRefs(auth)

type TabId = 'all' | 'jili' | 'jackpot' | 'classic'
const tabs: { id: TabId; label: string }[] = [
  { id: 'all',     label: 'ALL' },
  { id: 'jili',    label: 'JILI' },
  { id: 'jackpot', label: 'JACKPOT' },
  { id: 'classic', label: 'CLASSIC' },
]

const activeTab  = ref<TabId>('all')
const games      = ref<SlotGame[]>([])
const total      = ref(0)
const curPage    = ref(1)
const pages      = ref(1)
const loading    = ref(false)
const loadingMore = ref(false)
const launchingUuid = ref<string | null>(null)
const error      = ref('')

const marqueeWinners = computed(() => [...PERYA_WINNERS, ...PERYA_WINNERS])
const hasMore = computed(() => curPage.value < pages.value)

function tabParams(tab: TabId) {
  switch (tab) {
    case 'jili':    return { provider: 'JiliGames' }
    case 'jackpot': return { search: 'jackpot' }
    case 'classic': return { provider: 'Rich88' }
    default:        return {}
  }
}

async function loadGames(reset = true) {
  if (reset) {
    loading.value = true
    curPage.value = 1
    games.value = []
  } else {
    loadingMore.value = true
  }
  error.value = ''

  try {
    const extra = tabParams(activeTab.value)
    const res = await fetchGames({
      page: curPage.value,
      limit: 30,
      sortCategory: 'bingo',
      sortBy: 'ph_bonus',
      ...extra,
    })
    if (reset) {
      games.value = res.items
    } else {
      games.value.push(...res.items)
    }
    total.value = res.total
    pages.value = res.pages
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to load games'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function selectTab(id: TabId) {
  activeTab.value = id
  loadGames(true)
}

function loadMore() {
  if (loadingMore.value || curPage.value >= pages.value) return
  curPage.value++
  loadGames(false)
}

async function onPlay(uuid: string) {
  if (!isLoggedIn.value) {
    emit('gameTap')
    return
  }
  launchingUuid.value = uuid
  try {
    const { url } = await launchGame(uuid)
    emit('openGame', url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Failed to launch game')
  } finally {
    launchingUuid.value = null
  }
}

async function onDemo(uuid: string) {
  launchingUuid.value = uuid
  try {
    const { url } = await launchDemo(uuid)
    emit('openGame', url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Failed to launch demo')
  } finally {
    launchingUuid.value = null
  }
}

onMounted(() => loadGames())
</script>

<template>
  <div class="page-main">
    <!-- Hero -->
    <PeryaCarnivalHero>
      <p class="text-amber-300 text-[10px] font-black uppercase tracking-widest mb-1">🎪 {{ t('bingo.carnival') }}</p>
      <h1
        class="font-black leading-none mb-1 font-display text-[2.6rem]"
        style="text-shadow: 0 2px 20px rgba(168, 85, 247, 0.6)"
      >
        <span class="text-white">{{ t('bingo.titlePerya') }}</span>
        <span class="text-primary">{{ t('bingo.titleAnd') }}</span>
        <span style="color: #ec4899">{{ t('bingo.titleBingo') }}</span>
      </h1>
      <p class="text-white/40 text-xs leading-relaxed">{{ t('bingo.heroSub') }}</p>

      <div
        class="flex items-center gap-2 mt-4 bg-black/35 rounded-xl px-3 py-2 overflow-hidden"
        style="border: 1px solid rgba(255, 184, 0, 0.14)"
      >
        <div class="flex items-center gap-1 flex-shrink-0">
          <Trophy :size="11" class="text-primary" />
          <span class="text-primary text-[10px] font-black uppercase tracking-wide">{{ t('bingo.winners') }}</span>
        </div>
        <div class="w-px h-3 bg-white/10 flex-shrink-0" />
        <div class="overflow-hidden flex-1">
          <div class="flex gap-5 animate-marquee whitespace-nowrap" style="animation-duration: 16s">
            <span v-for="(w, i) in marqueeWinners" :key="i" class="text-[11px] flex-shrink-0">
              <span class="text-primary font-bold">{{ w.name }}</span>
              <span class="text-white/40"> {{ t('common.won') }} </span>
              <span class="text-emerald-400 font-bold">{{ w.amount }}</span>
              <span class="text-white/25"> · {{ w.game }}</span>
            </span>
          </div>
        </div>
      </div>
    </PeryaCarnivalHero>

    <!-- Jackpot banner -->
    <div
      class="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3"
      style="background: linear-gradient(90deg, #2d1800, #1a0d40); border: 1px solid rgba(255, 184, 0, 0.25); box-shadow: 0 4px 20px rgba(255, 184, 0, 0.12)"
    >
      <span class="text-2xl">🏆</span>
      <div class="flex-1">
        <p class="text-primary text-[10px] font-black uppercase tracking-widest leading-none">Today's Jackpot</p>
        <p class="text-white font-black text-xl leading-tight font-display">₱ 1,200,000</p>
      </div>
      <button
        type="button"
        class="bg-primary text-primary-foreground font-black text-xs px-4 py-2 rounded-xl shadow shadow-amber-500/25 flex-shrink-0"
        @click="emit('openWallet')"
      >
        JOIN NOW
      </button>
    </div>

    <!-- Tab bar -->
    <div class="flex gap-2 px-4 mt-5 overflow-x-auto no-scrollbar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-black transition-colors"
        :class="activeTab === tab.id
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-muted-foreground'"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Games section -->
    <div class="px-4 mt-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-white font-black text-base font-display">
          🎱 BINGO GAMES
          <span v-if="total > 0" class="text-xs font-normal text-muted-foreground ml-1.5">{{ total }} games</span>
        </h2>
      </div>

      <!-- Skeleton -->
      <div v-if="loading" class="grid grid-cols-2 gap-2">
        <div v-for="n in 12" :key="n" class="h-40 animate-pulse rounded-xl bg-secondary" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex flex-col items-center gap-3 py-12 text-center">
        <p class="text-sm text-muted-foreground">{{ error }}</p>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-xs font-bold text-foreground"
          @click="loadGames()"
        >
          <RefreshCw :size="12" />
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div v-else-if="games.length === 0" class="py-12 text-center text-sm text-muted-foreground">
        No games found
      </div>

      <!-- Grid -->
      <template v-else>
        <div class="grid grid-cols-2 gap-2">
          <SlotGameCard
            v-for="game in games"
            :key="game.uuid"
            :game="game"
            :launching="launchingUuid === game.uuid"
            @play="onPlay"
            @demo="onDemo"
          />
        </div>

        <div v-if="hasMore" class="mt-4 flex justify-center">
          <button
            type="button"
            class="rounded-full bg-secondary px-6 py-2.5 text-sm font-bold text-foreground transition-opacity"
            :class="{ 'opacity-50': loadingMore }"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? '…' : t('common.loadMore') }}
          </button>
        </div>
      </template>
    </div>

    <!-- Fiesta Special banner -->
    <div
      class="mx-4 mt-1 mb-4 rounded-2xl overflow-hidden relative"
      style="background: linear-gradient(135deg, #1a004a, #3b0020); border: 1px solid rgba(236, 72, 153, 0.2)"
    >
      <div
        class="absolute inset-0 pointer-events-none"
        style="background: radial-gradient(ellipse at 80% 50%, rgba(236, 72, 153, 0.12) 0%, transparent 65%)"
      />
      <div class="relative px-4 py-4 flex items-center gap-3">
        <div class="text-4xl">🎉</div>
        <div class="flex-1">
          <p class="text-pink-300 text-[10px] font-black uppercase tracking-widest">Fiesta Special</p>
          <p class="text-white font-black text-lg leading-tight font-display">
            DAILY FREE BINGO<br />
            <span class="text-primary">Every 6PM</span>
          </p>
        </div>
        <button
          type="button"
          class="flex-shrink-0 bg-pink-500 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow shadow-pink-500/30"
          @click="emit('openWallet')"
        >
          LIBRE!
        </button>
      </div>
    </div>
  </div>
</template>
