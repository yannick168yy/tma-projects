<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ChevronLeft, Search, RefreshCw } from 'lucide-vue-next'
import SlotGameCard from '@/components/home/SlotGameCard.vue'
import { fetchGames, fetchProviders, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(defineProps<{
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus' | 'name'
  title?: string
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
}>(), {})

const emit = defineEmits<{
  close: []
  gameTap: []
  openGame: [url: string]
}>()

const { t } = useI18n()
const auth = useAuthStore()
const { isLoggedIn } = storeToRefs(auth)

const games = ref<SlotGame[]>([])
const providers = ref<string[]>([])
const total = ref(0)
const currentPage = ref(1)
const pages = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const launchingUuid = ref<string | null>(null)
const error = ref('')

const search = ref('')
const selectedProvider = ref('all')

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function loadProviders() {
  try {
    providers.value = await fetchProviders()
  } catch {
    // ignore
  }
}

async function loadGames(reset = true) {
  if (reset) {
    loading.value = true
    currentPage.value = 1
    games.value = []
  } else {
    loadingMore.value = true
  }
  error.value = ''

  try {
    const res = await fetchGames({
      page: currentPage.value,
      limit: 30,
      search: search.value || undefined,
      provider: selectedProvider.value !== 'all' ? selectedProvider.value : undefined,
      sortCategory: props.sortCategory,
      sortBy: props.sortBy,
      themes: props.themes,
      gameStyles: props.gameStyles,
      playerTypes: props.playerTypes,
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

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadGames(true), 350)
}

function selectProvider(p: string) {
  selectedProvider.value = p
  loadGames(true)
}

function loadMore() {
  if (loadingMore.value || currentPage.value >= pages.value) return
  currentPage.value++
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
    openGameUrl(url)
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
    openGameUrl(url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Failed to launch demo')
  } finally {
    launchingUuid.value = null
  }
}

function openGameUrl(url: string) {
  emit('openGame', url)
}

const hasMore = computed(() => currentPage.value < pages.value)

onMounted(() => {
  loadProviders()
  loadGames()
})
</script>

<template>
  <div class="min-h-full bg-background">
    <!-- Header -->
    <div class="flex items-center gap-3 border-b border-border px-4 py-3">
      <button type="button" class="flex-shrink-0 text-muted-foreground" @click="emit('close')">
        <ChevronLeft :size="22" />
      </button>
      <h2 class="flex-1 text-sm font-bold text-foreground">
        {{ props.title || 'SLOTS' }}
        <span v-if="total > 0" class="ml-1.5 text-xs font-normal text-muted-foreground">{{ total.toLocaleString() }} games</span>
      </h2>
    </div>

    <!-- Search + filter bar -->
    <div class="flex-shrink-0 space-y-2 border-b border-border px-4 py-3">
      <div class="relative">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="search"
          type="search"
          :placeholder="t('slots.searchPlaceholder')"
          class="w-full rounded-xl bg-secondary py-2.5 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-primary"
          @input="onSearchInput"
        />
      </div>

      <!-- Provider chips -->
      <div v-if="providers.length > 0" class="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        <button
          type="button"
          class="flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors"
          :class="selectedProvider === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
          @click="selectProvider('all')"
        >
          {{ t('slots.allProviders') }}
        </button>
        <button
          v-for="p in providers"
          :key="p"
          type="button"
          class="flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors"
          :class="selectedProvider === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
          @click="selectProvider(p)"
        >
          {{ p }}
        </button>
      </div>
    </div>

    <!-- Game grid -->
    <div class="px-3 py-3">
      <!-- Loading skeleton -->
      <div v-if="loading" class="grid grid-cols-2 gap-2">
        <div
          v-for="n in 12"
          :key="n"
          class="h-40 animate-pulse rounded-xl bg-secondary"
        />
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
        {{ t('slots.noGames') }}
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

        <!-- Load more -->
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
  </div>
</template>
