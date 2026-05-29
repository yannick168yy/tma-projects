<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
import { isInsideTelegram } from '@/utils/initTelegramWebApp'

defineProps<{ url: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const iframeLoaded = ref(false)
const isTMA = isInsideTelegram()
</script>

<template>
  <div class="fixed inset-0 z-[100] flex flex-col bg-black">
    <!-- 顶部返回栏：TMA 模式下隐藏，避免与 Telegram 自带关闭按钮重叠 -->
    <div
      v-if="!isTMA"
      class="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 bg-black border-b border-white/10"
      style="padding-top: max(env(safe-area-inset-top), 10px)"
    >
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white active:bg-white/20 transition-colors"
        @click="emit('close')"
      >
        <ArrowLeft :size="15" />
        {{ t('game.backToBetoGo') }}
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="!iframeLoaded" class="absolute inset-0 flex items-center justify-center bg-black z-10" :class="isTMA ? '' : 'mt-12'">
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
