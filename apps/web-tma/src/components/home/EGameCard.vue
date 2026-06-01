<script setup lang="ts">
import type { SlotGame } from '@/api/slots'
import GameImageCard from '@/components/game/GameImageCard.vue'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

defineProps<{
  game: SlotGame
  variant?: 'mirror'
}>()
const emit = defineEmits<{ tap: [] }>()
const localeStore = useLocaleStore()
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
      :fallback-bg="['#1e1b4b', '#312e81']"
      :name="localizedGameName(game, localeStore.locale)"
      :provider="game.provider"
    />
  </button>
</template>
