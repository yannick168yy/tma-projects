<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  ChevronDown,
  Wallet,
  Gift,
  Spade,
  Menu,
  Dices,
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
import { NAV_ITEMS } from '@/data/home'

type NavId = (typeof NAV_ITEMS)[number]['id']

const activeNav = ref<NavId>('casino')
const promoFilter = ref<string | null>(null)
const searchOpen = ref(false)
const balanceVisible = ref(true)
const walletOpen = ref(false)
const walletModalOpen = ref(false)
const profileOpen = ref(false)

function openWallet() {
  walletOpen.value = false
  walletModalOpen.value = true
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

function openProfile() {
  profileOpen.value = true
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
      return Spade
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
            <button type="button" class="flex flex-col items-center gap-0.5" @click="walletOpen = !walletOpen">
              <span class="flex items-center gap-1 text-[11px] font-semibold leading-none text-muted-foreground">
                PHP
                <ChevronDown
                  :size="11"
                  class="transition-transform duration-200"
                  :class="walletOpen ? 'rotate-180' : ''"
                />
              </span>
              <span class="text-base font-black leading-tight text-white">
                {{ balanceVisible ? '₱ 1,250.00' : '₱ ••••••' }}
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-black text-primary-foreground shadow-lg shadow-amber-500/30 transition-colors hover:bg-yellow-400"
              @click="openWallet"
            >
              Top up
            </button>
          </div>

          <button type="button" class="relative flex-shrink-0" @click="openProfile">
            <ProfileAvatar />
            <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent" />
          </button>
        </div>

        <template v-if="walletOpen">
          <div class="fixed inset-0 z-40" @click="walletOpen = false" />
          <div
            class="absolute left-4 right-4 top-full z-50 -mt-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div class="p-4">
              <p class="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">My Wallet</p>
              <div class="flex items-center justify-between border-b border-border py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <span class="text-sm font-black text-primary">₱</span>
                  </div>
                  <div>
                    <p class="text-sm font-bold text-foreground">Philippine Peso</p>
                    <p class="text-xs text-muted-foreground">PHP</p>
                  </div>
                </div>
                <span class="text-base font-black text-primary">
                  {{ balanceVisible ? '1,250.00' : '••••••' }}
                </span>
              </div>
              <div class="flex items-center justify-between border-b border-border py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <span class="text-sm font-black text-emerald-400">₮</span>
                  </div>
                  <div>
                    <p class="text-sm font-bold text-foreground">Tether USD</p>
                    <p class="text-xs text-muted-foreground">USDT · TRC20</p>
                  </div>
                </div>
                <span class="text-base font-black text-emerald-400">
                  {{ balanceVisible ? '21.80' : '••••' }}
                </span>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-xl">🎁</div>
                  <div>
                    <p class="text-sm font-bold text-foreground">Bonus Balance</p>
                    <p class="text-xs text-muted-foreground">Non-withdrawable</p>
                  </div>
                </div>
                <span class="text-base font-black text-violet-400">
                  {{ balanceVisible ? '₱ 500.00' : '₱ ••••' }}
                </span>
              </div>
            </div>
            <div class="flex gap-2 px-4 pb-4">
              <button
                type="button"
                class="flex-1 rounded-xl bg-secondary py-2 text-xs font-bold text-muted-foreground"
                @click="balanceVisible = !balanceVisible"
              >
                {{ balanceVisible ? 'Hide Balances' : 'Show Balances' }}
              </button>
              <button
                type="button"
                class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-yellow-400"
                @click="openWallet"
              >
                <Wallet :size="13" />
                Wallet
              </button>
            </div>
          </div>
        </template>
      </header>

      <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ProfilePage v-if="profileOpen" />
        <BonusesPage v-else-if="activeNav === 'bonuses'" :promo-filter="promoFilter" @open-wallet="openWallet" />
        <BingoPage v-else-if="activeNav === 'bingo'" @open-wallet="openWallet" />
        <MenuPage v-else-if="activeNav === 'menu'" @open-search="searchOpen = true" />
        <HomeContent v-else @open-search="searchOpen = true" @open-promo="goBonuses" />
      </main>

      <!-- Figma: bottom nav always visible, including on profile -->
      <nav
        class="app-safe-nav relative z-20 flex flex-shrink-0 items-center justify-around border-t border-border bg-card px-2 pt-2"
      >
        <button
          v-for="item in NAV_ITEMS"
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
    <SearchOverlay :open="searchOpen" @close="searchOpen = false" />
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
