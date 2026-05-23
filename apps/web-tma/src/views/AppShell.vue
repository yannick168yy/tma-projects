<script setup lang="ts">
import { ref } from 'vue'
import {
  ChevronDown,
  ChevronLeft,
  Wallet,
  Gift,
  Spade,
  Menu,
  Dices,
} from 'lucide-vue-next'
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
  <div class="flex justify-center items-start min-h-screen bg-[#040609]">
    <div class="relative bg-background w-full max-w-[430px] min-h-screen flex flex-col overflow-hidden">
      <header class="relative flex-shrink-0">
        <div class="flex items-center px-4 pt-5 pb-4 gap-3">
          <div class="flex-shrink-0 flex items-baseline">
            <span class="text-white font-black leading-none tracking-tight font-display text-xl">TARSIER</span>
            <span class="text-primary font-black leading-none tracking-tight font-display text-xl">WIN</span>
          </div>

          <button
            v-if="profileOpen"
            type="button"
            class="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-secondary border border-border rounded-full px-3 py-1"
            @click="profileOpen = false"
          >
            <ChevronLeft :size="13" class="text-muted-foreground" />
            <span class="text-foreground font-bold text-xs font-display">MY PROFILE</span>
          </button>

          <div class="flex-1 flex items-center justify-center gap-3">
            <button type="button" class="flex flex-col items-center gap-0.5" @click="walletOpen = !walletOpen">
              <span class="text-muted-foreground text-[11px] font-semibold flex items-center gap-1 leading-none">
                PHP
                <ChevronDown :size="11" class="transition-transform duration-200" :class="walletOpen ? 'rotate-180' : ''" />
              </span>
              <span class="text-white font-black text-base leading-tight">
                {{ balanceVisible ? '₱ 1,250.00' : '₱ ••••••' }}
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-1 bg-primary hover:bg-yellow-400 text-primary-foreground font-black text-sm px-5 py-2 rounded-full transition-colors shadow-lg shadow-amber-500/30 whitespace-nowrap"
              @click="openWallet"
            >
              Top up
            </button>
          </div>

          <button type="button" class="flex-shrink-0 relative" @click="profileOpen = true">
            <ProfileAvatar />
            <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-background" />
          </button>
        </div>

        <template v-if="walletOpen">
          <div class="fixed inset-0 z-40" @click="walletOpen = false" />
          <div class="absolute left-4 right-4 top-full -mt-1 z-50 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div class="p-4">
              <p class="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-3">My Wallet</p>
              <div class="flex items-center justify-between py-2.5 border-b border-border">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span class="text-primary font-black text-sm">₱</span>
                  </div>
                  <div>
                    <p class="text-foreground font-bold text-sm">Philippine Peso</p>
                    <p class="text-muted-foreground text-xs">PHP</p>
                  </div>
                </div>
                <span class="text-primary font-black text-base">{{ balanceVisible ? '1,250.00' : '••••••' }}</span>
              </div>
              <div class="flex items-center justify-between py-2.5 border-b border-border">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <span class="text-emerald-400 font-black text-sm">₮</span>
                  </div>
                  <div>
                    <p class="text-foreground font-bold text-sm">Tether USD</p>
                    <p class="text-muted-foreground text-xs">USDT · TRC20</p>
                  </div>
                </div>
                <span class="text-emerald-400 font-black text-base">{{ balanceVisible ? '21.80' : '••••' }}</span>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-xl">🎁</div>
                  <div>
                    <p class="text-foreground font-bold text-sm">Bonus Balance</p>
                    <p class="text-muted-foreground text-xs">Non-withdrawable</p>
                  </div>
                </div>
                <span class="text-violet-400 font-black text-base">{{ balanceVisible ? '₱ 500.00' : '₱ ••••' }}</span>
              </div>
            </div>
            <div class="flex gap-2 px-4 pb-4">
              <button
                type="button"
                class="flex-1 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-bold"
                @click="balanceVisible = !balanceVisible"
              >
                {{ balanceVisible ? 'Hide Balances' : 'Show Balances' }}
              </button>
              <button
                type="button"
                class="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5"
                @click="openWallet"
              >
                <Wallet :size="13" />
                Wallet
              </button>
            </div>
          </div>
        </template>
      </header>

      <ProfilePage v-if="profileOpen" />
      <BonusesPage v-else-if="activeNav === 'bonuses'" :promo-filter="promoFilter" @open-wallet="openWallet" />
      <BingoPage v-else-if="activeNav === 'bingo'" @open-wallet="openWallet" />
      <MenuPage v-else-if="activeNav === 'menu'" @open-search="searchOpen = true" />
      <HomeContent
        v-else
        @open-search="searchOpen = true"
        @open-promo="goBonuses"
      />

      <nav
        v-if="!profileOpen"
        class="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card border-t border-border flex items-center justify-around px-2 pt-2 pb-3 z-50"
      >
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          type="button"
          class="relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors"
          :class="activeNav === item.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          @click="setNav(item.id)"
        >
          <span
            v-if="activeNav === item.id"
            class="absolute -top-2 left-1/2 -translate-x-1/2 w-7 h-0.5 rounded-full bg-primary"
          />
          <div :class="activeNav === item.id ? 'p-1.5 bg-primary/10 rounded-xl' : 'p-1.5'">
            <component :is="navIcon(item.id)" :size="20" />
          </div>
          <span
            v-if="'badge' in item && item.badge"
            class="absolute top-0 right-1 min-w-[16px] h-4 rounded-full bg-accent text-white text-[9px] font-black flex items-center justify-center px-1"
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
