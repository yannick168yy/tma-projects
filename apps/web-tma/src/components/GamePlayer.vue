<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'

defineProps<{ url: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const iframeLoaded = ref(false)
const isTMA = isInsideTelegram()
const expanded = ref(false)

let collapseTimer: ReturnType<typeof setTimeout> | null = null

function expand() {
  expanded.value = true
  if (collapseTimer) clearTimeout(collapseTimer)
  collapseTimer = setTimeout(() => { expanded.value = false }, 2500)
}

onMounted(() => {
  if (!isTMA) expand()
})

onUnmounted(() => {
  if (collapseTimer) clearTimeout(collapseTimer)
})
</script>

<template>
  <div class="fixed inset-0 z-[100] flex flex-col bg-black">
    <!-- 浮动返回按钮（仅浏览器模式）：默认收合为小圆形，点击展开显示文字 -->
    <div
      v-if="!isTMA"
      class="absolute z-10 transition-all duration-300"
      :style="{ top: 'max(env(safe-area-inset-top, 0px) + 10px, 18px)', left: '12px' }"
    >
      <button
        v-if="!expanded"
        type="button"
        class="flex items-center justify-center w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 text-white active:bg-black/70 transition-colors"
        @click="expand"
      >
        <ArrowLeft :size="16" />
      </button>
      <button
        v-else
        type="button"
        class="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 px-4 py-2 text-sm font-bold text-white active:bg-black/80 transition-colors"
        @click="emit('close')"
      >
        <ArrowLeft :size="15" />
        {{ t('game.backToBetoGo') }}
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="!iframeLoaded" class="absolute inset-0 flex items-center justify-center bg-black z-10">
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
