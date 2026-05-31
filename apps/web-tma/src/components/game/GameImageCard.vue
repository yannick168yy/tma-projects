<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  imageUrl: string | null
  fallbackBg: [string, string]
  name: string
  provider: string
  tag?: string
  tagBg?: string
  tagFg?: string
  /**
   * overlay 模式：图片全出血，文字叠在底部渐变上（首页用）
   * 默认 split 模式：图片上半 + 渐变信息栏下半（Bingo/Perya 页用）
   */
  overlay?: boolean
}>()

// ── split 模式专用：从图片底部提取色 ──────────────────────────
const extractedColor = ref<string | null>(null)

function onImageLoad(e: Event) {
  if (props.overlay) return  // overlay 模式不需要提取
  const img = e.target as HTMLImageElement
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 16, 16)
    const y0 = 12
    const data = ctx.getImageData(0, y0, 16, 4)
    let r = 0, g = 0, b = 0
    const n = data.data.length / 4
    for (let i = 0; i < data.data.length; i += 4) {
      r += data.data[i]; g += data.data[i + 1]; b += data.data[i + 2]
    }
    const d = 0.55
    extractedColor.value = `rgb(${Math.round(r/n*d)},${Math.round(g/n*d)},${Math.round(b/n*d)})`
  } catch { /* CORS 失败静默回退 */ }
}

const barGradient = computed(() => {
  const from = extractedColor.value ?? props.fallbackBg[0]
  return `linear-gradient(to bottom, ${from}, #07090f)`
})
</script>

<template>
  <!-- ── overlay 模式：全出血图片 + 底部渐变叠字 ── -->
  <div v-if="overlay" class="relative h-full w-full overflow-hidden">
    <div
      class="absolute inset-0"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    />
    <img
      v-if="imageUrl"
      :src="imageUrl"
      class="absolute inset-0 h-full w-full object-cover"
    />
    <!-- 底部渐变遮罩（固定，设计感强且稳定） -->
    <div class="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
    <!-- slot：LIVE 徽章等浮层 -->
    <slot />
    <!-- 文字区 -->
    <div class="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
      <span
        v-if="tag"
        class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5"
        :style="tagBg
          ? { background: tagBg, color: tagFg ?? '#fff' }
          : { background: 'rgba(255,255,255,0.2)', color: '#fff' }"
      >{{ tag }}</span>
      <p class="text-white font-black text-[14px] leading-tight truncate drop-shadow-sm">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── split 模式：上图下渐变信息栏（默认） ── -->
  <div v-else class="flex flex-col h-full w-full overflow-hidden">
    <div
      class="relative flex-1 overflow-hidden"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    >
      <img
        v-if="imageUrl"
        :src="imageUrl"
        crossorigin="anonymous"
        class="absolute inset-0 w-full h-full object-cover"
        @load="onImageLoad"
      />
      <slot />
    </div>
    <div class="flex-shrink-0 px-2 pt-1.5 pb-2" :style="{ background: barGradient }">
      <span
        v-if="tag"
        class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1"
        :style="tagBg
          ? { background: tagBg, color: tagFg ?? '#fff' }
          : { background: 'rgba(255,255,255,0.18)', color: '#fff' }"
      >{{ tag }}</span>
      <p class="text-white font-black text-[11px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
