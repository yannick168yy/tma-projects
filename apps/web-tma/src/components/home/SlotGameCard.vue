<script setup lang="ts">
import { Play, Tv2 } from 'lucide-vue-next'
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard.vue'

defineProps<{
  game: SlotGame
  launching: boolean
}>()

const emit = defineEmits<{
  play: [uuid: string]
  demo: [uuid: string]
}>()

function formatTheme(theme: string | null): string | undefined {
  if (!theme) return undefined
  return theme.replace(/-/g, ' ').toUpperCase()
}
</script>

<template>
  <div class="group relative h-44 overflow-hidden rounded-xl">
    <GameImageCard
      :image-url="game.imageHqUrl ?? game.imageUrl"
      :fallback-bg="['#1e1b4b', '#312e81']"
      :name="game.name"
      :provider="game.provider"
      :tag="formatTheme(game.theme)"
    >
      <!-- Play / Demo 浮层 -->
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        :class="{ 'opacity-100': launching }"
      >
        <button
          type="button"
          class="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground shadow-lg"
          :disabled="launching"
          @click.stop="emit('play', game.uuid)"
        >
          <Play :size="12" />
          Play
        </button>
        <button
          v-if="game.hasDemo"
          type="button"
          class="flex w-4/5 items-center justify-center gap-1.5 rounded-full bg-white/20 py-1.5 text-xs font-semibold text-white hover:bg-white/30"
          :disabled="launching"
          @click.stop="emit('demo', game.uuid)"
        >
          <Tv2 :size="11" />
          Demo
        </button>
      </div>
    </GameImageCard>
  </div>
</template>
