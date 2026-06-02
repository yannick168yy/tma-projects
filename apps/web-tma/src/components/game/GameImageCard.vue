<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, type CSSProperties } from 'vue'

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

// ── 游戏名四级降级策略 ──
// 优先大号字体，单行放不下换两行，两行还放不下缩小字号，最终 webkit-line-clamp 自动省略
// mirror: 大号 15px / 小号 11px；split: 大号 11px / 小号 9px
type NameLevel = 'large-1' | 'large-2' | 'small'
const nameLevel = ref<NameLevel>('large-1')
const nameRef = ref<HTMLElement | null>(null)

const MIRROR_LARGE = 15
const MIRROR_SMALL = 11
const SPLIT_LARGE = 11
const SPLIT_SMALL = 9

function measureTextPx(text: string, fontSize: number, refEl: HTMLElement): number {
  const span = document.createElement('span')
  span.style.cssText = `position:fixed;top:-9999px;left:-9999px;white-space:nowrap;font-size:${fontSize}px;font-weight:900;font-family:${getComputedStyle(refEl).fontFamily};visibility:hidden`
  span.textContent = text
  document.body.appendChild(span)
  const w = span.getBoundingClientRect().width
  document.body.removeChild(span)
  return w
}

function resolveNameLevel() {
  nextTick().then(() => {
    const el = nameRef.value
    if (!el) return
    const w = el.clientWidth
    if (!w) return
    const large = props.variant === 'mirror' ? MIRROR_LARGE : SPLIT_LARGE

    const lw = measureTextPx(props.name, large, el)
    if (lw <= w) { nameLevel.value = 'large-1'; return }
    if (lw <= w * 2) { nameLevel.value = 'large-2'; return }
    nameLevel.value = 'small'
  })
}

onMounted(resolveNameLevel)
watch(() => props.name, resolveNameLevel)

const nameStyle = computed((): CSSProperties => {
  const isMirror = props.variant === 'mirror'
  const largePx = `${isMirror ? MIRROR_LARGE : SPLIT_LARGE}px`
  const smallPx = `${isMirror ? MIRROR_SMALL : SPLIT_SMALL}px`
  const level = nameLevel.value

  if (level === 'large-1') {
    return {
      fontSize: largePx,
      lineHeight: '1.25',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
  }
  return {
    fontSize: level === 'large-2' ? largePx : smallPx,
    lineHeight: '1.25',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  }
})
</script>

<template>
  <!-- ── mirror：图片完整展示 + 底栏镜像模糊毛玻璃 ── -->
  <div v-if="variant === 'mirror'" class="flex flex-col h-full w-full overflow-hidden">
    <div
      class="relative flex-1 overflow-hidden"
      :style="{ background: `linear-gradient(135deg, ${fallbackBg[0]}, ${fallbackBg[1]})` }"
    >
      <img v-if="imageUrl" :src="imageUrl" class="absolute inset-0 w-full h-full object-cover" />
      <slot />
    </div>
    <div class="flex-shrink-0 relative overflow-hidden px-2.5 pt-2 pb-2.5">
      <div v-if="imageUrl" class="absolute" :style="mirrorBgStyle" />
      <div v-else class="absolute inset-0" :style="{ background: fallbackBg[0] }" />
      <div class="relative z-10">
        <span v-if="tag" class="text-[7px] font-black px-1.5 py-[2px] rounded-full leading-none inline-block mb-1.5" :style="tagStyle">{{ tag }}</span>
        <p ref="nameRef" class="text-white font-black" :style="nameStyle">{{ name }}</p>
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
        <p ref="nameRef" class="text-white font-black" :style="nameStyle">{{ name }}</p>
      <p class="text-white/50 text-[9px] mt-px">{{ provider }}</p>
    </div>
  </div>
</template>
