<script setup lang="ts">
import { ref } from 'vue'
import { Flame } from 'lucide-vue-next'
import type { GameItem } from '@/data/home'

defineProps<{ game: GameItem }>()
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
    <div class="absolute inset-0 bg-gradient-to-br" :class="game.gradient" />
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="text-4xl">{{ game.icon }}</span>
    </div>
    <div
      v-if="game.hot"
      class="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
    >
      <Flame :size="9" class="text-white" />
      <span class="text-white text-[9px] font-bold">HOT</span>
    </div>
    <div class="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
      <p class="text-white font-black text-xs leading-tight whitespace-pre-line font-display">
        {{ game.name }}
      </p>
      <p class="text-white/50 text-[9px] uppercase tracking-wider">{{ game.provider }}</p>
    </div>
  </button>
</template>
