<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from 'vue'
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
  ArrowLeft,
  Send,
  ShieldCheck,
  Zap,
  Headphones,
} from 'lucide-vue-next'
import PayMethodGrid from '@/components/wallet/PayMethodGrid.vue'
import { createDeposit } from '@/api/deposit'
import { ApiError } from '@/api/client'
import { isTelegramWebApp } from '@/api/client'
import { useWalletStore } from '@/stores/wallet'
import { openTelegramInvoice, waitForDepositPaid } from '@/utils/tgInvoice'
import {
  fetchYfPayChannels,
  createYfDeposit,
  queryYfDeposit,
  fetchYfDepositOrders,
  fetchYfWithdrawOrders,
  createYfWithdrawal,
  type YfPayChannel,
} from '@/api/yfpay'
import {
  CRYPTO_DEPOSIT,
  CRYPTO_WITHDRAW,
  FIAT_DEPOSIT,
  FIAT_WITHDRAW,
  TG_WALLET_DEPOSIT,
  WALLET_BANNERS,
  type PayMethod,
} from '@/data/wallet'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const walletStore = useWalletStore()

// ── types ────────────────────────────────────────────────────────────────────

interface HistoryItem {
  id: string
  type: 'deposit' | 'withdraw'
  method: string
  amount: string
  date: string
  sortKey: string
  status: 'success' | 'pending' | 'failed'
}

// ── bottom sheet ─────────────────────────────────────────────────────────────

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

// ── state ─────────────────────────────────────────────────────────────────────

const tab = ref<'deposit' | 'withdraw' | 'history'>('deposit')
const depositView = ref<'select' | 'input'>('select')
const selectedMethod = ref<string | null>(null)
const amount = ref('')
const historyFilter = ref<'all' | 'deposit' | 'withdraw'>('all')
const historyStatus = ref<'all' | 'success' | 'pending' | 'failed'>('all')
const bannerIdx = ref(0)

// deposit
const depositLoading = ref(false)
const depositMessage = ref('')
const depositSuccess = ref(false)

// YF Pay channels
const yfpayChannels = ref<YfPayChannel[]>([])

// YF Pay deposit polling
let pollTimer: ReturnType<typeof setInterval> | null = null
const pollSerial = ref('')
const pollCount = ref(0)
const MAX_POLLS = 60 // 60 × 3s = 3 min

// withdraw form
const withdrawAccount = ref('')
const withdrawOwner = ref('')
const withdrawLoading = ref(false)
const withdrawMessage = ref('')
const withdrawSuccess = ref(false)

// history
const historyOrders = ref<HistoryItem[]>([])
const historyLoading = ref(false)

// 默认金额（写死）：首选 ₱1000，不支持时取低于 1000 的最近档
const DEFAULT_DEPOSIT_AMOUNTS: Record<string, string> = {
  tg_wallet_php:  '1000',
  tg_wallet_usdt: '20',   // ≈ ₱1160，最接近 ₱1000
  yfpay_gcash:    '500',   // 测试通道上限 500
  yfpay_maya:     '500',
}

// ── helpers ───────────────────────────────────────────────────────────────────

function methodDisplayName(code: string): string {
  const map: Record<string, string> = {
    GCASH: 'GCash', GCash: 'GCash', gcash: 'GCash',
    MAYA: 'Maya', Maya: 'Maya', maya: 'Maya',
    BDO: 'BDO Bank', BPI: 'BPI Bank',
  }
  return map[code] ?? code ?? '—'
}

function formatOrderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function mapDepositState(state: number): 'success' | 'pending' | 'failed' {
  if (state === 2) return 'success'
  if (state === 3) return 'failed'
  return 'pending'
}

function mapWithdrawState(state: number): 'success' | 'pending' | 'failed' {
  if (state === 1) return 'success'
  if (state === 2 || state === 3) return 'failed'
  return 'pending'
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollCount.value = 0
}

function statusIcon(status: string) {
  if (status === 'success') return CheckCircle2
  if (status === 'pending') return Loader2
  return AlertCircle
}

// ── computed ──────────────────────────────────────────────────────────────────

// Dynamically enable FIAT_DEPOSIT methods that match loaded YF Pay channels
// Channel codes like "gcash-merchant1-test" → matched by startsWith("gcash")
const liveFiatDeposit = computed((): PayMethod[] => {
  return FIAT_DEPOSIT.map((m) => {
    const ch = yfpayChannels.value.find((ch) =>
      ch.code.toLowerCase().startsWith(m.id.toLowerCase()),
    )
    if (ch) {
      return {
        ...m,
        id: `yfpay_${m.id}`,
        tag: `₱${ch.min}–₱${ch.max}`,
        enabled: true,
        channelId: ch.code,
        yfpayChannelCode: ch.code,
        minAmount: ch.min,
        maxAmount: ch.max,
      }
    }
    return m
  })
})

const isDeposit = computed(() => tab.value === 'deposit')
const quickAmountsPhp = ['100', '500', '1000', '2000', '5000']
const quickAmountsUsdt = ['10', '25', '50', '100']

const allDepositMethods = computed(() => [
  ...TG_WALLET_DEPOSIT,
  ...liveFiatDeposit.value,
  ...CRYPTO_DEPOSIT,
])

const selectedPayMethod = computed((): PayMethod | undefined =>
  allDepositMethods.value.find((m) => m.id === selectedMethod.value),
)

const isCryptoMethod = computed(() => {
  const id = selectedMethod.value ?? ''
  return /usdt|ton|btc|eth|bnb/.test(id) && !id.startsWith('tg_wallet')
})

const isTgWallet = computed(() => selectedMethod.value?.startsWith('tg_wallet') ?? false)
const isYfPay = computed(() => (selectedMethod.value ?? '').startsWith('yfpay_'))
const isFiatWithdraw = computed(() => FIAT_WITHDRAW.some((m) => m.id === selectedMethod.value))

const depositCurrency = computed(() => selectedPayMethod.value?.currency ?? 'PHP')
const quickAmounts = computed(() =>
  depositCurrency.value === 'USDT' ? quickAmountsUsdt : quickAmountsPhp,
)

const yfpayQuickAmounts = computed((): string[] => {
  const m = selectedPayMethod.value
  if (!m?.minAmount || !m?.maxAmount) return []
  const min = m.minAmount
  const max = m.maxAmount
  const step = Math.max(1, Math.round((max - min) / 3))
  return [min, min + step, min + step * 2, max]
    .filter((v, i, a) => a.indexOf(v) === i && v <= max)
    .map(String)
})

const withdrawOptionCode = computed(() => {
  const map: Record<string, string> = {
    'gcash-w': 'GCASH',
    'maya-w': 'MAYA',
    'bdo-w': 'BDO',
    'bpi-w': 'BPI',
  }
  return map[selectedMethod.value ?? ''] ?? ''
})

const canSubmitDeposit = computed(() => {
  if (!isDeposit.value || !selectedPayMethod.value?.channelId) return false
  const n = Number(amount.value)
  return !depositLoading.value && Number.isFinite(n) && n > 0
})

const canSubmitWithdraw = computed(() => {
  if (tab.value !== 'withdraw' || !isFiatWithdraw.value) return false
  const n = Number(amount.value)
  return (
    !withdrawLoading.value &&
    Number.isFinite(n) &&
    n > 0 &&
    withdrawAccount.value.trim().length > 0 &&
    withdrawOwner.value.trim().length > 0
  )
})

const filteredHistory = computed(() =>
  historyOrders.value.filter((tx) => {
    const typeOk = historyFilter.value === 'all' || tx.type === historyFilter.value
    const statusOk = historyStatus.value === 'all' || tx.status === historyStatus.value
    return typeOk && statusOk
  }),
)

// ── watch ─────────────────────────────────────────────────────────────────────

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      tab.value = 'deposit'
      depositView.value = 'select'
      selectedMethod.value = null
      amount.value = ''
      historyFilter.value = 'all'
      historyStatus.value = 'all'
      bannerIdx.value = 0
      depositLoading.value = false
      depositMessage.value = ''
      depositSuccess.value = false
      withdrawAccount.value = ''
      withdrawOwner.value = ''
      withdrawMessage.value = ''
      withdrawSuccess.value = false
      void walletStore.refresh()
      void fetchYfPayChannels()
        .then((ch) => { yfpayChannels.value = ch })
        .catch(() => {})
    } else {
      stopPolling()
    }
  },
)

watch(tab, (newTab) => {
  if (newTab === 'history') void loadHistory()
})

watch(selectedMethod, (method) => {
  if (!method) return
  depositView.value = 'input'
  if (tab.value === 'deposit') {
    const isCrypto = /^(usdt|ton|btc|eth|bnb)/.test(method) && !method.startsWith('tg_wallet')
    if (!isCrypto) {
      amount.value = DEFAULT_DEPOSIT_AMOUNTS[method] ?? ''
    }
  }
})

onUnmounted(() => stopPolling())

// ── actions ───────────────────────────────────────────────────────────────────

async function pollYfDeposit() {
  const serial = pollSerial.value
  if (!serial) return
  pollCount.value++
  if (pollCount.value > MAX_POLLS) {
    stopPolling()
    depositLoading.value = false
    depositMessage.value = t('wallet.yfpayDepositTimeout')
    return
  }
  try {
    const res = await queryYfDeposit(serial)
    if (res.state === 2) {
      stopPolling()
      depositLoading.value = false
      depositSuccess.value = true
      depositMessage.value = t('wallet.yfpayDepositSuccess')
      await walletStore.refresh()
    } else if (res.state === 3) {
      stopPolling()
      depositLoading.value = false
      depositMessage.value = t('wallet.yfpayDepositRejected')
    }
  } catch {
    // network glitch — keep polling
  }
}

async function onProceedYfDeposit() {
  const method = selectedPayMethod.value
  if (!method?.yfpayChannelCode) return
  const num = Number(amount.value)
  if (!Number.isFinite(num) || num <= 0) {
    depositMessage.value = t('wallet.invalidAmount')
    return
  }
  if (method.minAmount && num < method.minAmount) {
    depositMessage.value = t('wallet.yfpayAmountOutOfRange', { min: method.minAmount, max: method.maxAmount })
    return
  }
  if (method.maxAmount && num > method.maxAmount) {
    depositMessage.value = t('wallet.yfpayAmountOutOfRange', { min: method.minAmount, max: method.maxAmount })
    return
  }

  depositLoading.value = true
  depositMessage.value = t('wallet.yfpayOpenBrowser')
  depositSuccess.value = false
  stopPolling()

  try {
    const result = await createYfDeposit(num, method.yfpayChannelCode)
    pollSerial.value = result.merchantSerial

    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(result.payUrl)
    } else {
      window.open(result.payUrl, '_blank')
    }

    depositMessage.value = t('wallet.yfpayWaitingPayment')
    pollTimer = setInterval(pollYfDeposit, 3000)
  } catch (e) {
    depositLoading.value = false
    depositMessage.value = e instanceof ApiError ? e.message : t('wallet.yfpayDepositFailed')
  }
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

async function onProceedWithdraw() {
  if (!canSubmitWithdraw.value) return
  const n = Number(amount.value)
  withdrawLoading.value = true
  withdrawMessage.value = ''
  withdrawSuccess.value = false
  try {
    await createYfWithdrawal({
      amount: n,
      targetOwner: withdrawOwner.value.trim(),
      targetAccount: withdrawAccount.value.trim(),
      optionCode: withdrawOptionCode.value || undefined,
    })
    withdrawSuccess.value = true
    withdrawMessage.value = t('wallet.yfpayWithdrawPending')
    await walletStore.refresh()
  } catch (e) {
    withdrawMessage.value = e instanceof ApiError ? e.message : t('wallet.yfpayWithdrawFailed')
  } finally {
    withdrawLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const [deposits, withdrawals] = await Promise.all([
      fetchYfDepositOrders(),
      fetchYfWithdrawOrders(),
    ])
    const items: HistoryItem[] = [
      ...deposits.map((d) => ({
        id: d.merchantSerial,
        type: 'deposit' as const,
        method: methodDisplayName(d.channelCode ?? ''),
        amount: `+₱${(d.amountCents / 100).toFixed(2)}`,
        date: formatOrderDate(d.createdAt),
        sortKey: d.createdAt,
        status: mapDepositState(d.state),
      })),
      ...withdrawals.map((w) => ({
        id: w.merchantSerial,
        type: 'withdraw' as const,
        method: methodDisplayName(w.optionCode ?? ''),
        amount: `-₱${(w.amountCents / 100).toFixed(2)}`,
        date: formatOrderDate(w.createdAt),
        sortKey: w.createdAt,
        status: mapWithdrawState(w.state),
      })),
    ]
    items.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    historyOrders.value = items
  } catch {
    historyOrders.value = []
  } finally {
    historyLoading.value = false
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
          @click="tab = tabItem.id; depositView = 'select'; selectedMethod = null; amount = ''; depositMessage = ''; withdrawMessage = ''"
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
        <!-- ── Deposit / Withdraw ───────────────────────────────────────────── -->
        <div v-if="tab !== 'history'">

          <!-- SELECT VIEW: choose payment method -->
          <template v-if="depositView === 'select'">
            <div class="space-y-5">
              <!-- Deposit: Fiat first, then TG Wallet, then Crypto -->
              <template v-if="isDeposit">
                <div>
                  <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.fiatSection') }}</p>
                  <PayMethodGrid
                    :methods="liveFiatDeposit"
                    :selected="selectedMethod"
                    @select="selectedMethod = $event; amount = ''; depositMessage = ''"
                  />
                </div>
                <div>
                  <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.tgWalletSection') }}</p>
                  <PayMethodGrid
                    :methods="TG_WALLET_DEPOSIT"
                    :selected="selectedMethod"
                    @select="selectedMethod = $event; amount = ''; depositMessage = ''"
                  />
                </div>
                <div>
                  <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.cryptoSection') }}</p>
                  <PayMethodGrid :methods="CRYPTO_DEPOSIT" :selected="selectedMethod" @select="selectedMethod = $event" />
                </div>
              </template>

              <!-- Withdraw: Fiat, then Crypto -->
              <template v-else>
                <div>
                  <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.fiatSection') }}</p>
                  <PayMethodGrid
                    :methods="FIAT_WITHDRAW"
                    :selected="selectedMethod"
                    @select="selectedMethod = $event; amount = ''; withdrawMessage = ''; withdrawAccount = ''; withdrawOwner = ''"
                  />
                </div>
                <div>
                  <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{{ t('wallet.cryptoSection') }}</p>
                  <PayMethodGrid :methods="CRYPTO_WITHDRAW" :selected="selectedMethod" @select="selectedMethod = $event" />
                </div>
              </template>
            </div>
          </template>

          <!-- INPUT VIEW: amount + submit -->
          <template v-else>
            <div class="space-y-4">
              <!-- Back + selected method header -->
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary hover:bg-muted transition-colors flex-shrink-0"
                  @click="depositView = 'select'; selectedMethod = null; amount = ''; depositMessage = ''; withdrawMessage = ''; withdrawAccount = ''; withdrawOwner = ''"
                >
                  <ArrowLeft :size="16" class="text-foreground" />
                </button>
                <div class="flex items-center gap-2.5 flex-1 bg-secondary rounded-xl px-3 py-2.5">
                  <div
                    class="w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0"
                    :class="selectedPayMethod?.color ?? 'from-muted to-muted'"
                  >
                    <Send v-if="selectedPayMethod?.iconKind === 'telegram'" :size="16" class="text-white" stroke-width="2.5" />
                    <span v-else class="text-white font-black text-sm">{{ selectedPayMethod?.icon }}</span>
                  </div>
                  <div class="flex-1">
                    <span class="text-foreground font-black text-sm">{{ selectedPayMethod?.name }}</span>
                  </div>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                    {{ selectedPayMethod?.tag }}
                  </span>
                </div>
              </div>

              <p class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
                {{ isDeposit ? t('wallet.depositAmount') : t('wallet.withdrawAmount') }}
              </p>

              <!-- Quick amounts: TG Wallet -->
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

              <!-- Quick amounts: YF Pay fiat -->
              <div v-else-if="isDeposit && isYfPay && yfpayQuickAmounts.length" class="flex gap-2 flex-wrap">
                <button
                  v-for="q in yfpayQuickAmounts"
                  :key="q"
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                  :class="amount === q ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'"
                  @click="amount = q"
                >
                  ₱{{ q }}
                </button>
              </div>

              <!-- Amount input -->
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

              <!-- Withdraw: account + owner fields -->
              <template v-if="tab === 'withdraw' && isFiatWithdraw">
                <input
                  v-model="withdrawAccount"
                  type="tel"
                  :placeholder="t('wallet.yfpayAccountNumber')"
                  class="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary"
                />
                <input
                  v-model="withdrawOwner"
                  type="text"
                  :placeholder="t('wallet.yfpayFullName')"
                  class="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary"
                />
              </template>

              <!-- Status message -->
              <p
                v-if="depositMessage"
                class="text-xs font-bold text-center"
                :class="depositSuccess ? 'text-emerald-400' : 'text-amber-400'"
              >
                {{ depositMessage }}
              </p>
              <p
                v-if="withdrawMessage"
                class="text-xs font-bold text-center"
                :class="withdrawSuccess ? 'text-emerald-400' : 'text-amber-400'"
              >
                {{ withdrawMessage }}
              </p>

              <!-- Submit: TG Wallet deposit -->
              <button
                v-if="isDeposit && isTgWallet"
                type="button"
                class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20"
                :disabled="!canSubmitDeposit"
                @click="onProceedDeposit"
              >
                <Loader2 v-if="depositLoading" :size="18" class="animate-spin" />
                <ArrowDownToLine v-else :size="18" />
                {{ depositLoading ? t('wallet.openingPay') : t('wallet.payTelegram') }}
              </button>

              <!-- Submit: YF Pay deposit -->
              <button
                v-else-if="isDeposit && isYfPay"
                type="button"
                class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20"
                :disabled="!canSubmitDeposit || depositLoading"
                @click="onProceedYfDeposit"
              >
                <Loader2 v-if="depositLoading" :size="18" class="animate-spin" />
                <ArrowDownToLine v-else :size="18" />
                {{ depositLoading ? t('wallet.yfpayWaitingPayment') : t('wallet.yfpayProceedDeposit') }}
              </button>

              <!-- Submit: YF Pay withdraw -->
              <button
                v-else-if="tab === 'withdraw' && isFiatWithdraw"
                type="button"
                class="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20"
                :disabled="!canSubmitWithdraw"
                @click="onProceedWithdraw"
              >
                <Loader2 v-if="withdrawLoading" :size="18" class="animate-spin" />
                <ArrowUpFromLine v-else :size="18" />
                {{ withdrawLoading ? t('wallet.openingPay') : t('wallet.yfpayWithdrawSubmit') }}
              </button>

              <!-- Trust badges (deposit only) -->
              <div v-if="isDeposit" class="grid grid-cols-3 gap-2 pt-1 pb-2">
                <div class="flex flex-col items-center gap-2 rounded-2xl bg-secondary border border-amber-500/20 p-3 text-center">
                  <div class="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
                    <ShieldCheck :size="16" class="text-amber-400" />
                  </div>
                  <span class="text-[10px] font-bold text-amber-400 leading-tight">{{ t('wallet.trustSsl') }}</span>
                </div>
                <div class="flex flex-col items-center gap-2 rounded-2xl bg-secondary border border-emerald-500/20 p-3 text-center">
                  <div class="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                    <Zap :size="16" class="text-emerald-400" />
                  </div>
                  <span class="text-[10px] font-bold text-emerald-400 leading-tight">{{ t('wallet.trustInstant') }}</span>
                </div>
                <div class="flex flex-col items-center gap-2 rounded-2xl bg-secondary border border-sky-500/20 p-3 text-center">
                  <div class="w-8 h-8 rounded-xl bg-sky-500/15 flex items-center justify-center">
                    <Headphones :size="16" class="text-sky-400" />
                  </div>
                  <span class="text-[10px] font-bold text-sky-400 leading-tight">{{ t('wallet.trustSupport') }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── History ──────────────────────────────────────────────────────── -->
        <div v-else class="space-y-2">
          <div v-if="historyLoading" class="py-12 flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 :size="28" class="opacity-50 animate-spin" />
          </div>
          <template v-else>
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
          </template>
        </div>
      </div>
    </div>
  </template>
</template>
