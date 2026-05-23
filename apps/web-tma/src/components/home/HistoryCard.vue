<script setup lang="ts">
import type { GameItem } from '@/data/home'

defineProps<{ game: GameItem }>()
</script>

<template>
  <div class="flex-shrink-0 w-28 rounded-xl overflow-hidden relative cursor-pointer aspect-[3/4]">
    <div class="absolute inset-0 bg-gradient-to-br" :class="game.gradient" />
    <div class="absolute inset-0 flex items-center justify-center">
      <span class="text-4xl">{{ game.icon }}</span>
    </div>
    <div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
      <p class="text-white font-black text-[11px] leading-tight whitespace-pre-line font-display">
        {{ game.name }}
      </p>
      <p class="text-white/50 text-[9px] uppercase">{{ game.provider }}</p>
    </div>
  </div>
</template>
