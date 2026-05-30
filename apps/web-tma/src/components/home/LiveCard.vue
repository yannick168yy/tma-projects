<script setup lang="ts">
import type { SlotGame } from '@/api/slots'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <div
    class="flex-shrink-0 w-32 rounded-xl overflow-hidden relative h-28 cursor-pointer"
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
    <div v-else class="absolute inset-0 bg-gradient-to-br from-emerald-900 to-teal-700" />
    <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
    <div class="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-500/80 rounded-full px-1.5 py-0.5">
      <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      <span class="text-white text-[9px] font-bold">LIVE</span>
    </div>
    <div class="absolute bottom-0 inset-x-0 p-1.5">
      <p class="text-white font-bold text-xs leading-tight truncate">{{ game.name }}</p>
    </div>
  </div>
</template>
