<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, ChevronLeft, ChevronRight, ChevronDown, Flame, Headphones, CheckCircle2 } from 'lucide-vue-next'
import { LANGUAGES, MENU_DATA } from '@/data/menu'

const emit = defineEmits<{ openSearch: [] }>()

const active = ref<{ sid: string; cid: string } | null>(null)
const langOpen = ref(false)
const lang = ref('en')

const currentLang = computed(() => LANGUAGES.find((l) => l.code === lang.value)!)
const activeSection = computed(() => (active.value ? MENU_DATA.find((s) => s.id === active.value!.sid) : null))
const activeCat = computed(() =>
  active.value && activeSection.value
    ? activeSection.value.subcats.find((c) => c.id === active.value!.cid)
    : null,
)
</script>

<template>
  <div class="page-scroll pb-24 hide-scrollbar">
    <div class="px-4 pt-3 pb-2">
      <button
        type="button"
        class="w-full flex items-center gap-2.5 bg-secondary border border-border rounded-xl px-3.5 py-2.5 text-left"
        @click="emit('openSearch')"
      >
        <Search :size="14" class="text-muted-foreground flex-shrink-0" />
        <span class="text-muted-foreground/50 text-sm">Search any game…</span>
      </button>
    </div>

    <div v-if="activeCat && activeSection" class="px-4 pt-2">
      <button type="button" class="flex items-center gap-1 mb-3 text-muted-foreground" @click="active = null">
        <ChevronLeft :size="13" />
        <span class="text-[11px] font-bold" :style="{ color: activeSection.dot }">{{ activeSection.label }}</span>
        <span class="text-muted-foreground/40 text-[11px] mx-0.5">›</span>
        <span class="text-[11px] font-bold text-foreground">{{ activeCat.label }}</span>
      </button>
      <div class="relative rounded-2xl overflow-hidden mb-4 bg-gradient-to-br px-4 py-3.5" :class="activeCat.gradient">
        <div class="absolute inset-0 bg-black/15" />
        <div class="relative flex items-center gap-3">
          <span class="text-[30px]">{{ activeCat.icon }}</span>
          <div>
            <p class="text-white/50 text-[10px] font-bold uppercase tracking-widest">{{ activeSection.label }}</p>
            <h2 class="text-white font-black text-lg leading-none font-display">{{ activeCat.label.toUpperCase() }}</h2>
            <p class="text-white/50 text-[10px] mt-0.5">{{ activeCat.games.length }} games</p>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <button
          v-for="(game, i) in activeCat.games"
          :key="i"
          type="button"
          class="relative rounded-2xl overflow-hidden flex flex-col justify-end active:scale-95 transition-transform aspect-[3/4]"
        >
          <div class="absolute inset-0 bg-gradient-to-br" :class="activeCat.gradient" />
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-[32px]">{{ game.icon }}</span>
          </div>
          <div
            v-if="game.hot"
            class="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"
          >
            <Flame :size="8" class="text-white" />
            <span class="text-white text-[8px] font-black">HOT</span>
          </div>
          <div class="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
            <p class="text-white font-black text-[10px] leading-tight font-display">{{ game.name.toUpperCase() }}</p>
            <p class="text-white/40 text-[9px]">{{ game.provider }}</p>
          </div>
        </button>
      </div>
    </div>

    <div v-else class="pt-3 pb-2">
      <div v-for="section in MENU_DATA" :key="section.id" class="mb-5">
        <div class="flex items-center gap-2.5 px-5 mb-2">
          <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: section.dot, boxShadow: `0 0 6px ${section.dot}` }" />
          <span class="text-foreground font-black text-base tracking-tight font-display">{{ section.label.toUpperCase() }}</span>
          <span class="flex-1 h-px" :style="{ background: `linear-gradient(90deg, ${section.dot}33, transparent)` }" />
        </div>
        <div class="space-y-1.5 px-4">
          <button
            v-for="(cat, idx) in section.subcats"
            :key="cat.id"
            type="button"
            class="w-full flex items-center gap-3 py-2.5 px-3.5 rounded-2xl active:scale-[0.97] transition-all text-left"
            :style="{
              background: idx % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent',
              marginLeft: idx % 2 !== 0 ? '6px' : '0',
              marginRight: idx % 2 !== 0 ? '-6px' : '0',
            }"
            @click="active = { sid: section.id, cid: cat.id }"
          >
            <div
              class="w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-sm flex-shrink-0"
              :class="cat.gradient"
              :style="{ boxShadow: `0 2px 10px ${cat.color}40` }"
            >
              <span class="text-[17px]">{{ cat.icon }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-foreground font-bold text-[13px] leading-none font-display">{{ cat.label }}</span>
                <span v-if="cat.hot" class="flex items-center gap-0.5 bg-red-500/15 text-red-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">
                  <Flame :size="7" />HOT
                </span>
                <span v-if="cat.isNew" class="bg-emerald-500/15 text-emerald-400 text-[9px] font-black px-1.5 py-0.5 rounded-full">NEW</span>
              </div>
              <span class="text-muted-foreground/60 text-[11px] mt-0.5 block">{{ cat.count }} games</span>
            </div>
            <ChevronRight :size="14" class="text-muted-foreground/40 flex-shrink-0" />
          </button>
        </div>
      </div>

      <div class="px-4 mt-2">
        <div class="flex items-center gap-2.5 mb-2">
          <span class="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" style="box-shadow: 0 0 6px #818cf8" />
          <span class="text-foreground font-black text-base tracking-tight font-display">LANGUAGE</span>
        </div>
        <button
          type="button"
          class="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl bg-white/4 text-left"
          @click="langOpen = !langOpen"
        >
          <span class="text-xl">{{ currentLang.flag }}</span>
          <span class="flex-1 text-foreground font-bold text-sm">{{ currentLang.label }}</span>
          <ChevronDown :size="14" class="text-muted-foreground transition-transform" :class="langOpen ? 'rotate-180' : ''" />
        </button>
        <div v-if="langOpen" class="mt-1.5 rounded-2xl overflow-hidden border border-border bg-card">
          <button
            v-for="(l, i) in LANGUAGES"
            :key="l.code"
            type="button"
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors"
            :class="[i < LANGUAGES.length - 1 ? 'border-b border-border' : '', lang === l.code ? 'bg-primary/8' : '']"
            @click="lang = l.code; langOpen = false"
          >
            <span class="text-lg">{{ l.flag }}</span>
            <span class="text-sm font-bold flex-1" :class="lang === l.code ? 'text-primary' : 'text-foreground'">{{ l.label }}</span>
            <CheckCircle2 v-if="lang === l.code" :size="13" class="text-primary" />
          </button>
        </div>
      </div>

      <div class="px-4 mt-4 mb-1">
        <button
          type="button"
          class="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl border border-emerald-900/30 bg-emerald-950/20"
        >
          <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow shadow-amber-500/20">
            <Headphones :size="16" class="text-primary-foreground" />
          </div>
          <div class="flex-1 text-left">
            <p class="text-foreground font-bold text-sm leading-none">Customer Support</p>
            <div class="flex items-center gap-1.5 mt-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p class="text-emerald-400 text-[11px] font-semibold">Live · 24/7</p>
            </div>
          </div>
          <ChevronRight :size="14" class="text-muted-foreground/50" />
        </button>
      </div>
    </div>
  </div>
</template>
