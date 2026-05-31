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
   * block   — 纯色底块 + 彩色分割线
   * overlay — 超强渐变 + 文字重阴影
   * glass   — 磨砂玻璃叠层（Live，object-center）
   * glass-a — 磨砂玻璃 + object-top（Popular，解法A）
   * glass-b — 图片完整展示 + 色彩玻璃底栏（Slot，解法B）
   * glass-c — 磨砂玻璃 + object-position偏上（Fishing，解法C）
   * hard    — 硬切分割
   */
  variant?: 'split' | 'block' | 'overlay' | 'glass' | 'glass-a' | 'glass-b' | 'glass-c' | 'hard'
}>()

// split / glass-b 模式：从图片底部提取色
const extractedColor = ref<string | null>(null)
function onImageLoad(e: Event) {
  const v = props.variant
  if (v && v !== 'split' && v !== 'glass-b') return
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

// glass-b 底栏：提取色半透明，呈现自然玻璃色调
const glassBBg = computed(() => {
  const base = extractedColor.value ?? props.fallbackBg[0]
  return `linear-gradient(to bottom, ${base}cc, ${base}f0)`
})

const accentColor = computed(() => props.tagBg ?? '#FFB800')
const tagStyle = computed(() =>
  props.tagBg
    ? { background: props.tagBg, color: props.tagFg ?? '#fff' }
    : { background: 'rgba(255,255,255,0.2)', color: '#fff' }
)

</script>

<template>
  <!-- ── glass-a：叠层玻璃 + object-top（解法A） ── -->
  <div v-if="variant === 'glass-a'" class="relative h-full w-full overflow-hidden">
    <div class="absolute inset-0" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }" />
    <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover object-top" />
    <slot />
    <div class="absolute inset-x-0 bottom-0 px-2.5 pt-2 pb-2.5 backdrop-blur-[10px] saturate-150 bg-black/60">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── glass-b：图片完整展示 + 色彩玻璃底栏（解法B） ── -->
  <div v-else-if="variant === 'glass-b'" class="flex flex-col h-full w-full overflow-hidden">
    <!-- 图片区：完整展示，不被遮挡 -->
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
    <!-- 底栏：提取色玻璃质感（无 backdrop-blur，图片在上方不重叠） -->
    <div
      class="flex-shrink-0 px-2.5 pt-2 pb-2.5 border-t border-white/10"
      :style="{ background: glassBBg }"
    >
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── glass-c：叠层玻璃 + object-position偏上20%（解法C） ── -->
  <div v-else-if="variant === 'glass-c'" class="relative h-full w-full overflow-hidden">
    <div class="absolute inset-0" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }" />
    <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" style="object-position: center 20%" />
    <slot />
    <div class="absolute inset-x-0 bottom-0 px-2.5 pt-2 pb-2.5 backdrop-blur-[10px] saturate-150 bg-black/60">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── block：纯色底块 + 彩色分割线 ── -->
  <div v-else-if="variant === 'block'" class="flex flex-col h-full w-full overflow-hidden">
    <div class="relative flex-1 overflow-hidden" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }">
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
      <slot />
    </div>
    <div class="flex-shrink-0 h-[2.5px]" :style="{ background: accentColor }" />
    <div class="flex-shrink-0 px-2.5 pt-2 pb-2.5" style="background: rgba(8,10,18,0.96)">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── overlay：超强渐变 + 文字重阴影 ── -->
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

  <!-- ── glass：磨砂玻璃叠层（Live，object-center，原版） ── -->
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

  <!-- ── hard：硬切分割 ── -->
  <div v-else-if="variant === 'hard'" class="flex flex-col h-full w-full overflow-hidden">
    <div class="relative overflow-hidden" style="height: 62%" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }">
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
      <slot />
    </div>
    <div class="flex-1 flex flex-col justify-center px-2.5 py-2" style="background: #0d1117">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[15px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/55 text-[10px] mt-0.5">{{ provider }}</p>
    </div>
  </div>

  <!-- ── split：上图下渐变信息栏（默认，Bingo/Perya 页） ── -->
  <div v-else class="flex flex-col h-full w-full overflow-hidden">
    <div class="relative flex-1 overflow-hidden" :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }">
      <img v-if="imageUrl" :src="imageUrl" crossorigin="anonymous" class="absolute inset-0 w-full h-full object-cover" @load="onImageLoad" />
      <slot />
    </div>
    <div class="flex-shrink-0 px-2 pt-1.5 pb-2" :style="{ background: barGradient }">
      <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1" :style="tagStyle">{{ tag }}</span>
      <p class="text-white font-black text-[11px] leading-tight truncate">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
