<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { createDeposit } from '@/api/deposit'
import { ApiError } from '@/api/client'
import { isTelegramWebApp } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'
import { openTelegramInvoice, waitForDepositPaid } from '@/utils/tgInvoice'
import {
  CRYPTO_DEPOSIT,
  CRYPTO_WITHDRAW,
  FIAT_DEPOSIT,
  FIAT_WITHDRAW,
  TG_WALLET_DEPOSIT,
  TX_HISTORY,
  WALLET_BANNERS,
  type PayMethod,
} from '@/data/wallet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const walletStore = useWalletStore()

const walletTabs = computed(() => [
  { id: 'deposit' as const, label: t('wallet.deposit'), icon: ArrowDownToLine },
  { id: 'withdraw' as const, label: t('wallet.withdraw'), icon: ArrowUpFromLine },
  { id: 'history' as const, label: t('wallet.history'), icon: History },
])

const localizedWalletBanners = computed(() =>
  WALLET_BANNERS.map((b, i) => ({
    ...b,
    label: t(`wallet.banners.${i}.label`),
    text: t(`wallet.banners.${i}.text`),
  })),
)

const sheetRef = ref<HTMLElement | null>(null)
const backdropRef = ref<HTMLElement | null>(null)

const { onPointerDown, onPointerUp, onPointerCancel } = useBottomSheetDrag(
  toRef(props, 'open'),
  () => emit('close'),
  sheetRef,
  backdropRef,
)

const tab = ref<'deposit' | 'withdraw' | 'history'>('deposit')
const selectedMethod = ref<string | null>(null)
const amount = ref('')
const historyFilter = ref<'all' | 'deposit' | 'withdraw'>('all')
const historyStatus = ref<'all' | 'success' | 'pending' | 'failed'>('all')
const bannerIdx = ref(0)
const depositLoading = ref(false)
const depositMessage = ref('')
const depositSuccess = ref(false)

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      tab.value = 'deposit'
      selectedMethod.value = 'tg_wallet_php'
      amount.value = ''
      historyFilter.value = 'all'
      historyStatus.value = 'all'
      bannerIdx.value = 0
      depositLoading.value = false
      depositMessage.value = ''
      depositSuccess.value = false
      void walletStore.refresh()
    }
  },
)

const isDeposit = computed(() => tab.value === 'deposit')
const fiatList = computed(() => (isDeposit.value ? FIAT_DEPOSIT : FIAT_WITHDRAW))
const cryptoList = computed(() => (isDeposit.value ? CRYPTO_DEPOSIT : CRYPTO_WITHDRAW))
const quickAmountsPhp = ['100', '500', '1000', '2000', '5000']
const quickAmountsUsdt = ['10', '25', '50', '100']

const allDepositMethods = computed(() => [...TG_WALLET_DEPOSIT, ...FIAT_DEPOSIT, ...CRYPTO_DEPOSIT])

const selectedPayMethod = computed((): PayMethod | undefined =>
  allDepositMethods.value.find((m) => m.id === selectedMethod.value),
)

const filteredHistory = computed(() =>
  TX_HISTORY.filter((tx) => {
    const typeOk = historyFilter.value === 'all' || tx.type === historyFilter.value
    const statusOk = historyStatus.value === 'all' || tx.status === historyStatus.value
    return typeOk && statusOk
  }),
)

const isCryptoMethod = computed(() => {
  const id = selectedMethod.value ?? ''
  return /usdt|ton|btc|eth|bnb/.test(id) && !id.startsWith('tg_wallet')
})

const isTgWallet = computed(() => selectedMethod.value?.startsWith('tg_wallet') ?? false)
const depositCurrency = computed(() => selectedPayMethod.value?.currency ?? 'PHP')
const quickAmounts = computed(() =>
  depositCurrency.value === 'USDT' ? quickAmountsUsdt : quickAmountsPhp,
)

const canSubmitDeposit = computed(() => {
  if (!isDeposit.value || !selectedPayMethod.value?.channelId) return false
  const n = Number(amount.value)
  return !depositLoading.value && Number.isFinite(n) && n > 0
})

function statusIcon(status: string) {
  if (status === 'success') return CheckCircle2
  if (status === 'pending') return Loader2
  return AlertCircle
}

async function onProceedDeposit() {
  const method = selectedPayMethod.value
  if (!method?.channelId || method.currency == null) return

  const num = Number(amount.value)
  if (!Number.isFinite(num) || num <= 0) {
    depositMessage.value = t('wallet.invalidAmount')
    return
  }

  depositLoading.value = true
  depositMessage.value = ''
  depositSuccess.value = false

  try {
    const result = await createDeposit(num, method.currency)

    if (result.status === 'paid') {
      await walletStore.refresh()
      depositSuccess.value = true
      depositMessage.value = t('wallet.credited')
      return
    }

    if (result.invoiceLink) {
      if (!isTelegramWebApp()) {
        depositMessage.value = t('wallet.openInTelegram')
        return
      }
      const closeStatus = await openTelegramInvoice(result.invoiceLink)
      if (closeStatus === 'paid') {
        const credited = await waitForDepositPaid(result.orderId)
        if (credited) {
          await walletStore.refresh()
          depositSuccess.value = true
          depositMessage.value = t('wallet.paymentSuccess')
        } else {
          depositMessage.value = t('wallet.paymentPending')
        }
      } else if (closeStatus === 'cancelled') {
        depositMessage.value = t('wallet.paymentCancelled')
      } else if (closeStatus === 'failed') {
        depositMessage.value = t('wallet.paymentFailed')
      } else {
        depositMessage.value = t('wallet.completeInTelegram')
      }
      return
    }

    depositMessage.value = t('wallet.unavailable')
  } catch (e) {
    depositMessage.value = e instanceof ApiError ? e.message : t('wallet.depositFailed')
  } finally {
    depositLoading.value = false
  }
}
</script>

<template>
  <template v-if="open">
    <div
      ref="backdropRef"
      data-bottom-sheet-backdrop
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      @click="emit('close')"
    />

    <div
      ref="sheetRef"
      data-bottom-sheet
      class="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-3xl bg-card"
      style="height: 86vh; max-height: 86vh"
      @pointerdown.capture="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <div class="flex flex-shrink-0 justify-center pb-1 pt-3">
        <div class="h-1 w-10 rounded-full bg-border" />
      </div>

      <div class="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <div class="flex items-center gap-2">
          <Wallet :size="18" class="text-primary" />
          <span class="font-display text-base font-black text-foreground">{{ t('wallet.title') }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs font-bold">
          <span class="text-primary">{{ walletStore.displayPhp }}</span>
        </div>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary transition-colors hover:bg-muted"
          @click="emit('close')"
        >
          <X :size="15" class="text-muted-foreground" />
        </button>
      </div>

      <div class="flex flex-shrink-0 gap-2 px-5 pt-3">
        <button
          v-for="tabItem in walletTabs"
          :key="tabItem.id"
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors"
          :class="
            tab === tabItem.id
              ? 'bg-primary text-primary-foreground shadow shadow-amber-500/20'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          "
          @click="tab = tabItem.id; selectedMethod = tabItem.id === 'deposit' ? 'tg_wallet_php' : null; amount = ''; depositMessage = ''"
        >
          <component :is="tabItem.icon" :size="14" />
          {{ tabItem.label }}
        </button>
      </div>

      <div v-if="tab !== 'history'" class="px-5 pt-3 flex-shrink-0">
        <button
          type="button"
          class="relative w-full rounded-2xl overflow-hidden h-20 bg-gradient-to-br text-left"
          :class="localizedWalletBanners[bannerIdx]!.gradient"
          @click="bannerIdx = (bannerIdx + 1) % localizedWalletBanners.length"
        >
          <div class="absolute inset-0 p-3.5 flex items-center justify-between">
            <div>
              <span class="text-white/60 text-[10px] font-bold uppercase tracking-wider block leading-none mb-1">
                {{ localizedWalletBanners[bannerIdx]!.label }}
              </span>
              <span class="text-white font-black text-base leading-tight font-display">
                {{ localizedWalletBanners[bannerIdx]!.text }}
              </span>
            </div>
            <span class="text-4xl">{{ localizedWalletBanners[bannerIdx]!.icon }}</span>
          </div>
          <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            <span
              v-for="(_, i) in localizedWalletBanners"
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
            {{ f === 'deposit' ? t('wallet.filterDeposit') : f === 'withdraw' ? t('wallet.filterWithdraw') : t('wallet.filterAll') }}
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
            {{ t(`common.${s}`) }}
          </button>
        </div>
      </div>

      <div data-sheet-scroll class="page-scroll flex-1 px-5 pb-8 pt-4 hide-scrollbar">
        <div v-if="tab !== 'history'" class="space-y-5">
          <div v-if="isDeposit">
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">
              {{ t('wallet.tgWalletSection') }}
            </p>
            <PayMethodGrid
              :methods="TG_WALLET_DEPOSIT"
              :selected="selectedMethod"
              @select="selectedMethod = $event; amount = ''; depositMessage = ''"
            />
          </div>
          <div>
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.fiatSection') }}</p>
            <PayMethodGrid :methods="fiatList" :selected="selectedMethod" @select="selectedMethod = $event" />
          </div>
          <div>
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.cryptoSection') }}</p>
            <PayMethodGrid :methods="cryptoList" :selected="selectedMethod" @select="selectedMethod = $event" />
          </div>

          <div v-if="selectedMethod && (isTgWallet || tab === 'withdraw')" class="space-y-3">
            <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
              {{ isDeposit ? t('wallet.depositAmount') : t('wallet.withdrawAmount') }}
            </p>
            <div v-if="isDeposit && isTgWallet" class="flex gap-2 flex-wrap">
              <button
                v-for="q in quickAmounts"
                :key="q"
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                :class="amount === q ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
                @click="amount = q"
              >
                {{ depositCurrency === 'USDT' ? `$${q}` : `₱${q}` }}
              </button>
            </div>
            <div v-else-if="!isCryptoMethod && tab === 'deposit'" class="flex gap-2 flex-wrap">
              <button
                v-for="q in quickAmountsPhp"
                :key="q"
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors opacity-40"
                disabled
              >
                ₱{{ q }}
              </button>
            </div>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">
                {{ isTgWallet && depositCurrency === 'USDT' ? '$' : isCryptoMethod ? '≈ $' : '₱' }}
              </span>
              <input
                v-model="amount"
                type="number"
                placeholder="0.00"
                class="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary"
              />
            </div>
            <p
              v-if="depositMessage"
              class="text-xs font-bold text-center"
              :class="depositSuccess ? 'text-emerald-400' : 'text-amber-400'"
            >
              {{ depositMessage }}
            </p>
            <button
              v-if="isDeposit && isTgWallet"
              type="button"
              class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              :class="'bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20'"
              :disabled="!canSubmitDeposit"
              @click="onProceedDeposit"
            >
              <Loader2 v-if="depositLoading" :size="18" class="animate-spin" />
              <ArrowDownToLine v-else :size="18" />
              {{ depositLoading ? t('wallet.openingPay') : t('wallet.payTelegram') }}
            </button>
            <button
              v-else-if="tab === 'withdraw'"
              type="button"
              class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20"
            >
              <ArrowUpFromLine :size="18" />
              {{ t('wallet.proceedWithdraw') }}
            </button>
          </div>
        </div>

        <div v-else class="space-y-2">
          <div v-if="filteredHistory.length === 0" class="py-12 flex flex-col items-center gap-2 text-muted-foreground">
            <History :size="32" class="opacity-30" />
            <span class="text-sm">{{ t('common.noRecords') }}</span>
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
                    {{ t(`common.${tx.status}`) }}
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
            {{ t('common.loadMore') }}
            <ChevronRight :size="13" />
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
