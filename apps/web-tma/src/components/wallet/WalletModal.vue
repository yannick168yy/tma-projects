<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useBottomSheetDrag } from '@/composables/useBottomSheetDrag'
import {
  Wallet,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-vue-next'
import PayMethodGrid from '@/components/wallet/PayMethodGrid.vue'
import {
  CRYPTO_DEPOSIT,
  CRYPTO_WITHDRAW,
  FIAT_DEPOSIT,
  FIAT_WITHDRAW,
  TX_HISTORY,
  WALLET_BANNERS,
} from '@/data/wallet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const {
  sheetStyle,
  backdropStyle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = useBottomSheetDrag(toRef(props, 'open'), () => emit('close'))

const tab = ref<'deposit' | 'withdraw' | 'history'>('deposit')
const selectedMethod = ref<string | null>(null)
const amount = ref('')
const historyFilter = ref<'all' | 'deposit' | 'withdraw'>('all')
const historyStatus = ref<'all' | 'success' | 'pending' | 'failed'>('all')
const bannerIdx = ref(0)

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      tab.value = 'deposit'
      selectedMethod.value = null
      amount.value = ''
      historyFilter.value = 'all'
      historyStatus.value = 'all'
      bannerIdx.value = 0
    }
  },
)

const isDeposit = computed(() => tab.value === 'deposit')
const fiatList = computed(() => (isDeposit.value ? FIAT_DEPOSIT : FIAT_WITHDRAW))
const cryptoList = computed(() => (isDeposit.value ? CRYPTO_DEPOSIT : CRYPTO_WITHDRAW))
const quickAmounts = ['100', '500', '1000', '2000', '5000']

const filteredHistory = computed(() =>
  TX_HISTORY.filter((tx) => {
    const typeOk = historyFilter.value === 'all' || tx.type === historyFilter.value
    const statusOk = historyStatus.value === 'all' || tx.status === historyStatus.value
    return typeOk && statusOk
  }),
)

const isCryptoMethod = computed(() => {
  const id = selectedMethod.value ?? ''
  return /usdt|ton|btc|eth|bnb/.test(id)
})

function statusIcon(status: string) {
  if (status === 'success') return CheckCircle2
  if (status === 'pending') return Loader2
  return AlertCircle
}
</script>

<template>
  <template v-if="open">
    <div
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity"
      :style="backdropStyle"
      @click="emit('close')"
    />

    <div
      data-bottom-sheet
      class="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-3xl bg-card"
      :style="[sheetStyle, { height: '86vh', maxHeight: '86vh' }]"
    >
      <div
        class="flex-shrink-0 touch-none cursor-grab select-none active:cursor-grabbing"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <div class="flex justify-center pb-1 pt-3">
          <div class="h-1 w-10 rounded-full bg-border" />
        </div>

        <div class="flex items-center justify-between border-b border-border px-5 py-3">
        <div class="flex items-center gap-2">
          <Wallet :size="18" class="text-primary" />
          <span class="text-foreground font-black text-base font-display">MY WALLET</span>
        </div>
        <div class="flex items-center gap-2 text-xs font-bold">
          <span class="text-primary">₱ 1,250.00</span>
          <span class="text-white/20">|</span>
          <span class="text-emerald-400">21.80 USDT</span>
        </div>
        <button
          type="button"
          class="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-muted transition-colors"
          @click="emit('close')"
        >
          <X :size="15" class="text-muted-foreground" />
        </button>
        </div>
      </div>

      <div class="flex flex-shrink-0 gap-2 px-5 pt-3">
        <button
          v-for="t in [
            { id: 'deposit' as const, label: 'Deposit', icon: ArrowDownToLine },
            { id: 'withdraw' as const, label: 'Withdraw', icon: ArrowUpFromLine },
            { id: 'history' as const, label: 'History', icon: History },
          ]"
          :key="t.id"
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors"
          :class="
            tab === t.id
              ? 'bg-primary text-primary-foreground shadow shadow-amber-500/20'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          "
          @click="tab = t.id; selectedMethod = null; amount = ''"
        >
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>

      <div v-if="tab !== 'history'" class="px-5 pt-3 flex-shrink-0">
        <button
          type="button"
          class="relative w-full rounded-2xl overflow-hidden h-20 bg-gradient-to-br text-left"
          :class="WALLET_BANNERS[bannerIdx]!.gradient"
          @click="bannerIdx = (bannerIdx + 1) % WALLET_BANNERS.length"
        >
          <div class="absolute inset-0 p-3.5 flex items-center justify-between">
            <div>
              <span class="text-white/60 text-[10px] font-bold uppercase tracking-wider block leading-none mb-1">
                {{ WALLET_BANNERS[bannerIdx]!.label }}
              </span>
              <span class="text-white font-black text-base leading-tight font-display">
                {{ WALLET_BANNERS[bannerIdx]!.text }}
              </span>
            </div>
            <span class="text-4xl">{{ WALLET_BANNERS[bannerIdx]!.icon }}</span>
          </div>
          <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            <span
              v-for="(_, i) in WALLET_BANNERS"
              :key="i"
              class="h-1 rounded-full transition-all"
              :class="i === bannerIdx ? 'w-4 bg-white' : 'w-1 bg-white/40'"
            />
          </div>
        </button>
      </div>

      <div v-if="tab === 'history'" class="px-5 pt-3 space-y-2 flex-shrink-0">
        <div class="flex gap-1.5">
          <button
            v-for="f in ['all', 'deposit', 'withdraw'] as const"
            :key="f"
            type="button"
            class="px-3 py-1 rounded-lg text-[11px] font-black capitalize transition-colors border"
            :class="
              historyFilter === f
                ? f === 'deposit'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : f === 'withdraw'
                    ? 'bg-red-500/20 text-red-400 border-red-500/40'
                    : 'bg-primary/20 text-primary border-primary/40'
                : 'bg-secondary text-muted-foreground border-transparent'
            "
            @click="historyFilter = f"
          >
            {{ f === 'deposit' ? '↓ Deposit' : f === 'withdraw' ? '↑ Withdraw' : 'All' }}
          </button>
        </div>
        <div class="flex gap-1.5">
          <button
            v-for="s in ['all', 'success', 'pending', 'failed'] as const"
            :key="s"
            type="button"
            class="px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors"
            :class="
              historyStatus === s
                ? s === 'success'
                  ? 'bg-emerald-500 text-white'
                  : s === 'pending'
                    ? 'bg-yellow-500 text-black'
                    : s === 'failed'
                      ? 'bg-red-500 text-white'
                      : 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground'
            "
            @click="historyStatus = s"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div class="overflow-y-auto px-5 pb-8 pt-4 flex-1 hide-scrollbar">
        <div v-if="tab !== 'history'" class="space-y-5">
          <div>
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">Fiat Currency</p>
            <PayMethodGrid :methods="fiatList" :selected="selectedMethod" @select="selectedMethod = $event" />
          </div>
          <div>
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">Cryptocurrency</p>
            <PayMethodGrid :methods="cryptoList" :selected="selectedMethod" @select="selectedMethod = $event" />
          </div>

          <div v-if="selectedMethod" class="space-y-3">
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
              {{ isDeposit ? 'Deposit Amount' : 'Withdraw Amount' }}
            </p>
            <div v-if="!isCryptoMethod" class="flex gap-2 flex-wrap">
              <button
                v-for="q in quickAmounts"
                :key="q"
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                :class="amount === q ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
                @click="amount = q"
              >
                ₱{{ q }}
              </button>
            </div>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">
                {{ isCryptoMethod ? '≈ $' : '₱' }}
              </span>
              <input
                v-model="amount"
                type="number"
                placeholder="0.00"
                class="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg"
              :class="
                isDeposit
                  ? 'bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20'
                  : 'bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20'
              "
            >
              <component :is="isDeposit ? ArrowDownToLine : ArrowUpFromLine" :size="18" />
              {{ isDeposit ? 'Proceed to Deposit' : 'Proceed to Withdraw' }}
            </button>
          </div>
        </div>

        <div v-else class="space-y-2">
          <div v-if="filteredHistory.length === 0" class="py-12 flex flex-col items-center gap-2 text-muted-foreground">
            <History :size="32" class="opacity-30" />
            <span class="text-sm">No records found</span>
          </div>
          <div
            v-for="tx in filteredHistory"
            :key="tx.id"
            class="flex items-center gap-3 bg-secondary rounded-2xl px-4 py-3"
          >
            <div
              class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              :class="tx.type === 'deposit' ? 'bg-emerald-500/15' : 'bg-red-500/15'"
            >
              <ArrowDownToLine v-if="tx.type === 'deposit'" :size="16" class="text-emerald-400" />
              <ArrowUpFromLine v-else :size="16" class="text-red-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-foreground font-bold text-sm">{{ tx.method }}</span>
                <span class="font-black text-sm" :class="tx.type === 'deposit' ? 'text-emerald-400' : 'text-red-400'">
                  {{ tx.amount }}
                </span>
              </div>
              <div class="flex items-center justify-between mt-0.5">
                <span class="text-muted-foreground text-xs">{{ tx.date }}</span>
                <span class="flex items-center gap-1">
                  <component
                    :is="statusIcon(tx.status)"
                    :size="14"
                    :class="[
                      tx.status === 'success' ? 'text-emerald-400' : '',
                      tx.status === 'pending' ? 'text-yellow-400 animate-spin' : '',
                      tx.status === 'failed' ? 'text-red-400' : '',
                    ]"
                  />
                  <span
                    class="text-[11px] font-bold capitalize"
                    :class="{
                      'text-emerald-400': tx.status === 'success',
                      'text-yellow-400': tx.status === 'pending',
                      'text-red-400': tx.status === 'failed',
                    }"
                  >
                    {{ tx.status }}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <button
            v-if="filteredHistory.length > 0"
            type="button"
            class="w-full py-3 rounded-xl bg-secondary text-muted-foreground text-xs font-bold flex items-center justify-center gap-1.5 mt-2"
          >
            Load more
            <ChevronRight :size="13" />
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
