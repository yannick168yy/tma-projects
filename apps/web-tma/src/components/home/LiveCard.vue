<script setup lang="ts">
import type { LiveGameItem } from '@/data/home'

defineProps<{ game: LiveGameItem }>()
</script>

<template>
  <div class="flex-shrink-0 w-36 rounded-xl overflow-hidden relative h-24 cursor-pointer">
    <div class="absolute inset-0 bg-gradient-to-br" :class="game.gradient" />
    <div class="absolute top-2 left-2 flex items-center gap-1 bg-red-500 rounded-full px-2 py-0.5">
      <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      <span class="text-white text-[10px] font-bold">LIVE</span>
    </div>
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="text-3xl">{{ game.icon }}</span>
    </div>
    <div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
      <p class="text-white font-bold text-xs">{{ game.name }}</p>
      <p class="text-white/60 text-[10px]">{{ game.players }} playing</p>
    </div>
  </div>
</template>
