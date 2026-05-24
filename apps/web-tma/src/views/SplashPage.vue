<script setup lang="ts">
import BetogoLogo from '@/components/BetogoLogo.vue'

defineProps<{ error?: string | null }>()
</script>

<template>
  <div class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#040609]">
    <div class="splash-logo mb-8">
      <BetogoLogo />
    </div>
    <div class="flex items-center gap-2">
      <span v-for="i in 3" :key="i" class="splash-dot" :style="{ animationDelay: `${(i - 1) * 0.15}s` }" />
    </div>
    <p v-if="error" class="mt-6 max-w-[260px] text-center text-sm text-red-400">{{ error }}</p>
  </div>
</template>

<style scoped>
.splash-logo {
  animation: splash-pulse 1.6s ease-in-out infinite;
}
.splash-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #fbbf24;
  animation: splash-bounce 0.9s ease-in-out infinite;
}
@keyframes splash-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.85;
    transform: scale(0.97);
  }
}
@keyframes splash-bounce {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
</style>
