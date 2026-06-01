<script setup lang="ts">
import type { GameHistoryItem } from '@/api/slots'
import { useLocaleStore } from '@/stores/locale'
import { localizedGameName } from '@/utils/game'

defineProps<{ game: GameHistoryItem }>()
const emit = defineEmits<{ tap: [] }>()
const localeStore = useLocaleStore()
</script>

<template>
  <button
    type="button"
    class="flex-shrink-0 w-24 rounded-xl overflow-hidden relative h-24 text-left"
    @click="emit('tap')"
  >
    <div v-if="game.imageHqUrl || game.imageUrl" class="absolute inset-0">
      <img
        :src="game.imageHqUrl || game.imageUrl || ''"
        :alt="game.name"
        class="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
    <div v-else class="absolute inset-0 bg-gradient-to-br from-amber-800 via-amber-600 to-yellow-400" />
    <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
    <div class="absolute bottom-0 inset-x-0 p-2">
      <p class="text-white font-black text-[11px] leading-tight truncate font-display">{{ localizedGameName(game, localeStore.locale) }}</p>
      <p class="text-white/50 text-[9px] uppercase">{{ game.provider }}</p>
    </div>
  </button>
</template>
