<script setup lang="ts">
defineProps<{ colors: string[] }>()
</script>

<template>
  <div class="flex items-end justify-start gap-0 overflow-hidden" style="height: 18px">
    <svg
      v-for="(c, i) in [...colors, ...colors, ...colors]"
      :key="i"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      style="flex-shrink: 0"
    >
      <polygon points="0,0 18,0 9,18" :fill="c" opacity="0.85" />
    </svg>
  </div>
</template>
