<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  imageUrl: string | null
  /** 图片加载前/提取失败时的兜底渐变色 [深色, 浅色] */
  fallbackBg: [string, string]
  name: string
  provider: string
  tag?: string
  tagBg?: string
  tagFg?: string
}>()

// 从图片底部提取到的平均色，提取成功后替换兜底色
const extractedColor = ref<string | null>(null)

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  try {
    const canvas = document.createElement('canvas')
    // 缩小到 16×16 采样，性能好且颜色足够准
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 16, 16)

    // 取底部 25% 的像素均值
    const y0 = 12 // 16 * 0.75
    const data = ctx.getImageData(0, y0, 16, 4)
    let r = 0, g = 0, b = 0
    const n = data.data.length / 4
    for (let i = 0; i < data.data.length; i += 4) {
      r += data.data[i]
      g += data.data[i + 1]
      b += data.data[i + 2]
    }
    // 压暗 55%，保证文字在渐变底色上可读
    const d = 0.55
    extractedColor.value = `rgb(${Math.round(r / n * d)},${Math.round(g / n * d)},${Math.round(b / n * d)})`
  } catch {
    // 跨域失败时静默回退，不影响显示
  }
}

// 信息栏渐变：从提取色（或兜底色）渐变到近黑
const barGradient = computed(() => {
  const from = extractedColor.value ?? props.fallbackBg[0]
  return `linear-gradient(to bottom, ${from}, #07090f)`
})
</script>

<template>
  <div class="flex flex-col h-full w-full overflow-hidden">
    <!-- 图片区（slot 供外部插入徽章、浮层按钮等） -->
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

    <!-- 渐变信息栏 -->
    <div class="flex-shrink-0 px-2 pt-1.5 pb-2" :style="{ background: barGradient }">
      <span
        v-if="tag && tagBg"
        class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1"
        :style="{ background: tagBg, color: tagFg ?? '#fff' }"
      >{{ tag }}</span>
      <p class="text-white font-black text-[11px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
