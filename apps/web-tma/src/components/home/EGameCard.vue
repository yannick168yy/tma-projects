<script setup lang="ts">
import type { SlotGame } from '@/api/slots'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <div
    class="flex-shrink-0 w-32 rounded-xl overflow-hidden relative h-20 cursor-pointer"
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
    <div v-else class="absolute inset-0 bg-gradient-to-br from-violet-900 to-indigo-700" />
    <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
    <span class="absolute top-1 left-1 rounded bg-black/50 px-1 py-0.5 text-[8px] font-bold uppercase text-white/80">
      {{ game.provider }}
    </span>
    <div class="absolute bottom-0 inset-x-0 p-1.5">
      <p class="text-white font-bold text-[11px] leading-tight truncate">{{ game.name }}</p>
    </div>
  </div>
</template>
