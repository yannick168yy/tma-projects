<script setup lang="ts">
import { ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X, RefreshCw } from 'lucide-vue-next'
import { useBottomSheetDrag } from '@/composables/useBottomSheetDrag'
import { fetchGames, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import SlotGameCard from '@/components/home/SlotGameCard.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; gameTap: []; openGame: [url: string] }>()

const { t } = useI18n()
const auth = useAuthStore()

const sheetRef = ref<HTMLElement | null>(null)
const backdropRef = ref<HTMLElement | null>(null)

const { onPointerDown, onPointerUp, onPointerCancel } = useBottomSheetDrag(
  toRef(props, 'open'),
  () => emit('close'),
  sheetRef,
  backdropRef,
)

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const games = ref<SlotGame[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const launchingUuid = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function doSearch(q: string) {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchGames({ search: q || undefined, limit: 60 })
    games.value = res.items
    total.value = res.total
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Search failed'
  } finally {
    loading.value = false
  }
}

watch(query, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => doSearch(val.trim()), 300)
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      doSearch('')
      setTimeout(() => inputRef.value?.focus(), 80)
    }
  },
)

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
</script>

<template>
  <template v-if="open">
    <div
      ref="backdropRef"
      data-bottom-sheet-backdrop
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      @click="emit('close')"
    />

    <div
      ref="sheetRef"
      data-bottom-sheet
      class="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-3xl bg-card"
      style="height: 86vh"
      @pointerdown.capture="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div class="flex flex-shrink-0 justify-center pb-1 pt-3">
        <div class="h-1 w-10 rounded-full bg-border" />
      </div>

      <div class="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 pb-3">
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
        <button type="button" class="flex-shrink-0 px-1 text-sm font-bold text-muted-foreground" @click="emit('close')">
          {{ t('search.cancel') }}
        </button>
      </div>

      <div class="px-4 pb-2 pt-2 flex-shrink-0 flex items-center gap-2">
        <p class="text-muted-foreground text-[11px] font-bold flex-1">
          {{
            query.trim()
              ? t('search.resultsCount', { count: total })
              : t('search.allCount', { count: total })
          }}
        </p>
        <RefreshCw v-if="loading" :size="12" class="text-muted-foreground animate-spin" />
      </div>

      <div data-sheet-scroll class="page-scroll flex-1 px-4 pb-6 hide-scrollbar">
        <div v-if="games.length > 0" class="grid grid-cols-3 gap-3">
          <SlotGameCard
            v-for="game in games"
            :key="game.uuid"
            :game="game"
            :launching="launchingUuid === game.uuid"
            @play="onPlay"
            @demo="onDemo"
          />
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
</template>
