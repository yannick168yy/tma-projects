<script setup lang="ts">
withDefaults(
  defineProps<{
    showBadge?: boolean
    badgeText?: string
  }>(),
  {
    showBadge: false,
    badgeText: 'B',
  },
)
</script>

<template>
  <div class="relative flex items-center justify-center" role="img" aria-label="Bet.Go.Win">
    <div class="flex flex-col leading-none" style="gap: 2.5px">
      <div class="flex items-baseline">
        <span class="font-display text-[1.3rem] font-black leading-none text-white">BETO</span>
        <span class="font-display text-[1.3rem] font-black leading-none text-primary">GO</span>
      </div>
      <div class="flex items-center gap-px leading-none">
        <span class="text-[0.54rem] font-extrabold text-white/45">Bet.</span>
        <span class="text-[0.54rem] font-extrabold text-primary">Go.</span>
        <span class="text-[0.54rem] font-extrabold text-white/45">Win</span>
      </div>
    </div>
    <span
      v-if="showBadge"
      class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-black text-primary-foreground"
    >
      {{ badgeText }}
    </span>
  </div>
</template>
