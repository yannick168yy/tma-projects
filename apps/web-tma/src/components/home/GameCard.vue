<script setup lang="ts">
import { ref } from 'vue'
import { Flame } from 'lucide-vue-next'
import type { SlotGame } from '@/api/slots'

defineProps<{ game: SlotGame }>()
const emit = defineEmits<{ tap: [] }>()

const pressed = ref(false)
</script>

<template>
  <button
    type="button"
    class="relative aspect-[3/4] overflow-hidden rounded-xl flex flex-col justify-end transition-transform duration-100"
    :class="pressed ? 'scale-95' : ''"
    @pointerdown="pressed = true"
    @pointerup="pressed = false"
    @pointerleave="pressed = false"
    @pointercancel="pressed = false"
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
    <div v-else class="absolute inset-0 bg-gradient-to-br from-indigo-900 to-purple-800" />
    <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
    <div
      v-if="game.phBonus >= 20"
      class="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
    >
      <Flame :size="9" class="text-white" />
      <span class="text-white text-[9px] font-bold">HOT</span>
    </div>
    <div class="relative p-2">
      <p class="text-white font-black text-xs leading-tight truncate font-display">
        {{ game.name }}
      </p>
      <p class="text-white/50 text-[9px] uppercase tracking-wider">{{ game.provider }}</p>
    </div>
  </button>
</template>
