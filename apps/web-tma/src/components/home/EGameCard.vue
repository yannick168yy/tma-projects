<script setup lang="ts">
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard.vue'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex-shrink-0 w-32 h-36 rounded-xl overflow-hidden active:scale-95 transition-transform"
    @click="emit('tap')"
  >
    <GameImageCard
      :image-url="game.imageHqUrl ?? game.imageUrl"
      :fallback-bg="['#1e1b4b', '#312e81']"
      :name="game.name"
      :provider="game.provider"
    >
      <span class="absolute top-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white/80">
        {{ game.provider }}
      </span>
    </GameImageCard>
  </button>
</template>
