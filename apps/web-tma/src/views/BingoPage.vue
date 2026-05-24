<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trophy } from 'lucide-vue-next'
import PeryaCarnivalHero from '@/components/bingo/PeryaCarnivalHero.vue'
import { PERYA_GRID, PERYA_MAIN, PERYA_WINNERS } from '@/data/bingo'

const emit = defineEmits<{ openWallet: []; gameTap: [] }>()
const { t } = useI18n()

const heroGame = computed(() => PERYA_MAIN[0]!)
const otherGames = computed(() => PERYA_MAIN.slice(1))
const marqueeWinners = computed(() => [...PERYA_WINNERS, ...PERYA_WINNERS])

const fiestaBuntingColors = [
  '#FFB800',
  '#ec4899',
  '#34d399',
  '#60a5fa',
  '#f97316',
  '#a855f7',
  '#FFB800',
  '#ef4444',
  '#FFB800',
  '#ec4899',
  '#34d399',
  '#60a5fa',
  '#f97316',
  '#a855f7',
  '#FFB800',
  '#ef4444',
] as const
</script>

<template>
  <div class="page-scroll pb-20 hide-scrollbar">
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

    <div class="px-4 mt-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-base">🎪</span>
        <h2 class="text-white font-black text-base font-display">SIGNATURE GAMES</h2>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          class="col-span-2 relative rounded-3xl overflow-hidden h-40 text-left active:scale-[0.98] transition-transform"
          :style="{ boxShadow: `0 6px 28px ${heroGame.glow}33` }"
          @click="emit('gameTap')"
        >
          <div
            class="absolute inset-0"
            :style="{ background: `linear-gradient(135deg, ${heroGame.bg[0]}, ${heroGame.bg[1]}, ${heroGame.bg[2]})` }"
          />
          <template v-if="heroGame.stars">
            <div
              v-for="i in 6"
              :key="i"
              class="absolute rounded-full"
              :style="{
                width: `${3 + (i % 3)}px`,
                height: `${3 + (i % 3)}px`,
                background: '#fff',
                opacity: 0.15 + i * 0.04,
                top: `${10 + i * 14}%`,
                left: `${55 + i * 7}%`,
              }"
            />
          </template>
          <div class="absolute inset-0 p-4 flex items-center gap-4">
            <div>
              <span
                class="text-[9px] font-black px-2 py-0.5 rounded-full mb-2 inline-block"
                :style="{ background: heroGame.tagBg, color: heroGame.tagFg }"
              >
                {{ heroGame.tag }}
              </span>
              <h3 class="text-white font-black leading-none font-display text-[1.7rem]">{{ heroGame.label }}</h3>
              <p class="text-white/60 text-xs font-semibold mt-0.5">{{ heroGame.sub }}</p>
              <div class="flex items-center gap-3 mt-2">
                <div class="flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span class="text-white/60 text-[11px]">{{ heroGame.players.toLocaleString() }} playing</span>
                </div>
                <span class="font-black text-base font-display" :style="{ color: heroGame.glow }">{{ heroGame.prize }}</span>
              </div>
            </div>
            <div class="ml-auto text-6xl opacity-90">{{ heroGame.emoji }}</div>
          </div>
        </button>

        <button
          v-for="g in otherGames"
          :key="g.id"
          type="button"
          class="relative rounded-3xl overflow-hidden h-36 text-left active:scale-[0.98] transition-transform"
          :style="{ boxShadow: `0 4px 20px ${g.glow}25` }"
          @click="emit('gameTap')"
        >
          <div
            class="absolute inset-0"
            :style="{ background: `linear-gradient(135deg, ${g.bg[0]}, ${g.bg[1]}, ${g.bg[2]})` }"
          />
          <div
            class="absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-20"
            :style="{ background: g.glow }"
          />
          <div class="absolute inset-0 p-3.5 flex flex-col justify-between">
            <div class="flex items-start justify-between">
              <span
                class="text-[9px] font-black px-2 py-0.5 rounded-full"
                :style="{ background: g.tagBg, color: g.tagFg }"
              >
                {{ g.tag }}
              </span>
              <span class="text-3xl">{{ g.emoji }}</span>
            </div>
            <div>
              <h3 class="text-white font-black leading-none text-base font-display">{{ g.label }}</h3>
              <p class="text-white/50 text-[10px] mt-0.5">{{ g.sub }}</p>
              <div class="flex items-center justify-between mt-1.5">
                <div class="flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span class="text-white/50 text-[10px]">{{ g.players.toLocaleString() }}</span>
                </div>
                <span class="font-black text-sm font-display" :style="{ color: g.glow }">{{ g.prize }}</span>
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>

    <div class="px-4 mt-6">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-base">🎡</span>
        <h2 class="text-white font-black text-base font-display">MORE PINOY GAMES</h2>
      </div>
      <div class="grid grid-cols-3 gap-2.5">
        <button
          v-for="g in PERYA_GRID"
          :key="g.id"
          type="button"
          class="relative rounded-2xl overflow-hidden h-24 text-left active:scale-95 transition-transform"
          @click="emit('gameTap')"
        >
          <div class="absolute inset-0" :style="{ background: `linear-gradient(135deg, ${g.bg[0]}, ${g.bg[1]})` }" />
          <div class="absolute inset-0 flex flex-col justify-between p-2.5">
            <div class="flex justify-between items-start">
              <span class="text-[8px] font-black bg-black/30 text-white/70 px-1.5 py-0.5 rounded-full leading-none">{{ g.tag }}</span>
              <span class="text-[22px]">{{ g.emoji }}</span>
            </div>
            <div>
              <p class="text-white font-black text-xs leading-none font-display">{{ g.label }}</p>
              <p class="text-white/40 text-[9px] mt-0.5">{{ g.players.toLocaleString() }} online</p>
            </div>
          </div>
        </button>
      </div>
    </div>

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
          :style="{
            width: '14px',
            height: '8px',
            background: c,
            clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
            opacity: 0.8,
          }"
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

    <div class="px-4 mt-5 mb-4">
      <p class="text-muted-foreground text-[10px] uppercase tracking-widest font-black mb-3">Powered by</p>
      <div class="flex gap-2 flex-wrap">
        <span
          v-for="p in ['JILI', 'EVOLUTION', 'BGAMING', 'PRAGMATIC', 'SPRIBE', 'BINGO+']"
          :key="p"
          class="text-[10px] font-black text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border"
        >
          {{ p }}
        </span>
      </div>
    </div>
  </div>
</template>
