<script setup lang="ts">
import { Flame } from 'lucide-vue-next'
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard.vue'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <button
    type="button"
    class="relative w-full h-44 overflow-hidden rounded-xl active:scale-[0.98] transition-transform"
    @click="emit('tap')"
  >
    <GameImageCard
      variant="glass-a"
      :image-url="game.imageHqUrl ?? game.imageUrl"
      :fallback-bg="['#1e1b4b', '#312e81']"
      :name="game.name"
      :provider="game.provider"
      :tag-bg="game.phBonus >= 20 ? '#ef4444' : undefined"
    >
      <div
        v-if="game.phBonus >= 20"
        class="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
      >
        <Flame :size="9" class="text-white" />
        <span class="text-white text-[9px] font-bold">HOT</span>
      </div>
    </GameImageCard>
  </button>
</template>
