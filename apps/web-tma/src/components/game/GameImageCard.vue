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
   * split   — 上图下渐变信息栏（默认，Bingo/Perya 页）
   * block   — 方案1：纯色底块 + 彩色分割线（Popular）
   * overlay — 方案2：超强渐变 + 文字重阴影（Slot）
   * glass   — 方案3：磨砂玻璃底栏（Live）
   * hard    — 方案4：硬切分割（Fishing）
   */
  variant?: 'split' | 'block' | 'overlay' | 'glass' | 'hard'
}>()

// split 模式专用：从图片底部提取色
const extractedColor = ref<string | null>(null)
function onImageLoad(e: Event) {
  if (props.variant && props.variant !== 'split') return
  const img = e.target as HTMLImageElement
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 16, 16)
    const data = ctx.getImageData(0, 12, 16, 4)
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

const accentColor = computed(() => props.tagBg ?? '#FFB800')

const tagStyle = computed(() =>
  props.tagBg
    ? { background: props.tagBg, color: props.tagFg ?? '#fff' }
    : { background: 'rgba(255,255,255,0.2)', color: '#fff' }
)
</script>

<template>
  <!-- ── 方案1 BLOCK：纯色底块 + 彩色分割线 ── -->
  <div v-if="variant === 'block'" class="flex flex-col h-full w-full overflow-hidden">
    <div
      class="relative flex-1 overflow-hidden"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    >
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
      <slot />
    </div>
    <!-- 彩色分割线 -->
    <div class="flex-shrink-0 h-[2.5px]" :style="{ background: accentColor }" />
    <!-- 纯色底块 -->
    <div class="flex-shrink-0 px-2.5 pt-2 pb-2.5" style="background: rgba(8,10,18,0.96)">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── 方案2 OVERLAY：超强渐变 + 文字重阴影 ── -->
  <div v-else-if="variant === 'overlay'" class="relative h-full w-full overflow-hidden">
    <div class="absolute inset-0" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }" />
    <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
    <div class="absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-black/95 via-black/60 to-transparent" />
    <slot />
    <div class="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate" style="text-shadow: 0 2px 12px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,0.8)">{{ name }}</p>
      <p class="text-white/60 text-[10px] mt-0.5" style="text-shadow: 0 1px 6px rgba(0,0,0,1)">{{ provider }}</p>
    </div>
  </div>

  <!-- ── 方案3 GLASS：磨砂玻璃底栏 ── -->
  <div v-else-if="variant === 'glass'" class="relative h-full w-full overflow-hidden">
    <div class="absolute inset-0" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }" />
    <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
    <slot />
    <div class="absolute inset-x-0 bottom-0 px-2.5 pt-2 pb-2.5 backdrop-blur-[10px] saturate-150 bg-black/60">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── 方案4 HARD：硬切分割 ── -->
  <div v-else-if="variant === 'hard'" class="flex flex-col h-full w-full overflow-hidden">
    <div
      class="relative overflow-hidden"
      style="height: 62%"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    >
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
      <slot />
    </div>
    <div class="flex-1 flex flex-col justify-center px-2.5 py-2" style="background: #0d1117">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── 默认 SPLIT：上图下渐变信息栏（Bingo/Perya 页） ── -->
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
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[11px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
