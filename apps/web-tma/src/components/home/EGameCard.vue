<script setup lang="ts">
import { Flame } from 'lucide-vue-next'
import type { EGameItem } from '@/data/home'

defineProps<{ game: EGameItem }>()
</script>

<template>
  <div class="flex-shrink-0 w-32 rounded-xl overflow-hidden relative h-24 cursor-pointer">
    <div class="absolute inset-0 bg-gradient-to-br" :class="game.gradient" />
    <div
      v-if="game.hot"
      class="absolute top-2 left-2 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
    >
      <Flame :size="9" class="text-white" />
      <span class="text-white text-[9px] font-bold">HOT</span>
    </div>
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="text-3xl">{{ game.icon }}</span>
    </div>
    <div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
      <p class="text-white font-bold text-xs font-display">{{ game.name }}</p>
      <p class="text-white/50 text-[9px]">{{ game.players.toLocaleString() }} playing</p>
    </div>
  </div>
</template>
