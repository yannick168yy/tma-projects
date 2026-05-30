<script setup lang="ts">
import { ref } from 'vue'
import { Play, Tv2 } from 'lucide-vue-next'
import type { SlotGame } from '@/api/slots'

defineProps<{
  game: SlotGame
  launching: boolean
}>()

const emit = defineEmits<{
  play: [uuid: string]
  demo: [uuid: string]
}>()

const imgError = ref(false)
</script>

<template>
  <div class="group relative flex h-40 flex-col overflow-hidden rounded-xl bg-card border border-border">
    <!-- Thumbnail -->
    <div class="relative min-h-0 flex-1 w-full overflow-hidden bg-secondary">
      <img
        v-if="game.imageUrl && !imgError"
        :src="game.imageUrl"
        :alt="game.name"
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
        @error="imgError = true"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 to-purple-900"
      >
        <span class="text-2xl">🎰</span>
      </div>

      <!-- Provider badge -->
      <span class="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/80">
        {{ game.provider }}
      </span>

      <!-- Hover overlay with buttons -->
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        :class="{ 'opacity-100': launching }"
      >
        <button
          type="button"
          class="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground shadow-lg transition-opacity"
          :disabled="launching"
          @click.stop="emit('play', game.uuid)"
        >
          <Play :size="12" />
          Play
        </button>
        <button
          v-if="game.hasDemo"
          type="button"
          class="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-white/20 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
          :disabled="launching"
          @click.stop="emit('demo', game.uuid)"
        >
          <Tv2 :size="11" />
          Demo
        </button>
      </div>
    </div>

    <!-- Name -->
    <div class="px-2 py-1.5">
      <p class="truncate text-[11px] font-semibold text-foreground">{{ game.name }}</p>
    </div>
  </div>
</template>
