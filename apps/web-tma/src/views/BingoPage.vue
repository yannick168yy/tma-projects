<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trophy, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import PeryaCarnivalHero from '@/components/bingo/PeryaCarnivalHero.vue'
import GameImageCard from '@/components/game/GameImageCard.vue'
import { PINOY_CLASSICS, MORE_PINOY_GAMES, PERYA_WINNERS } from '@/data/bingo'
import { fetchGames, launchGame, type SlotGame } from '@/api/slots'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'

const emit = defineEmits<{
  openWallet: []
  gameTap: []
  openGame: [url: string]
  openCategoryLobby: [params: { title: string; sortCategory?: string }]
}>()
const { t } = useI18n()
const auth = useAuthStore()
const { isLoggedIn } = storeToRefs(auth)

const bingoGames = ref<SlotGame[]>([])
const launchingUuid = ref<string | null>(null)
const peryaScroll = ref<HTMLElement | null>(null)
const moreScroll  = ref<HTMLElement | null>(null)
function scrollRow(el: HTMLElement | null, dir: -1 | 1) {
  el?.scrollBy({ left: dir * 148, behavior: 'smooth' })
}

const heroGame = computed(() => bingoGames.value[0] ?? null)
const subGames = computed(() => bingoGames.value.slice(1, 5))
const marqueeWinners = computed(() => [...PERYA_WINNERS, ...PERYA_WINNERS])


// 按厂商分配兜底色对（给 GameImageCard fallbackBg 用）
const providerFallback: Record<string, [string, string]> = {
  JiliGames:    ['#4c0091', '#7c3aed'],
  PragmaticPlay:['#065f46', '#059669'],
  Caleta:       ['#1e3a8a', '#2563eb'],
}
function cardFallback(provider: string): [string, string] {
  return providerFallback[provider] ?? ['#1e293b', '#334155']
}

// 大卡左侧渐变色（与各厂商配色协调）
const providerHeroLeft: Record<string, string> = {
  JiliGames: '#0e0024',
  PragmaticPlay: '#021a10',
  Caleta: '#050e2a',
}
function heroLeftColor(provider: string): string {
  return providerHeroLeft[provider] ?? '#0e1117'
}

const fiestaBuntingColors = [
  '#FFB800', '#ec4899', '#34d399', '#60a5fa', '#f97316', '#a855f7',
  '#FFB800', '#ef4444', '#FFB800', '#ec4899', '#34d399', '#60a5fa',
  '#f97316', '#a855f7', '#FFB800', '#ef4444',
] as const

async function onPlayGame(uuid: string) {
  if (!isLoggedIn.value) {
    emit('gameTap')
    return
  }
  launchingUuid.value = uuid
  try {
    const { url } = await launchGame(uuid)
    emit('openGame', url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Failed to launch game')
  } finally {
    launchingUuid.value = null
  }
}

onMounted(async () => {
  try {
    const res = await fetchGames({ sortCategory: 'bingo', sortBy: 'ph_bonus', limit: 8 })
    bingoGames.value = res.items
  } catch {
    // 静默失败
  }
})
</script>

<template>
  <div class="page-main">
    <!-- Hero -->
    <PeryaCarnivalHero>
      <p class="text-amber-300 text-[10px] font-black uppercase tracking-widest mb-1">🎪 {{ t('bingo.carnival') }}</p>
      <h1
        class="font-black leading-none mb-1 font-display text-[2.6rem]"
        style="text-shadow: 0 2px 20px rgba(168, 85, 247, 0.6)"
      >
        <span class="text-white">{{ t('bingo.titlePerya') }}</span>
        <span class="text-primary">{{ t('bingo.titleAnd') }}</span>
        <span style="color: #ec4899">{{ t('bingo.titleBingo') }}</span>
      </h1>
      <p class="text-white/40 text-xs leading-relaxed">{{ t('bingo.heroSub') }}</p>
      <div
        class="flex items-center gap-2 mt-4 bg-black/35 rounded-xl px-3 py-2 overflow-hidden"
        style="border: 1px solid rgba(255, 184, 0, 0.14)"
      >
        <div class="flex items-center gap-1 flex-shrink-0">
          <Trophy :size="11" class="text-primary" />
          <span class="text-primary text-[10px] font-black uppercase tracking-wide">{{ t('bingo.winners') }}</span>
        </div>
        <div class="w-px h-3 bg-white/10 flex-shrink-0" />
        <div class="overflow-hidden flex-1">
          <div class="flex gap-5 animate-marquee whitespace-nowrap" style="animation-duration: 16s">
            <span v-for="(w, i) in marqueeWinners" :key="i" class="text-[11px] flex-shrink-0">
              <span class="text-primary font-bold">{{ w.name }}</span>
              <span class="text-white/40"> {{ t('common.won') }} </span>
              <span class="text-emerald-400 font-bold">{{ w.amount }}</span>
              <span class="text-white/25"> · {{ w.game }}</span>
            </span>
          </div>
        </div>
      </div>
    </PeryaCarnivalHero>

    <!-- Jackpot banner -->
    <div
      class="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3"
      style="background: linear-gradient(90deg, #2d1800, #1a0d40); border: 1px solid rgba(255, 184, 0, 0.25); box-shadow: 0 4px 20px rgba(255, 184, 0, 0.12)"
    >
      <span class="text-2xl">🏆</span>
      <div class="flex-1">
        <p class="text-primary text-[10px] font-black uppercase tracking-widest leading-none">Today's Jackpot</p>
        <p class="text-white font-black text-xl leading-tight font-display">₱ 1,200,000</p>
      </div>
      <button
        type="button"
        class="bg-primary text-primary-foreground font-black text-xs px-4 py-2 rounded-xl shadow shadow-amber-500/25 flex-shrink-0"
        @click="emit('openWallet')"
      >
        JOIN NOW
      </button>
    </div>

    <!-- ── SIGNATURE GAMES（方案A：图文左右分割） ── -->
    <div v-if="heroGame" class="px-4 mt-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-base">🎪</span>
        <h2 class="text-white font-black text-base font-display">SIGNATURE GAMES</h2>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- 大卡：左文右图 -->
        <button
          type="button"
          class="col-span-2 relative rounded-3xl overflow-hidden h-40 text-left active:scale-[0.98] transition-transform"
          :disabled="launchingUuid === heroGame.uuid"
          @click="onPlayGame(heroGame.uuid)"
        >
          <!-- 整体底色 -->
          <div
            class="absolute inset-0"
            :style="{ background: `linear-gradient(to right, ${heroLeftColor(heroGame.provider)} 45%, #2a0060 100%)` }"
          />
          <!-- 右侧图片 + 向左渐隐 -->
          <div class="absolute right-0 top-0 bottom-0 w-[55%]">
            <img
              v-if="heroGame.imageHqUrl || heroGame.imageUrl"
              :src="(heroGame.imageHqUrl || heroGame.imageUrl)!"
              class="w-full h-full object-cover object-center"
            />
            <div
              class="absolute inset-0"
              :style="{ background: `linear-gradient(to right, ${heroLeftColor(heroGame.provider)} 0%, transparent 55%)` }"
            />
          </div>
          <!-- 左侧文字 -->
          <div class="absolute inset-0 p-4 flex flex-col justify-center" style="max-width: 58%">
            <span class="text-[9px] font-black px-2 py-0.5 rounded-full mb-2 self-start bg-[#FFB800] text-black">
              JACKPOT
            </span>
            <h3 class="text-white font-black leading-tight font-display text-2xl">{{ heroGame.name }}</h3>
            <p class="text-white/50 text-xs mt-0.5">{{ heroGame.provider }}</p>
            <div class="flex items-center gap-1 mt-2">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span class="text-white/50 text-[11px]">{{ (heroGame.weight * 12 + 800).toLocaleString() }} playing</span>
            </div>
          </div>
        </button>

        <!-- 小卡：上图下渐变信息栏 -->
        <button
          v-for="g in subGames"
          :key="g.uuid"
          type="button"
          class="rounded-3xl overflow-hidden h-36 active:scale-[0.98] transition-transform"
          :disabled="launchingUuid === g.uuid"
          @click="onPlayGame(g.uuid)"
        >
          <GameImageCard
            :image-url="g.imageHqUrl ?? g.imageUrl"
            :fallback-bg="cardFallback(g.provider)"
            :name="g.name"
            :provider="g.provider"
          />
        </button>
      </div>
    </div>

    <!-- ── PERYA CLASSICS（横向滚动一行） ── -->
    <div class="mt-6">
      <div class="flex items-center justify-between mb-3 px-4">
        <div class="flex items-center gap-2">
          <span class="text-base">🎡</span>
          <h2 class="text-white font-black text-base font-display">PERYA CLASSICS</h2>
        </div>
        <div class="flex items-center gap-0.5">
          <button type="button" class="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 text-white/60 active:scale-90 transition-transform" @click="scrollRow(peryaScroll, -1)"><ChevronLeft :size="13" /></button>
          <button type="button" class="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 text-white/60 active:scale-90 transition-transform" @click="scrollRow(peryaScroll, 1)"><ChevronRight :size="13" /></button>
        </div>
      </div>
      <div ref="peryaScroll" class="flex gap-2.5 overflow-x-auto px-4 pb-2 scrollbar-hide snap-x snap-mandatory">
        <button
          v-for="g in PINOY_CLASSICS"
          :key="g.uuid"
          type="button"
          class="flex-shrink-0 h-44 rounded-xl overflow-hidden active:scale-95 transition-transform snap-start"
          style="width: calc((100vw - 52px) / 3)"
          :disabled="launchingUuid === g.uuid"
          @click="onPlayGame(g.uuid)"
        >
          <GameImageCard
            variant="mirror"
            image-position="top"
            :image-url="g.imageUrl"
            :fallback-bg="g.bg"
            :name="g.name"
            :provider="g.provider"
          />
        </button>
      </div>
    </div>

    <!-- ── MORE PINOY GAMES（横向滚动一行 + See All） ── -->
    <div class="mt-6">
      <div class="flex items-center justify-between mb-3 px-4">
        <div class="flex items-center gap-2">
          <span class="text-base">🐓</span>
          <h2 class="text-white font-black text-base font-display">MORE PINOY GAMES</h2>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 text-primary active:scale-90 transition-transform" @click="emit('openCategoryLobby', { title: '🇵🇭 All Pinoy Games', sortCategory: 'pinoy' })"><LayoutGrid :size="13" /></button>
          <div class="flex items-center gap-0.5">
            <button type="button" class="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 text-white/60 active:scale-90 transition-transform" @click="scrollRow(moreScroll, -1)"><ChevronLeft :size="13" /></button>
            <button type="button" class="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 text-white/60 active:scale-90 transition-transform" @click="scrollRow(moreScroll, 1)"><ChevronRight :size="13" /></button>
          </div>
        </div>
      </div>
      <div ref="moreScroll" class="flex gap-2.5 overflow-x-auto px-4 pb-2 scrollbar-hide snap-x snap-mandatory">
        <button
          v-for="g in MORE_PINOY_GAMES"
          :key="g.uuid"
          type="button"
          class="flex-shrink-0 h-44 rounded-xl overflow-hidden active:scale-95 transition-transform snap-start"
          style="width: calc((100vw - 52px) / 3)"
          :disabled="launchingUuid === g.uuid"
          @click="onPlayGame(g.uuid)"
        >
          <GameImageCard
            variant="mirror"
            image-position="top"
            :image-url="g.imageUrl"
            :fallback-bg="g.bg"
            :name="g.name"
            :provider="g.provider"
          />
        </button>
      </div>
    </div>

    <!-- Fiesta Special -->
    <div
      class="mx-4 mt-5 rounded-2xl overflow-hidden relative"
      style="background: linear-gradient(135deg, #1a004a, #3b0020); border: 1px solid rgba(236, 72, 153, 0.2)"
    >
      <div
        class="absolute inset-0 pointer-events-none"
        style="background: radial-gradient(ellipse at 80% 50%, rgba(236, 72, 153, 0.12) 0%, transparent 65%)"
      />
      <div class="absolute top-0 inset-x-0 overflow-hidden flex" style="height: 8px">
        <span
          v-for="(c, i) in fiestaBuntingColors"
          :key="i"
          class="inline-block flex-shrink-0"
          :style="{ width: '14px', height: '8px', background: c, clipPath: 'polygon(0 0, 100% 0, 50% 100%)', opacity: 0.8 }"
        />
      </div>
      <div class="relative px-4 pt-5 pb-4 flex items-center gap-3">
        <div class="text-4xl">🎉</div>
        <div class="flex-1">
          <p class="text-pink-300 text-[10px] font-black uppercase tracking-widest">Fiesta Special</p>
          <p class="text-white font-black text-lg leading-tight font-display">
            DAILY FREE BINGO<br />
            <span class="text-primary">Every 6PM</span>
          </p>
        </div>
        <button
          type="button"
          class="flex-shrink-0 bg-pink-500 hover:bg-pink-400 text-white font-black text-xs px-4 py-2.5 rounded-xl transition-colors shadow shadow-pink-500/30"
          @click="emit('openWallet')"
        >
          LIBRE!
        </button>
      </div>
    </div>

    <!-- Powered by -->
    <div class="px-4 mt-5 mb-4">
      <p class="text-muted-foreground text-[10px] uppercase tracking-widest font-black mb-3">Powered by</p>
      <div class="flex gap-2 flex-wrap">
        <span
          v-for="p in ['JILI', 'PRAGMATIC', 'CALETA', 'RICH88', 'JDB', 'SPRIBE']"
          :key="p"
          class="text-[10px] font-black text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border"
        >
          {{ p }}
        </span>
      </div>
    </div>
  </div>
</template>
