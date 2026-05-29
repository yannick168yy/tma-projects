<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

const { t } = useI18n()
const auth = useAuthStore()
const wallet = useWalletStore()
const { isLoggedIn } = storeToRefs(auth)
const { displayPhp } = storeToRefs(wallet)

type NavId = (typeof NAV_ITEMS)[number]['id']

const activeNav = ref<NavId>('casino')
const promoFilter = ref<string | null>(null)
const searchOpen = ref(false)
const balanceVisible = ref(true)
const walletOpen = ref(false)
const walletModalOpen = ref(false)
const profileOpen = ref(false)
const slotsLobbyOpen = ref(false)
const csOpen = ref(false)

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
  profileOpen.value = true
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
  if (id !== 'bonuses') promoFilter.value = null
}

function goHome() {
  activeNav.value = 'casino'
  profileOpen.value = false
  promoFilter.value = null
}

function onLogout() {
  profileOpen.value = false
  walletOpen.value = false
  walletModalOpen.value = false
}

/** Dev-only: ?figma=search|wallet|profile for Figma capture screenshots */
onMounted(() => {
  if (!import.meta.env.DEV) return
  const preset = new URLSearchParams(window.location.search).get('figma')
  if (preset === 'search') searchOpen.value = true
  if (preset === 'wallet') walletModalOpen.value = true
  if (preset === 'profile') profileOpen.value = true
})

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
  <div class="flex h-dvh w-full justify-center bg-[#040609]">
    <div class="app-frame relative flex w-full max-w-[430px] flex-col overflow-hidden bg-background">
      <header class="relative z-10 flex-shrink-0">
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

      <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ProfilePage v-if="profileOpen" @logout="onLogout" @open-cs="openCs" />
        <BonusesPage v-else-if="activeNav === 'bonuses'" :promo-filter="promoFilter" @open-wallet="openWallet" />
        <BingoPage v-else-if="activeNav === 'bingo'" @open-wallet="openWallet" @game-tap="onGameTap" />
        <MenuPage v-else-if="activeNav === 'menu'" @open-search="searchOpen = true" @game-tap="onGameTap" @open-cs="openCs" />
        <HomeContent v-else @open-search="searchOpen = true" @open-promo="goBonuses" @game-tap="onGameTap" @open-slots-lobby="slotsLobbyOpen = true" @open-cs="openCs" />
        <SlotsLobby v-if="slotsLobbyOpen" @close="slotsLobbyOpen = false" @game-tap="onGameTap" />
      </main>

      <!-- Figma: bottom nav always visible, including on profile -->
      <nav
        class="app-safe-nav relative z-20 flex flex-shrink-0 items-center justify-around border-t border-border bg-card px-2 pt-2"
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
    <SearchOverlay :open="searchOpen" @close="searchOpen = false" @game-tap="onGameTap" />

    <!-- 客服聊天覆盖层：与 WalletModal/SearchOverlay 同级，覆盖整个 app-frame -->
    <div v-if="csOpen" class="absolute inset-0 z-50 flex flex-col bg-background">
      <CustomerServicePage @close="csOpen = false" />
    </div>
  </div>
</template>

<style scoped>
.app-frame {
  height: 100dvh;
  max-height: 100dvh;
  touch-action: pan-y;
  box-sizing: border-box;
}
</style>
