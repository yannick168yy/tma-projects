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
   * mirror — 图片完整展示 + 底栏镜像模糊毛玻璃（首页 / Bingo 页）
   * split  — 上图下渐变信息栏，canvas 提取色（默认，SIGNATURE GAMES 小卡）
   */
  variant?: 'mirror' | 'split'
  /** object-position，默认 center，传 'top' 可让游戏图标顶部对齐 */
  imagePosition?: 'center' | 'top' | 'bottom'
}>()

// split 模式：canvas 提取图片底部色用于信息栏渐变
const extractedColor = ref<string | null>(null)
function onImageLoad(e: Event) {
  if (props.variant === 'mirror') return
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

const mirrorBgStyle = computed(() => ({
  inset: '-10px',
  backgroundImage: `url("${props.imageUrl}")`,
  backgroundSize: 'cover' as const,
  backgroundPosition: 'center bottom',
  filter: 'blur(14px) brightness(0.48) saturate(1.4)',
}))

const tagStyle = computed(() =>
  props.tagBg
    ? { background: props.tagBg, color: props.tagFg ?? '#fff' }
    : { background: 'rgba(255,255,255,0.2)', color: '#fff' }
)
</script>

<template>
  <!-- ── mirror：图片完整展示 + 底栏镜像模糊毛玻璃 ── -->
  <div v-if="variant === 'mirror'" class="flex flex-col h-full w-full overflow-hidden">
    <div
      class="relative flex-1 overflow-hidden"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    >
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" :style="{ objectPosition: imagePosition ?? 'center' }" />
      <slot />
    </div>
    <div class="flex-shrink-0 relative overflow-hidden px-2.5 pt-2 pb-2.5">
      <div v-if="imageUrl" class="absolute" :style="mirrorBgStyle" />
      <div v-else class="absolute inset-0" :style="{ background: fallbackBg[0] }" />
      <div class="relative z-10">
        <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
        <p class="text-white font-black text-[15px] leading-tight line-clamp-2 min-h-[2.5em]">{{ name }}</p>
        <p class="text-white/60 text-[10px] mt-0.5">{{ provider }}</p>
      </div>
    </div>
  </div>

  <!-- ── split（默认）：上图下渐变信息栏 ── -->
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
      <p class="text-white font-black text-[11px] leading-tight line-clamp-2 min-h-[2.5em]">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
