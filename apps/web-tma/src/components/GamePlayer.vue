<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'

defineProps<{ url: string }>()
const emit = defineEmits<{ close: [] }>()

const iframeLoaded = ref(false)
</script>

<template>
  <div class="fixed inset-0 z-[100] flex flex-col bg-black">
    <!-- 顶部返回栏 -->
    <div class="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-black border-b border-white/10" style="padding-top: max(env(safe-area-inset-top), 10px)">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white active:bg-white/20 transition-colors"
        @click="emit('close')"
      >
        <ArrowLeft :size="15" />
        Back to BetOGO
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="!iframeLoaded" class="absolute inset-0 flex items-center justify-center bg-black z-10 mt-12">
      <div class="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>

    <!-- 游戏 iframe -->
    <iframe
      :src="url"
      class="flex-1 w-full border-none"
      allow="fullscreen; autoplay; camera; microphone"
      @load="iframeLoaded = true"
    />
  </div>
</template>
