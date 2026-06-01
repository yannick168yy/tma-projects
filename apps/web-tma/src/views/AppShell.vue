<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import {
  ChevronDown,
  Wallet,
  Gift,
  Home,
  Menu,
  Dices,
  Headphones,
} from 'lucide-vue-next'
import BetogoLogo from '@/components/BetogoLogo.vue'
import ProfileAvatar from '@/components/ProfileAvatar.vue'
import WalletModal from '@/components/wallet/WalletModal.vue'
import SearchOverlay from '@/components/search/SearchOverlay.vue'
import HomeContent from '@/views/HomeContent.vue'
import BonusesPage from '@/views/BonusesPage.vue'
import BingoPage from '@/views/BingoPage.vue'
import MenuPage from '@/views/MenuPage.vue'
import ProfilePage from '@/views/ProfilePage.vue'
import SlotsLobby from '@/views/SlotsLobby.vue'
import CustomerServicePage from '@/views/CustomerServicePage.vue'
import { NAV_ITEMS } from '@/data/home'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import GamePlayer from '@/components/GamePlayer.vue'

const { t } = useI18n()
const auth = useAuthStore()
const wallet = useWalletStore()
const { isLoggedIn } = storeToRefs(auth)
const { displayPhp } = storeToRefs(wallet)

type NavId = (typeof NAV_ITEMS)[number]['id']

type CategoryLobbyParams = {
  title: string
  sortCategory?: string
  sortBy?: 'weight' | 'ph_bonus'
  themes?: string[]
  gameStyles?: string[]
  playerTypes?: string[]
}

const activeNav = ref<NavId>('casino')
const promoFilter = ref<string | null>(null)
const searchOpen = ref(false)
const balanceVisible = ref(true)
const walletOpen = ref(false)
const walletModalOpen = ref(false)
const profileOpen = ref(false)
const slotsLobbyOpen = ref(false)
const categoryLobbyOpen = ref(false)
const categoryLobbyParams = ref<CategoryLobbyParams | null>(null)
const csOpen = ref(false)
const gamePlayerUrl = ref<string | null>(null)

// 动态测量 header/nav 高度，用于 main 的 padding
const headerRef = ref<HTMLElement | null>(null)
const navRef = ref<HTMLElement | null>(null)
const mainRef = ref<HTMLElement | null>(null)
const headerH = ref(80)
const navH = ref(64)
let ro: ResizeObserver | null = null

function closeOverlayPanels() {
  walletOpen.value = false
}

const mainStyle = computed(() => {
  const top = `${headerH.value}px`
  if (profileOpen.value) {
    // 高度只减去顶栏；底栏由 fixed nav 覆盖，勿再 paddingBottom（否则会多出一条挡内容的底色带）
    return {
      paddingTop: top,
      paddingBottom: '0',
      height: `calc(100dvh - ${headerH.value}px)`,
      maxHeight: `calc(100dvh - ${headerH.value}px)`,
    }
  }
  return {
    paddingTop: top,
    paddingBottom: `${navH.value}px`,
  }
})

function openGame(url: string) {
  gamePlayerUrl.value = url
}

function openCs() {
  profileOpen.value = false
  walletOpen.value = false
  csOpen.value = true
}

const navItems = computed(() =>
  NAV_ITEMS.map((item) => ({
    ...item,
    label: t(`nav.${item.id}`),
  })),
)

async function openWallet() {
  if (!(await auth.ensureLoggedIn(t('auth.signInDepositWithdraw')))) return
  walletOpen.value = false
  walletModalOpen.value = true
}

async function onBalanceTap() {
  if (!auth.isLoggedIn) {
    await auth.ensureLoggedIn(t('auth.signInBalance'))
    return
  }
  if (!walletOpen.value) void wallet.refresh()
  walletOpen.value = !walletOpen.value
}

async function openProfile() {
  if (!(await auth.ensureLoggedIn(t('auth.signInProfile')))) return
  closeOverlayPanels()
  searchOpen.value = false
  slotsLobbyOpen.value = false
  categoryLobbyOpen.value = false
  profileOpen.value = true
  requestAnimationFrame(() => {
    mainRef.value?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0, behavior: 'instant' })
  })
}

async function onGameTap() {
  await auth.ensureLoggedIn(t('auth.signInPlay'))
}

function goBonuses(promo: string | null = null) {
  promoFilter.value = promo
  activeNav.value = 'bonuses'
  profileOpen.value = false
}

function setNav(id: NavId) {
  if (id === 'cashier') {
    openWallet()
    return
  }
  activeNav.value = id
  profileOpen.value = false
  searchOpen.value = false
  slotsLobbyOpen.value = false
  categoryLobbyOpen.value = false
  if (id !== 'bonuses') promoFilter.value = null
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function goHome() {
  activeNav.value = 'casino'
  profileOpen.value = false
  searchOpen.value = false
  slotsLobbyOpen.value = false
  categoryLobbyOpen.value = false
  promoFilter.value = null
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function openSearch() {
  closeOverlayPanels()
  profileOpen.value = false
  searchOpen.value = true
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function openSlotsLobby() {
  closeOverlayPanels()
  profileOpen.value = false
  slotsLobbyOpen.value = true
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function closeSlotsLobby() {
  slotsLobbyOpen.value = false
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function closeCategoryLobby() {
  categoryLobbyOpen.value = false
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function closeSearch() {
  searchOpen.value = false
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function openCategoryLobby(params: CategoryLobbyParams) {
  closeOverlayPanels()
  profileOpen.value = false
  categoryLobbyParams.value = params
  categoryLobbyOpen.value = true
  window.scrollTo({ top: 0, behavior: 'instant' })
}

watch(profileOpen, (open) => {
  if (open) closeOverlayPanels()
})

function onLogout() {
  profileOpen.value = false
  walletOpen.value = false
  walletModalOpen.value = false
}

onMounted(() => {
  ro = new ResizeObserver(() => {
    if (headerRef.value) headerH.value = headerRef.value.offsetHeight
    if (navRef.value) navH.value = navRef.value.offsetHeight
  })
  if (headerRef.value) ro.observe(headerRef.value)
  if (navRef.value) ro.observe(navRef.value)

  /** Dev-only: ?figma=search|wallet|profile for Figma capture screenshots */
  if (!import.meta.env.DEV) return
  const preset = new URLSearchParams(window.location.search).get('figma')
  if (preset === 'search') searchOpen.value = true
  if (preset === 'wallet') walletModalOpen.value = true
  if (preset === 'profile') profileOpen.value = true
})

onUnmounted(() => ro?.disconnect())

function navIcon(id: string) {
  switch (id) {
    case 'cashier':
      return Wallet
    case 'bingo':
      return Dices
    case 'bonuses':
      return Gift
    case 'casino':
      return Home
    default:
      return Menu
  }
}
</script>

<template>
  <div class="flex w-full justify-center bg-[#040609]">
    <div class="app-frame w-full max-w-[430px] bg-background">
      <header ref="headerRef" class="app-fixed-top bg-background">
        <div class="app-safe-header flex items-center gap-3 px-4 pb-4">
          <button type="button" class="flex-shrink-0 cursor-pointer" @click="goHome">
            <BetogoLogo />
          </button>

          <div class="flex flex-1 items-center justify-center gap-3">
            <button type="button" class="flex flex-col items-center gap-0.5" @click="onBalanceTap">
              <span class="flex items-center gap-1 text-[11px] font-semibold leading-none text-muted-foreground">
                {{ isLoggedIn ? 'PHP' : t('shell.signIn') }}
                <ChevronDown
                  v-if="isLoggedIn"
                  :size="11"
                  class="transition-transform duration-200"
                  :class="walletOpen ? 'rotate-180' : ''"
                />
              </span>
              <span class="text-base font-black leading-tight text-white">
                {{ isLoggedIn ? (balanceVisible ? displayPhp : '₱ ••••••') : t('shell.tapToLogin') }}
              </span>
            </button>
            <button
              v-if="isLoggedIn"
              type="button"
              class="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400"
              @click="openWallet"
            >
              {{ t('shell.topUp') }}
            </button>
          </div>

          <button type="button"
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary transition-colors"
            @click="openCs">
            <Headphones :size="20" />
          </button>
          <button type="button" class="relative flex-shrink-0" @click="openProfile">
            <ProfileAvatar />
            <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent" />
          </button>
        </div>

        <template v-if="walletOpen && isLoggedIn">
          <div class="fixed inset-0 z-40" @click="walletOpen = false" />
          <div
            class="absolute left-4 right-4 top-full z-50 -mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div class="p-4">
              <p class="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">{{ t('shell.myWallet') }}</p>
              <div class="flex items-center justify-between border-b border-border py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <span class="text-sm font-black text-primary">₱</span>
                  </div>
                  <div>
                    <p class="text-sm font-bold text-foreground">{{ t('shell.philippinePeso') }}</p>
                    <p class="text-xs text-muted-foreground">PHP</p>
                  </div>
                </div>
                <span class="text-base font-black text-primary">
                  {{ balanceVisible ? (wallet.balance?.availableCents ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '••••••' }}
                </span>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
                    <span class="text-sm font-black text-muted-foreground">₮</span>
                  </div>
                  <div>
                    <p class="text-sm font-bold text-foreground">{{ t('shell.tetherUsd') }}</p>
                    <p class="text-xs text-muted-foreground">USDT · Coming Soon</p>
                  </div>
                </div>
                <span class="text-sm font-bold text-muted-foreground">—</span>
              </div>
            </div>
            <div class="flex gap-2 px-4 pb-4">
              <button
                type="button"
                class="flex-1 rounded-xl bg-secondary py-2 text-xs font-bold text-muted-foreground"
                @click="balanceVisible = !balanceVisible"
              >
                {{ balanceVisible ? t('shell.hideBalances') : t('shell.showBalances') }}
              </button>
              <button
                type="button"
                class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-yellow-400"
                @click="openWallet"
              >
                <Wallet :size="13" />
                {{ t('shell.wallet') }}
              </button>
            </div>
          </div>
        </template>
      </header>

      <main
        ref="mainRef"
        :class="profileOpen ? 'page-scroll hide-scrollbar overflow-x-hidden' : 'relative overflow-x-clip'"
        :style="mainStyle"
      >
        <SearchOverlay v-if="searchOpen" @close="closeSearch" @game-tap="onGameTap" @open-game="openGame" />
        <SlotsLobby v-else-if="slotsLobbyOpen" @close="closeSlotsLobby" @game-tap="onGameTap" @open-game="openGame" />
        <SlotsLobby
          v-else-if="categoryLobbyOpen && categoryLobbyParams"
          :sort-category="categoryLobbyParams.sortCategory"
          :sort-by="categoryLobbyParams.sortBy"
          :title="categoryLobbyParams.title"
          :themes="categoryLobbyParams.themes"
          :game-styles="categoryLobbyParams.gameStyles"
          :player-types="categoryLobbyParams.playerTypes"
          @close="closeCategoryLobby"
          @game-tap="onGameTap"
          @open-game="openGame"
        />
        <ProfilePage v-else-if="profileOpen" @logout="onLogout" @open-cs="openCs" />
        <BonusesPage v-else-if="activeNav === 'bonuses'" :promo-filter="promoFilter" @open-wallet="openWallet" />
        <BingoPage v-else-if="activeNav === 'bingo'" @open-wallet="openWallet" @game-tap="onGameTap" @open-game="openGame" @open-category-lobby="openCategoryLobby" />
        <MenuPage v-else-if="activeNav === 'menu'" @open-search="openSearch" @open-cs="openCs" @open-category-lobby="openCategoryLobby" />
        <HomeContent
          v-else
          @open-search="openSearch"
          @open-promo="goBonuses"
          @game-tap="onGameTap"
          @open-slots-lobby="openSlotsLobby"
          @open-category-lobby="openCategoryLobby"
          @open-cs="openCs"
          @open-game="openGame"
        />
      </main>

      <nav
        ref="navRef"
        class="app-fixed-bottom app-safe-nav flex items-center justify-around border-t border-border bg-background px-2 pt-2"
      >
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors"
          :class="activeNav === item.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          @click="setNav(item.id)"
        >
          <span
            v-if="activeNav === item.id"
            class="absolute -top-2 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-primary"
          />
          <div :class="activeNav === item.id ? 'rounded-xl bg-primary/10 p-1.5' : 'p-1.5'">
            <component :is="navIcon(item.id)" :size="20" />
          </div>
          <span
            v-if="'badge' in item && item.badge"
            class="absolute right-1 top-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white"
          >
            {{ item.badge }}
          </span>
          <span class="text-[10px] font-bold leading-none">{{ item.label }}</span>
        </button>
      </nav>
    </div>

    <WalletModal :open="walletModalOpen" @close="walletModalOpen = false" />

    <!-- 客服聊天覆盖层：fixed 相对视口，不受页面滚动影响 -->
    <div v-if="csOpen" class="fixed inset-0 z-[60] flex justify-center">
      <div class="w-full max-w-[430px] bg-background flex flex-col overflow-hidden">
        <CustomerServicePage @close="csOpen = false" />
      </div>
    </div>

    <!-- 游戏内嵌覆盖层 -->
    <GamePlayer v-if="gamePlayerUrl" :url="gamePlayerUrl" @close="gamePlayerUrl = null" />
  </div>
</template>

<style scoped>
.app-frame {
  min-height: 100dvh;
  touch-action: pan-y;
  box-sizing: border-box;
}
</style>
