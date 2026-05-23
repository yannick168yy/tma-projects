<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { Search, X, Flame } from 'lucide-vue-next'
import { ALL_MENU_GAMES, CASINO_SUBCATS } from '@/data/menu'
import { useBottomSheetDrag } from '@/composables/useBottomSheetDrag'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const sheetRef = ref<HTMLElement | null>(null)

const {
  sheetStyle,
  backdropStyle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = useBottomSheetDrag(toRef(props, 'open'), () => emit('close'), sheetRef)

const query = ref('')
const tab = ref('all')
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  setTimeout(() => inputRef.value?.focus(), 80)
})

watch(
  () => props.open,
  (open) => {
    if (open) setTimeout(() => inputRef.value?.focus(), 80)
  },
)

const tabGames = computed(() =>
  tab.value === 'all' ? ALL_MENU_GAMES : ALL_MENU_GAMES.filter((g) => g.catId === tab.value),
)

const displayed = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return tabGames.value
  return tabGames.value.filter((g) => g.name.toLowerCase().includes(q))
})

const hasQuery = computed(() => query.value.trim().length > 0)
</script>

<template>
  <template v-if="open">
    <div
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity"
      :style="backdropStyle"
      @click="emit('close')"
    />

    <div
      ref="sheetRef"
      data-bottom-sheet
      class="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-3xl bg-card"
      :style="[sheetStyle, { height: '86vh' }]"
      @pointerdown.capture="onPointerDown"
      @pointermove="onPointerMove"
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
            placeholder="Search games…"
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
          Cancel
        </button>
      </div>

      <div data-sheet-drag class="flex flex-shrink-0 gap-2 overflow-x-auto px-4 py-2.5 hide-scrollbar">
        <button
          type="button"
          class="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
          :class="tab === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
          @click="tab = 'all'"
        >
          All Games
        </button>
        <button
          v-for="c in CASINO_SUBCATS"
          :key="c.id"
          type="button"
          class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
          :class="tab === c.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
          @click="tab = c.id"
        >
          <span>{{ c.icon }}</span>
          <span>{{ c.label }}</span>
        </button>
      </div>

      <div class="px-4 pb-2 flex-shrink-0">
        <p class="text-muted-foreground text-[11px] font-bold">
          {{ hasQuery ? `Search results · ${displayed.length} games` : `All Games · ${displayed.length}` }}
        </p>
      </div>

      <div data-sheet-scroll class="page-scroll flex-1 px-4 pb-6 hide-scrollbar">
        <div v-if="displayed.length > 0" data-sheet-drag class="grid grid-cols-3 gap-3">
          <button
            v-for="(g, i) in displayed"
            :key="i"
            type="button"
            class="relative rounded-2xl overflow-hidden flex flex-col justify-end active:scale-95 transition-transform aspect-[3/4]"
          >
            <div class="absolute inset-0 bg-gradient-to-br" :class="g.gradient" />
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-[32px]">{{ g.icon }}</span>
            </div>
            <div
              v-if="g.hot"
              class="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
            >
              <Flame :size="8" class="text-white" />
              <span class="text-white text-[8px] font-black">HOT</span>
            </div>
            <div class="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
              <p class="text-white font-black text-[10px] leading-tight font-display">{{ g.name.toUpperCase() }}</p>
              <p class="text-white/40 text-[9px]">{{ g.provider }}</p>
            </div>
          </button>
        </div>
        <div v-else class="text-center py-16">
          <p class="text-4xl mb-3">🔍</p>
          <p class="text-foreground font-bold text-sm">No results for "{{ query }}"</p>
          <p class="text-muted-foreground text-xs mt-1">Try a different keyword</p>
        </div>
      </div>
    </div>
  </template>
</template>
