<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ChevronRight, Play, Tv2 } from 'lucide-vue-next'
import { fetchGames, launchGame, launchDemo, type SlotGame } from '@/api/slots'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{
  openLobby: []
  gameTap: []
}>()

const { t } = useI18n()
const auth = useAuthStore()
const { isLoggedIn } = storeToRefs(auth)

const games = ref<SlotGame[]>([])
const loading = ref(true)
const launchingUuid = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await fetchGames({ limit: 9 })
    games.value = res.items
  } catch {
    // Silent fail — section just won't show
  } finally {
    loading.value = false
  }
})

async function onPlay(uuid: string) {
  if (!isLoggedIn.value) {
    emit('gameTap')
    return
  }
  launchingUuid.value = uuid
  try {
    const { url } = await launchGame(uuid)
    openGameUrl(url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Launch failed')
  } finally {
    launchingUuid.value = null
  }
}

async function onDemo(uuid: string) {
  launchingUuid.value = uuid
  try {
    const { url } = await launchDemo(uuid)
    openGameUrl(url)
  } catch (e) {
    alert(e instanceof ApiError ? e.message : 'Launch failed')
  } finally {
    launchingUuid.value = null
  }
}

function openGameUrl(url: string) {
  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
</script>

<template>
  <!-- Only render if we have games (hides when SG not configured) -->
  <section v-if="loading || games.length > 0" class="mt-5">
    <div class="mb-3 flex items-center justify-between px-4">
      <h3 class="text-xs font-black uppercase tracking-wider text-foreground">
        {{ t('slots.sectionTitle') }}
      </h3>
      <button
        type="button"
        class="flex items-center gap-0.5 text-[11px] font-bold text-primary"
        @click="emit('openLobby')"
      >
        {{ t('slots.seeAll') }}
        <ChevronRight :size="13" />
      </button>
    </div>

    <!-- Skeleton -->
    <div v-if="loading" class="grid grid-cols-3 gap-2 px-4">
      <div v-for="n in 9" :key="n" class="aspect-[4/3] animate-pulse rounded-xl bg-secondary" />
    </div>

    <!-- Grid -->
    <div v-else class="grid grid-cols-3 gap-2 px-4">
      <div
        v-for="game in games"
        :key="game.uuid"
        class="group relative overflow-hidden rounded-xl bg-card border border-border"
      >
        <!-- Image -->
        <div class="relative aspect-[4/3] overflow-hidden bg-secondary">
          <img
            v-if="game.imageUrl"
            :src="game.imageUrl"
            :alt="game.name"
            class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
          <div v-else class="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 to-purple-900">
            <span class="text-xl">🎰</span>
          </div>
          <span class="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-bold uppercase text-white/80">
            {{ game.provider }}
          </span>
          <!-- Hover overlay -->
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              class="flex w-4/5 items-center justify-center gap-1 rounded-full bg-primary py-1.5 text-[11px] font-bold text-primary-foreground"
              :disabled="launchingUuid === game.uuid"
              @click.stop="onPlay(game.uuid)"
            >
              <Play :size="10" />
              Play
            </button>
            <button
              v-if="game.hasDemo"
              type="button"
              class="flex w-4/5 items-center justify-center gap-1 rounded-full bg-white/20 py-1.5 text-[11px] font-semibold text-white"
              :disabled="launchingUuid === game.uuid"
              @click.stop="onDemo(game.uuid)"
            >
              <Tv2 :size="10" />
              Demo
            </button>
          </div>
        </div>
        <!-- Name -->
        <div class="px-2 py-1">
          <p class="truncate text-[10px] font-semibold text-foreground">{{ game.name }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
