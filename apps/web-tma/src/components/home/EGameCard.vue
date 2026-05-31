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
      overlay
      :image-url="game.imageHqUrl ?? game.imageUrl"
      :fallback-bg="['#1e1b4b', '#312e81']"
      :name="game.name"
      :provider="game.provider"
    />
  </button>
</template>
