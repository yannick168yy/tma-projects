<script setup lang="ts">
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard.vue'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex-shrink-0 w-32 h-44 rounded-xl overflow-hidden active:scale-95 transition-transform"
    @click="emit('tap')"
  >
    <GameImageCard
      variant="mirror"
      :image-url="game.imageHqUrl ?? game.imageUrl"
      :fallback-bg="['#064e3b', '#065f46']"
      :name="game.name"
      :provider="game.provider"
    >
      <div class="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-500/85 rounded-full px-1.5 py-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        <span class="text-white text-[8px] font-bold">LIVE</span>
      </div>
    </GameImageCard>
  </button>
</template>
