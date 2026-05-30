<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, Search, X, RefreshCw } from 'lucide-vue-next'
import { fetchGames, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import SlotGameCard from '@/components/home/SlotGameCard.vue'

const emit = defineEmits<{ close: []; gameTap: []; openGame: [url: string] }>()

const { t } = useI18n()
const auth = useAuthStore()

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const games = ref<SlotGame[]>([])
const total = ref(0)
const page = ref(1)
const pages = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const launchingUuid = ref<string | null>(null)
const hasMore = computed(() => page.value < pages.value)

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function doSearch(q: string, reset = true) {
  if (reset) {
    loading.value = true
    page.value = 1
    games.value = []
  } else {
    loadingMore.value = true
  }
  error.value = ''
  try {
    const res = await fetchGames({ search: q || undefined, limit: 30, page: page.value })
    if (reset) {
      games.value = res.items
    } else {
      games.value.push(...res.items)
    }
    total.value = res.total
    pages.value = res.pages
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Search failed'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (loadingMore.value || page.value >= pages.value) return
  page.value++
  doSearch(query.value.trim(), false)
}

watch(query, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => doSearch(val.trim(), true), 300)
})

async function onPlay(uuid: string) {
  if (!auth.isLoggedIn) {
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

onMounted(() => {
  doSearch('')
  setTimeout(() => inputRef.value?.focus(), 80)
})
</script>

<template>
  <div class="min-h-full bg-background">
    <!-- 顶部搜索栏 -->
    <div class="flex items-center gap-3 border-b border-border px-4 py-3">
      <button type="button" class="flex-shrink-0 text-muted-foreground" @click="emit('close')">
        <ChevronLeft :size="22" />
      </button>
      <div class="relative flex-1">
        <Search :size="14" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :placeholder="t('search.placeholder')"
          class="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          @click="query = ''"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <!-- 结果计数 -->
    <div class="px-4 py-2 flex items-center gap-2">
      <p class="text-muted-foreground text-[11px] font-bold flex-1">
        {{
          query.trim()
            ? t('search.resultsCount', { count: total })
            : t('search.allCount', { count: total })
        }}
      </p>
      <RefreshCw v-if="loading" :size="12" class="text-muted-foreground animate-spin" />
    </div>

    <!-- 游戏网格 -->
    <div class="px-4 pb-6">
      <div v-if="games.length > 0">
        <div class="grid grid-cols-2 gap-3">
          <SlotGameCard
            v-for="game in games"
            :key="game.uuid"
            :game="game"
            :launching="launchingUuid === game.uuid"
            @play="onPlay"
            @demo="onDemo"
          />
        </div>
        <div v-if="hasMore" class="mt-4 flex justify-center pb-2">
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
      </div>
      <div v-else-if="!loading" class="text-center py-16">
        <p class="text-4xl mb-3">🔍</p>
        <p class="text-foreground font-bold text-sm">
          {{ query.trim() ? t('search.noResultsFor', { query }) : t('search.noResults') }}
        </p>
        <p v-if="query.trim()" class="text-muted-foreground text-xs mt-1">{{ t('search.tryAnother') }}</p>
      </div>
    </div>
  </div>
</template>
