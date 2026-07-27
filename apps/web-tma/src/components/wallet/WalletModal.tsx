import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { Wallet, X, ArrowDownToLine, ArrowUpFromLine, History, CheckCircle2, AlertCircle, XCircle, Loader2, ArrowLeft, Send, ShieldCheck, Zap, Headphones, Copy, Check, Lock, Gift, Clock, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import PayMethodGrid from '@/components/wallet/PayMethodGrid'
import { createDeposit } from '@/api/deposit'
import { ApiError, isTelegramWebApp } from '@/api/client'
import { translateApiError } from '@/utils/translateApiError'
import { useWalletStore, formatBalanceWithCode } from '@/stores/wallet'
import { openTelegramInvoice, waitForDepositPaid } from '@/utils/tgInvoice'
import { fetchYfDepositOrders, fetchYfWithdrawOrders, fetchDepositHistory, fetchWithdrawHistory } from '@/api/yfpay'
import { fetchPaymentChannels, fetchCryptoChannels, createPaymentDeposit, queryPaymentDeposit, createPaymentWithdrawal, type PaymentChannel } from '@/api/payment'
import { fetchTurnoverProgress, type TurnoverProgress } from '@/api/wallet'
import { fetchMatrixDepositAddress, createMatrixWithdrawal } from '@/api/matrix'
import { fetchHomeContent } from '@/api/home'
import { usePromotionStore } from '@/stores/promotion'
import { useAuthStore } from '@/stores/auth'
import { analytics } from '@/utils/analytics'
import { fetchNewPlayerSummary, fetchRedepOffer, type FirstDepTier, type RedepOffer } from '@/api/promotion'
import KycModal from '@/components/wallet/KycModal'
import { isKycGatePassed } from '@/api/kyc'
import { useKycGate } from '@/hooks/useKycGate'
import { CRYPTO_DEPOSIT, CRYPTO_WITHDRAW, FIAT_DEPOSIT, FIAT_WITHDRAW, TG_WALLET_DEPOSIT, type PayMethod } from '@/data/wallet'
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag'
import defaultTopupBanner from '@/assets/wallet/topup-banner.webp'

interface Props { open: boolean; onClose: () => void; initialTab?: 'deposit'|'withdraw'|'history'; fullscreen?: boolean }

interface HistoryItem { id: string; orderId: string; type: 'deposit'|'withdraw'; method: string; amount: string; date: string; sortKey: string; status: 'success'|'pending'|'rejected'|'admin_rejected'|'failed' }
const STALE_DEPOSIT_PENDING_MS = 30 * 60 * 1000

function methodDisplayName(code: string) { const m: Record<string,string>={GCASH:'GCash',GCash:'GCash',gcash:'GCash',MAYA:'Maya',Maya:'Maya',maya:'Maya',GOTYME:'GoTyme',GoTyme:'GoTyme',gotyme:'GoTyme',BDO:'BDO Bank',BPI:'BPI Bank'}; return m[code]??code??'—' }
function formatOrderDate(iso: string) { try { return new Date(iso).toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) } catch { return iso } }
function mapDepositState(state: number): HistoryItem['status'] { if(state===2)return 'success'; if(state===3)return 'rejected'; return 'pending' }
function mapWithdrawState(state: number): HistoryItem['status'] { if(state===1)return 'success'; if(state===2||state===3)return 'rejected'; return 'pending' }
function mapDepositStatus(status: string): HistoryItem['status'] { if(status==='paid'||status==='completed')return 'success'; if(status==='rejected')return 'rejected'; if(status==='admin_rejected')return 'admin_rejected'; if(status==='cancelled'||status==='failed')return 'failed'; return 'pending' }
function mapDepositChannelName(channelId: string) { const m: Record<string,string>={admin:'Admin',tg_wallet:'Telegram',ammer_pay:'Telegram',yfpay_gcash:'GCash',yfpay_maya:'Maya',yfpay_gotyme:'GoTyme',yfpay_bdo:'BDO Bank',yfpay_bpi:'BPI Bank',yfpay_unknown:'YF Pay',matrix:'Matrix TRX'}; return m[channelId]??channelId??'—' }

// 各币种充值预设档位（与后台首充档位口径一致），用于充值金额网格
const DEPOSIT_PRESETS: Record<string, number[]> = {
  PHP: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000],
  USDT: [1, 5, 10, 50, 100, 500, 1000],
  USDC: [1, 5, 10, 50, 100, 500, 1000],
  TRX: [100, 500, 1000, 5000, 10000],
}
function currencySymbol(cur: string) { return cur === 'PHP' ? '₱' : cur === 'TRX' ? '' : '$' }
function fmtPreset(amount: number, cur: string) { const s = currencySymbol(cur); return cur === 'TRX' ? `${amount.toLocaleString()} ${cur}` : `${s}${amount.toLocaleString()}` }
/** 向下匹配档位奖励：amount 命中的最大档位的奖励，无命中返回 0 */
function matchTierBonus(tiers: FirstDepTier[] | undefined, amount: number): number {
  if (!tiers || tiers.length === 0 || amount <= 0) return 0
  let bonus = 0, best = -1
  for (const tier of tiers) if (amount >= tier.depositAmount && tier.depositAmount > best) { best = tier.depositAmount; bonus = tier.bonusAmount }
  return bonus
}
type DepositCategory = 'ewallet' | 'crypto' | 'telegram'

function isPhoneWalletWithdraw(id: string | null) {
  return id === 'gcash-w' || id === 'maya-w'
}

function walletAccountFromPhone(e164: string | null): string {
  if (!e164) return ''
  if (e164.startsWith('+63')) return `0${e164.slice(3)}`
  return e164
}

function statusIconComp(status: string) { if(status==='success')return CheckCircle2; if(status==='pending')return Loader2; if(status==='rejected')return XCircle; return AlertCircle }
function fmtTurnoverAmount(amount: number, currency: string) {
  if (currency === 'PHP') return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `${parseFloat(amount.toFixed(6))} ${currency}`
}
function fmtCryptoAmount(amount: number, currency: string) {
  return `${parseFloat(amount.toFixed(6))} ${currency}`
}

export default function WalletModal({ open, onClose, initialTab = 'deposit', fullscreen = false }: Props) {
  const { t } = useTranslation()
  const walletStore = useWalletStore()
  const activeCurrency = useWalletStore((s) => s.activeCurrency)
  const activeAvailable = useWalletStore((s) => {
    const b = s.balance?.balances.find((x) => x.currency === s.activeCurrency)
    return b?.available ?? 0
  })
  const displayActive = walletStore.balance ? formatBalanceWithCode(activeCurrency, activeAvailable) : '—'

  const sheetRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { onPointerDown, onPointerUp, onPointerCancel } = useBottomSheetDrag(open, onClose, sheetRef, backdropRef)

  const [tab, setTab] = useState<'deposit'|'withdraw'|'history'>('deposit')
  const [depositView, setDepositView] = useState<'select'|'input'>('select')
  const [depositCategory, setDepositCategory] = useState<DepositCategory>('ewallet')
  const promoConfig = usePromotionStore((s) => s.promoConfig)
  const loadPromoConfig = usePromotionStore((s) => s.loadPromoConfig)
  const isLoggedIn = useAuthStore((s) => Boolean(s.user))
  const [selectedMethod, setSelectedMethod] = useState<string|null>(null)
  const [amount, setAmount] = useState('')
  const [historyFilter, setHistoryFilter] = useState<'all'|'deposit'|'withdraw'>('all')
  const [historyStatus, setHistoryStatus] = useState<'all'|'success'|'pending'|'rejected'|'admin_rejected'|'failed'>('all')
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositMessage, setDepositMessage] = useState('')
  const [depositSuccess, setDepositSuccess] = useState(false)
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [paymentDepositChannels, setPaymentDepositChannels] = useState<PaymentChannel[]>([])
  const [paymentWithdrawChannels, setPaymentWithdrawChannels] = useState<PaymentChannel[]>([])
  const [cryptoEnabled, setCryptoEnabled] = useState<Record<string, boolean>>({})
  const [cryptoChannelsLoaded, setCryptoChannelsLoaded] = useState(false)
  const [cryptoWithdrawGas, setCryptoWithdrawGas] = useState<Record<string, { gas: number; discountThreshold: number | null; discountFee: number | null }>>({})
  const pollTimerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const [pollSerial, setPollSerial] = useState('')
  const [withdrawAccount, setWithdrawAccount] = useState('')
  const [withdrawOwner, setWithdrawOwner] = useState('')
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [withdrawMessage, setWithdrawMessage] = useState('')
  const [withdrawSuccess, setWithdrawSuccess] = useState(false)
  const { kycApproved, kycOpen, setKycOpen, boundPhoneNumber, kycFullName, refreshKyc, onKycClose, onKycApproved } = useKycGate(open && tab === 'withdraw')
  const pendingWithdrawMethodRef = useRef<string | null>(null)
  const [historyOrders, setHistoryOrders] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [matrixAddress, setMatrixAddress] = useState('')
  const [matrixAddressLoading, setMatrixAddressLoading] = useState(false)
  const [matrixCryptoAmount, setMatrixCryptoAmount] = useState('')
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedDepositAmount, setCopiedDepositAmount] = useState(false)
  const [turnoverProgress, setTurnoverProgress] = useState<TurnoverProgress | null>(null)
  const [turnoverLoading, setTurnoverLoading] = useState(false)
  const [turnoverShake, setTurnoverShake] = useState(false)
  const [turnoverExpanded, setTurnoverExpanded] = useState(false)
  const [guideRulesExpanded, setGuideRulesExpanded] = useState(false)
  const [walletBannerUrl, setWalletBannerUrl] = useState(defaultTopupBanner)
  const [redepOffer, setRedepOffer] = useState<RedepOffer | null>(null)
  const [redepNow, setRedepNow] = useState(() => Date.now())
  const [firstDepDone, setFirstDepDone] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open || tab !== 'deposit' || !isLoggedIn) { setFirstDepDone(null); return }
    setFirstDepDone(null)
    fetchNewPlayerSummary()
      .then((summary) => setFirstDepDone(summary.tasks.firstdep.done))
      .catch(() => setFirstDepDone(null))
  }, [open, tab, isLoggedIn])
  const redepEndsMs = redepOffer?.active && redepOffer.endsAt ? new Date(redepOffer.endsAt).getTime() : 0
  const redepActive = redepEndsMs > redepNow
  useEffect(() => {
    if (!redepActive) return
    const timer = setInterval(() => setRedepNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [redepActive])
  function redepCountdown(): string {
    const s = Math.max(0, Math.floor((redepEndsMs - redepNow) / 1000))
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
    const p = (n: number) => String(n).padStart(2, '0')
    return hh > 0 ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`
  }

  function selectDepositAmount(amt: string) {
    setAmount(amt)
    // 等"You will receive"与支付按钮渲染后再滚到底，确保用户看到充值按钮
    setTimeout(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, 60)
  }

  function stopPolling() { if(pollTimerRef.current){clearInterval(pollTimerRef.current);pollTimerRef.current=null} }

  function applyWithdrawPrefill(methodId: string, fullName?: string | null) {
    if (isPhoneWalletWithdraw(methodId)) {
      if (boundPhoneNumber) setWithdrawAccount(walletAccountFromPhone(boundPhoneNumber))
      else setWithdrawAccount('')
      const name = fullName ?? kycFullName
      setWithdrawOwner(name?.trim() ?? '')
    } else {
      setWithdrawAccount('')
      setWithdrawOwner('')
    }
  }

  function proceedWithWithdrawMethod(id: string, fullName?: string | null) {
    setSelectedMethod(id)
    setAmount('')
    setWithdrawMessage('')
    applyWithdrawPrefill(id, fullName)
  }

  async function onSelectWithdrawMethod(id: string) {
    if (turnoverProgress === null) return
    if (!turnoverProgress.hasDeposit) {
      setTurnoverShake(true)
      setTimeout(() => setTurnoverShake(false), 500)
      return
    }
    if (turnoverProgress !== null && !turnoverProgress.canWithdraw) {
      setTurnoverShake(true)
      setTimeout(() => setTurnoverShake(false), 500)
      return
    }
    let status = kycApproved === null ? await refreshKyc() : null
    const approved = status ? isKycGatePassed(status) : kycApproved === true
    if (!approved) {
      pendingWithdrawMethodRef.current = id
      setKycOpen(true)
      return
    }
    proceedWithWithdrawMethod(id, status?.fullName ?? kycFullName)
  }

  async function handleKycApproved() {
    onKycApproved()
    const status = await refreshKyc()
    const pending = pendingWithdrawMethodRef.current
    if (pending) {
      pendingWithdrawMethodRef.current = null
      proceedWithWithdrawMethod(pending, status?.fullName ?? kycFullName)
    }
  }

  function handleKycClose() {
    pendingWithdrawMethodRef.current = null
    onKycClose()
  }

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      // 存款分类默认跟随当前币种：稳定币(USDT/USDC)默认打开虚拟币分类，PHP 默认电子钱包
      const defaultDepositCat: DepositCategory = (activeCurrency === 'USDT' || activeCurrency === 'USDC') ? 'crypto' : 'ewallet'
      setTab(initialTab); setDepositView('select'); setSelectedMethod(null); setAmount(''); setHistoryFilter('all'); setHistoryStatus('all'); setDepositCategory(defaultDepositCat)
      void loadPromoConfig()
      setDepositLoading(false); setDepositMessage(''); setDepositSuccess(false)
      setWithdrawAccount(''); setWithdrawOwner(''); setWithdrawMessage(''); setWithdrawSuccess(false)
      pendingWithdrawMethodRef.current = null
      setTurnoverProgress(null); setTurnoverLoading(false)
      void walletStore.refresh()
      void fetchHomeContent().then((content) => setWalletBannerUrl(content.walletBanners[0]?.imageUrl ?? defaultTopupBanner)).catch(()=>setWalletBannerUrl(defaultTopupBanner))
      setChannelsLoading(true)
      setCryptoChannelsLoaded(false)
      const depP = fetchPaymentChannels('deposit').then(setPaymentDepositChannels).catch(()=>{})
      const cryP = fetchCryptoChannels().then((list)=>{
        setCryptoEnabled(Object.fromEntries(list.map((c)=>[c.name,c.enabled])))
        setCryptoWithdrawGas(Object.fromEntries(list.map((c)=>[c.name,{gas:c.withdrawGasFee,discountThreshold:c.withdrawGasDiscountThreshold,discountFee:c.withdrawGasDiscountFee}])))
      }).catch(()=>{}).finally(()=>setCryptoChannelsLoaded(true))
      void Promise.all([depP, cryP]).finally(()=>setChannelsLoading(false))
      void fetchPaymentChannels('withdraw').then(setPaymentWithdrawChannels).catch(()=>{})
    } else { stopPolling() }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => { if(tab==='history')void loadHistory() }, [tab])

  // 记录页存在处理中的充值时，静默轮询刷新，让用户原地看到"处理中→成功"翻转，避免二次恐慌
  const hasPendingDeposit = useMemo(() => historyOrders.some((o) => o.type === 'deposit' && o.status === 'pending'), [historyOrders])
  useEffect(() => {
    if (tab !== 'history' || !hasPendingDeposit) return
    const timer = setInterval(() => { void loadHistory(true) }, 10000)
    return () => clearInterval(timer)
  }, [tab, hasPendingDeposit])
  // pending 充值消失(到账/失败)时同步刷新顶部余额
  const prevPendingRef = useRef(false)
  useEffect(() => {
    if (prevPendingRef.current && !hasPendingDeposit) void walletStore.refresh()
    prevPendingRef.current = hasPendingDeposit
  }, [hasPendingDeposit])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod) return
    const allFiltered = [...filteredFiatWithdraw, ...filteredCryptoWithdraw]
    if (!allFiltered.some((m) => m.id === selectedMethod)) {
      setSelectedMethod(null)
      setWithdrawMessage('')
    }
  }, [activeCurrency])

  useEffect(() => {
    if (tab !== 'withdraw') return
    setTurnoverLoading(true)
    fetchTurnoverProgress(activeCurrency)
      .then(setTurnoverProgress)
      .catch(() => setTurnoverProgress(null))
      .finally(() => setTurnoverLoading(false))
  }, [tab, activeCurrency])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod || !boundPhoneNumber) return
    if (isPhoneWalletWithdraw(selectedMethod)) {
      setWithdrawAccount(walletAccountFromPhone(boundPhoneNumber))
    }
  }, [tab, selectedMethod, boundPhoneNumber])

  useEffect(() => {
    if (tab !== 'withdraw' || !selectedMethod || !kycFullName || withdrawOwner.trim()) return
    if (isPhoneWalletWithdraw(selectedMethod)) {
      setWithdrawOwner(kycFullName)
    }
  }, [tab, selectedMethod, kycFullName, withdrawOwner])

  useEffect(() => {
    if (!selectedMethod) return
    const method = allPayMethods.find((m) => m.id === selectedMethod)
    if (method?.channelId === 'matrix' && tab === 'deposit') {
      setDepositView('select')
      setMatrixAddress(''); setDepositMessage(''); setMatrixAddressLoading(true); setCopiedAddress(false)
      void fetchMatrixDepositAddress(method.matrixSymbol!, method.matrixChain!)
        .then((res) => setMatrixAddress(res.address))
        .catch((e) => setDepositMessage(e instanceof Error ? translateApiError(e.message, t) : t('wallet.matrixDepositFetchFailed')))
        .finally(() => setMatrixAddressLoading(false))
    } else {
      setDepositView('input')
      setMatrixAddress(''); setMatrixAddressLoading(false); setCopiedAddress(false)
    }
  }, [selectedMethod])

  useEffect(() => { return () => { stopPolling() } }, [])

  const liveFiatDeposit = useMemo((): PayMethod[] => FIAT_DEPOSIT.map((m) => {
    const ch = paymentDepositChannels.find((c) => c.name === m.id)
    if (ch) return { ...m, id: `fiat_${m.id}`, tag: ch.minAmount ? `₱${ch.minAmount}–₱${ch.maxAmount}` : 'Instant', enabled: true, channelId: `fiat_${m.id}`, paymentChannelName: m.id, minAmount: ch.minAmount ?? undefined, maxAmount: ch.maxAmount ?? undefined }
    return { ...m, enabled: false }
  }), [paymentDepositChannels])

  const liveFiatWithdraw = useMemo((): PayMethod[] => FIAT_WITHDRAW.map((m) => {
    const channelName = m.id.replace('-w', '')
    const ch = paymentWithdrawChannels.find((c) => c.name === channelName)
    if (ch) return { ...m, enabled: true, paymentChannelName: channelName, minAmount: ch.minAmount ?? undefined, maxAmount: ch.maxAmount ?? undefined, tag: ch.minAmount ? `₱${ch.minAmount}–₱${ch.maxAmount}` : m.tag }
    return { ...m, enabled: false }
  }), [paymentWithdrawChannels])

  // 虚拟币/TG 渠道开关由后台控制；开关未加载前不使用静态 enabled，避免误选已关闭币种
  const applyCrypto = (list: PayMethod[]) => list.map((m) => cryptoChannelsLoaded && m.id in cryptoEnabled ? { ...m, enabled: cryptoEnabled[m.id] } : { ...m, enabled: false })
  const liveTgWalletDeposit = useMemo(() => applyCrypto(TG_WALLET_DEPOSIT), [cryptoChannelsLoaded, cryptoEnabled])
  const liveCryptoDeposit = useMemo(() => applyCrypto(CRYPTO_DEPOSIT), [cryptoChannelsLoaded, cryptoEnabled])
  const liveCryptoWithdraw = useMemo(() => applyCrypto(CRYPTO_WITHDRAW), [cryptoChannelsLoaded, cryptoEnabled])

  const allPayMethods = useMemo(() => [...liveTgWalletDeposit, ...liveFiatDeposit, ...liveCryptoDeposit, ...liveFiatWithdraw, ...liveCryptoWithdraw], [liveTgWalletDeposit, liveFiatDeposit, liveCryptoDeposit, liveFiatWithdraw, liveCryptoWithdraw])
  const selectedPayMethod = useMemo(() => allPayMethods.find((m)=>m.id===selectedMethod), [allPayMethods, selectedMethod])
  const isTgWallet = selectedMethod?.startsWith('tg_wallet') ?? false
  const isUnifiedFiat = (selectedMethod ?? '').startsWith('fiat_')
  const isMatrixDeposit = selectedPayMethod?.channelId === 'matrix' && tab === 'deposit'
  const filteredFiatWithdraw = useMemo(
    () => liveFiatWithdraw.filter((m) => !m.currency || m.currency === activeCurrency),
    [liveFiatWithdraw, activeCurrency],
  )
  const filteredCryptoWithdraw = useMemo(
    () => liveCryptoWithdraw.filter((m) => !m.currency || m.currency === activeCurrency),
    [liveCryptoWithdraw, activeCurrency],
  )
  const isFiatWithdraw = liveFiatWithdraw.some((m) => m.id === selectedMethod)
  const withdrawAccountLocked = isPhoneWalletWithdraw(selectedMethod) && Boolean(boundPhoneNumber)
  const isMatrixWithdraw = selectedPayMethod?.channelId === 'matrix' && tab === 'withdraw'
  const matrixWithdrawGasConfig = useMemo(() => {
    const sym = selectedPayMethod?.matrixSymbol
    if (!isMatrixWithdraw || !sym) return { gas: 0, discountThreshold: null as number | null, discountFee: null as number | null }
    return cryptoWithdrawGas[`matrix_${sym.toLowerCase()}_w`] ?? { gas: 0, discountThreshold: null, discountFee: null }
  }, [isMatrixWithdraw, selectedPayMethod, cryptoWithdrawGas])
  const isCryptoMethod = /usdt|usdc/.test(selectedMethod ?? '') && !isTgWallet
  const depositCurrency = selectedPayMethod?.currency ?? selectedPayMethod?.matrixSymbol ?? 'PHP'
  const depositCategoryMethods = useMemo((): Record<DepositCategory, PayMethod[]> => ({
    ewallet: liveFiatDeposit, crypto: liveCryptoDeposit, telegram: liveTgWalletDeposit,
  }), [liveFiatDeposit, liveCryptoDeposit, liveTgWalletDeposit])
  const currentCategoryMethods = depositCategoryMethods[depositCategory]
  const firstDepEligible = isLoggedIn && firstDepDone === false && (promoConfig?.firstdep.enabled ?? false)
  // 复充限时优惠：按当前选择的充值币种拉取；窗口生效期间每秒走倒计时（每币种独立）
  useEffect(() => {
    if (!open || tab !== 'deposit' || !isLoggedIn) { setRedepOffer(null); return }
    fetchRedepOffer(depositCurrency).then(setRedepOffer).catch(() => setRedepOffer(null))
  }, [open, tab, isLoggedIn, depositCurrency])
  const depositPresets = DEPOSIT_PRESETS[depositCurrency] ?? DEPOSIT_PRESETS.PHP
  const depositTierList = promoConfig?.firstdep.tiers?.[depositCurrency]
  const cryptoFirstDepCurrency = useMemo(() => {
    if (depositCategory !== 'crypto') return null
    const methodCurrency = selectedPayMethod?.currency
    if (methodCurrency === 'USDT' || methodCurrency === 'USDC') return methodCurrency
    return null
  }, [depositCategory, selectedPayMethod])
  const cryptoFirstDepTierList = cryptoFirstDepCurrency ? promoConfig?.firstdep.tiers?.[cryptoFirstDepCurrency] : undefined
  const firstDepTiersSorted = useMemo(
    () => [...(cryptoFirstDepTierList ?? [])].filter((tier) => tier.bonusAmount > 0).sort((a, b) => a.depositAmount - b.depositAmount),
    [cryptoFirstDepTierList],
  )
  const showCryptoFirstDepGuide = firstDepEligible && Boolean(cryptoFirstDepCurrency) && firstDepTiersSorted.length > 0
  const cryptoFirstDepAmount = Number(amount)
  const cryptoFirstDepBonus = showCryptoFirstDepGuide ? matchTierBonus(firstDepTiersSorted, cryptoFirstDepAmount) : 0
  const nextCryptoFirstDepTier = showCryptoFirstDepGuide && cryptoFirstDepAmount > 0
    ? firstDepTiersSorted.find((tier) => cryptoFirstDepAmount < tier.depositAmount)
    : null
  const recommendedCryptoFirstDepTiers = firstDepTiersSorted
  const cryptoFirstDepDisplayCurrency = cryptoFirstDepCurrency ?? 'USDT'
  // 首充未完成或状态未确认时不展示复充，避免首充与复充同时出现
  // 复充展示条件：offer 币种与当前充值币种一致（redep 已多币种）
  const redepShow = redepActive && firstDepDone === true && depositCurrency === (redepOffer?.currency ?? 'PHP')
  const showCryptoRedepGuide = isMatrixDeposit && redepShow
  const redepBonusFor = (amt: number) => (redepShow && amt >= (redepOffer?.minDeposit ?? Infinity) ? (redepOffer?.bonusAmount ?? 0) : 0)
  const selectedBonus = firstDepEligible ? matchTierBonus(depositTierList, Number(amount)) : redepBonusFor(Number(amount))
  const receiveAmount = Math.max(0, Number(amount) || 0) + selectedBonus

  // 充值：切换分类（或渠道加载完成）时自动选中该分类首个可用渠道
  useEffect(() => {
    if (!open || tab !== 'deposit') return
    const firstEnabled = currentCategoryMethods.find((m) => m.enabled !== false)
    setSelectedMethod(firstEnabled?.id ?? null)
    setAmount(''); setDepositMessage('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositCategory, open, tab, currentCategoryMethods])
  const canSubmitDeposit = Boolean(!depositLoading && selectedPayMethod?.channelId && Number(amount) > 0)
  // 未完成合格真实存款 → 提款页整体替换为存款引导（不展示取款按钮）
  const pendingPromoReqs = useMemo(
    () => (turnoverProgress?.requirements ?? []).filter((r) => r.status === 'pending' && r.sourceType === 'promotion'),
    [turnoverProgress],
  )
  const hasRealDepositForWithdraw = turnoverProgress?.hasDeposit === true
  const depositRequiredForWithdraw = turnoverProgress !== null && !hasRealDepositForWithdraw
  const showDepositGuide = depositRequiredForWithdraw
  const guideTiers = useMemo(() => {
    const tiers = promoConfig?.firstdep.tiers?.[activeCurrency] ?? promoConfig?.firstdep.tiers?.PHP ?? []
    return [...tiers].filter((tier) => tier.bonusAmount > 0).sort((a, b) => a.depositAmount - b.depositAmount).slice(0, 3)
  }, [promoConfig, activeCurrency])
  const guideTierCurrency = (promoConfig?.firstdep.tiers?.[activeCurrency]?.length ?? 0) > 0 ? activeCurrency : 'PHP'
  const guideMaxBonus = Math.max(0, ...(promoConfig?.firstdep.tiers?.[guideTierCurrency] ?? []).map((tier) => tier.bonusAmount))
  const promoLabel = (sourceRef: string) =>
    sourceRef === 'trial' ? t('wallet.promoTrial')
    : sourceRef === 'referral' ? t('wallet.promoReferral')
    : sourceRef === 'firstdep' ? t('wallet.promoFirstdep')
    : sourceRef === 'appdl' ? t('wallet.promoAppdl')
    : sourceRef.startsWith('task:') ? t('wallet.promoTask')
    : sourceRef.startsWith('redep:') ? t('wallet.promoRedep')
    : t('wallet.turnoverPromo')
  // 法币取款金额区间（后台按渠道配置，须 ≥ YfPay 网关最低额，否则送到网关会拒单）
  const fiatWithdrawMin = selectedPayMethod?.minAmount ?? null
  const fiatWithdrawMax = selectedPayMethod?.maxAmount ?? null
  const fiatWithdrawAmountValid = Number(amount) > 0
    && (fiatWithdrawMin == null || Number(amount) >= fiatWithdrawMin)
    && (fiatWithdrawMax == null || Number(amount) <= fiatWithdrawMax)
  const canSubmitWithdraw = Boolean(!withdrawLoading && hasRealDepositForWithdraw && isFiatWithdraw && fiatWithdrawAmountValid && withdrawAccount.trim() && withdrawOwner.trim())
  const matrixWithdrawGasFee = (() => {
    const n = Number(matrixCryptoAmount)
    if (
      matrixWithdrawGasConfig.discountThreshold !== null
      && matrixWithdrawGasConfig.discountFee !== null
      && n >= matrixWithdrawGasConfig.discountThreshold
    ) return matrixWithdrawGasConfig.discountFee
    return matrixWithdrawGasConfig.gas
  })()
  const matrixAmountValid = Number(matrixCryptoAmount) > matrixWithdrawGasFee
  const matrixReceiveAmount = Math.max(0, Number(matrixCryptoAmount || 0) - matrixWithdrawGasFee)
  const canSubmitMatrixWithdraw = Boolean(!withdrawLoading && hasRealDepositForWithdraw && isMatrixWithdraw && matrixAmountValid && withdrawAccount.trim())
  const filteredHistory = useMemo(() => historyOrders.filter((tx) => (historyFilter==='all'||tx.type===historyFilter) && (historyStatus==='all'||tx.status===historyStatus)), [historyOrders, historyFilter, historyStatus])

  const depositCategoryTabs = useMemo(() => [
    { id:'ewallet' as const, label:t('wallet.catEwallet'), Icon:Wallet },
    { id:'crypto' as const, label:t('wallet.catCrypto'), Icon:Zap },
    { id:'telegram' as const, label:t('wallet.catTelegram'), Icon:Send },
  ], [t])

  const pollFiatDepositCountRef = useRef(0)
  async function pollFiatDeposit() {
    if(!pollSerial)return; pollFiatDepositCountRef.current++; if(pollFiatDepositCountRef.current>60){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositTimeout'));return}
    try { const res=await queryPaymentDeposit(pollSerial); if(res.state===2){stopPolling();setDepositLoading(false);setDepositSuccess(true);setDepositMessage(t('wallet.yfpayDepositSuccess'));analytics.depositSuccess(selectedPayMethod?.paymentChannelName,Number(amount),'PHP',pollSerial);setFirstDepDone(true);await walletStore.refresh()}else if(res.state===3){stopPolling();setDepositLoading(false);setDepositMessage(t('wallet.yfpayDepositRejected'))} } catch { /* keep polling */ }
  }

  async function onProceedUnifiedFiatDeposit() {
    const method=selectedPayMethod; if(!method?.paymentChannelName)return; const num=Number(amount)
    if(!Number.isFinite(num)||num<=0){setDepositMessage(t('wallet.invalidAmount'));return}
    if(method.minAmount&&num<method.minAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    if(method.maxAmount&&num>method.maxAmount){setDepositMessage(t('wallet.yfpayAmountOutOfRange',{min:method.minAmount,max:method.maxAmount}));return}
    setDepositLoading(true); setDepositMessage(t('wallet.yfpayOpenBrowser')); setDepositSuccess(false); stopPolling(); pollFiatDepositCountRef.current=0
    analytics.depositStart(method.paymentChannelName,num,'PHP')
    try {
      const result=await createPaymentDeposit({channelName:method.paymentChannelName,amount:num}); setPollSerial(result.merchantSerial)
      analytics.depositOrderCreated(method.paymentChannelName,num,'PHP',result.merchantSerial)
      if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(result.payUrl); else window.open(result.payUrl,'_blank')
      setDepositMessage(t('wallet.yfpayWaitingPayment')); pollTimerRef.current=setInterval(()=>void pollFiatDeposit(),3000)
    } catch(e){setDepositLoading(false);setDepositMessage(e instanceof ApiError?translateApiError(e.message,t):t('wallet.yfpayDepositFailed'))}
  }

  async function onProceedDeposit() {
    const method=selectedPayMethod; if(!method?.channelId||method.currency==null)return; const num=Number(amount)
    if(!Number.isFinite(num)||num<=0){setDepositMessage(t('wallet.invalidAmount'));return}
    setDepositLoading(true); setDepositMessage(''); setDepositSuccess(false)
    analytics.depositStart(method.channelId,num,method.currency)
    try {
      const result=await createDeposit(num,method.currency)
      analytics.depositOrderCreated(method.channelId,num,method.currency,result.orderId)
      if(result.status==='paid'){analytics.depositSuccess(method.channelId,num,method.currency,result.orderId);setFirstDepDone(true);await walletStore.refresh();setDepositSuccess(true);setDepositMessage(t('wallet.credited'));return}
      if(result.invoiceLink){
        if(!isTelegramWebApp()){setDepositMessage(t('wallet.openInTelegram'));return}
        const closeStatus=await openTelegramInvoice(result.invoiceLink)
        if(closeStatus==='paid'){const credited=await waitForDepositPaid(result.orderId);if(credited){analytics.depositSuccess(method.channelId,num,method.currency,result.orderId);setFirstDepDone(true);await walletStore.refresh();setDepositSuccess(true);setDepositMessage(t('wallet.paymentSuccess'))}else setDepositMessage(t('wallet.paymentPending'))}
        else if(closeStatus==='cancelled')setDepositMessage(t('wallet.paymentCancelled'))
        else if(closeStatus==='failed')setDepositMessage(t('wallet.paymentFailed'))
        else setDepositMessage(t('wallet.completeInTelegram')); return
      }
      setDepositMessage(t('wallet.unavailable'))
    } catch(e){setDepositMessage(e instanceof ApiError?translateApiError(e.message,t):t('wallet.depositFailed'))} finally{setDepositLoading(false)}
  }

  async function onProceedWithdraw() {
    if(!canSubmitWithdraw)return; const n=Number(amount)
    setWithdrawLoading(true); setWithdrawMessage(''); setWithdrawSuccess(false)
    const channelName=selectedPayMethod?.paymentChannelName; if(!channelName)return
    analytics.withdrawStart(channelName,n,activeCurrency)
    try{await createPaymentWithdrawal({channelName,amount:n,targetOwner:withdrawOwner.trim(),targetAccount:withdrawAccount.trim()});analytics.withdrawCreated(channelName,n,activeCurrency);setWithdrawSuccess(true);setWithdrawMessage(t('wallet.yfpayWithdrawPending'));await walletStore.refresh();setTimeout(()=>{setTab('history');setHistoryFilter('withdraw');void loadHistory()},1500)}catch(e){setWithdrawMessage(e instanceof ApiError?translateApiError(e.message,t):t('wallet.yfpayWithdrawFailed'))}finally{setWithdrawLoading(false)}
  }

  async function onProceedMatrixWithdraw() {
    if (!canSubmitMatrixWithdraw || !selectedPayMethod) return
    setWithdrawLoading(true); setWithdrawMessage(''); setWithdrawSuccess(false)
    analytics.withdrawStart(selectedPayMethod.channelId, Number(matrixCryptoAmount), selectedPayMethod.matrixSymbol!)
    try {
      await createMatrixWithdrawal({
        toAddress: withdrawAccount.trim(),
        symbol: selectedPayMethod.matrixSymbol!,
        chain: selectedPayMethod.matrixChain!,
        cryptoAmount: matrixCryptoAmount.trim(),
      })
      analytics.withdrawCreated(selectedPayMethod.channelId, Number(matrixCryptoAmount), selectedPayMethod.matrixSymbol!)
      setWithdrawSuccess(true); setWithdrawMessage(t('wallet.matrixWithdrawPending'))
      await walletStore.refresh()
      setTimeout(() => { setTab('history'); setHistoryFilter('withdraw'); void loadHistory() }, 1500)
    } catch (e) {
      setWithdrawMessage(e instanceof Error ? translateApiError(e.message, t) : t('wallet.matrixWithdrawFailed'))
    } finally { setWithdrawLoading(false) }
  }

  async function copyMatrixAddress() {
    try { await navigator.clipboard.writeText(matrixAddress); setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000) } catch { /**/ }
  }

  async function copyDepositAmount() {
    if (!amount) return
    try { await navigator.clipboard.writeText(amount); setCopiedDepositAmount(true); setTimeout(() => setCopiedDepositAmount(false), 2000) } catch { /**/ }
  }

  async function loadHistory(silent = false) {
    if (!silent) setHistoryLoading(true)
    try{
      const[yfDeposits,yfWithdrawals,bgDeposits,bgWithdrawals]=await Promise.all([fetchYfDepositOrders().catch(()=>[]),fetchYfWithdrawOrders().catch(()=>[]),fetchDepositHistory().catch(()=>[]),fetchWithdrawHistory().catch(()=>[])])
      const seen=new Set<string>(); const items: HistoryItem[]=[]
      for(const d of bgDeposits){seen.add(d.orderId);const dAmt=d.currency==='PHP'?`+₱${(d.creditedCents??d.amount).toFixed(2)}`:`+${parseFloat(d.amount.toFixed(6))} ${d.currency}`;items.push({id:d.orderId,orderId:d.orderId,type:'deposit',method:mapDepositChannelName(d.channelId),amount:dAmt,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositStatus(d.status)})}
      for(const w of bgWithdrawals){seen.add(w.orderId);const wAmt=w.channelId==='matrix'?`-${w.amount} ${w.currency}`:`-₱${w.amount.toFixed(2)}`;items.push({id:w.orderId,orderId:w.orderId,type:'withdraw',method:mapDepositChannelName(w.channelId),amount:wAmt,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapDepositStatus(w.status)})}
      for(const d of yfDeposits)if(!seen.has(d.merchantSerial))items.push({id:d.merchantSerial,orderId:d.merchantSerial,type:'deposit',method:methodDisplayName(d.channelCode??''),amount:`+₱${d.amount.toFixed(2)}`,date:formatOrderDate(d.createdAt),sortKey:d.createdAt,status:mapDepositState(d.state)})
      for(const w of yfWithdrawals)if(!seen.has(w.merchantSerial))items.push({id:w.merchantSerial,orderId:w.merchantSerial,type:'withdraw',method:methodDisplayName(w.optionCode??''),amount:`-₱${w.amount.toFixed(2)}`,date:formatOrderDate(w.createdAt),sortKey:w.createdAt,status:mapWithdrawState(w.state)})
      items.sort((a,b)=>b.sortKey.localeCompare(a.sortKey)); setHistoryOrders(items)
    }catch{if(!silent)setHistoryOrders([])}finally{if(!silent)setHistoryLoading(false)}
  }

  async function copyOrderId(id: string) { try{await navigator.clipboard.writeText(id);setCopiedId(id);setTimeout(()=>setCopiedId(null),2000)}catch{/***/} }

  function resetToSelect() { pendingWithdrawMethodRef.current = null; setDepositView('select'); setSelectedMethod(null); setAmount(''); setDepositMessage(''); setWithdrawMessage(''); setWithdrawAccount(''); setWithdrawOwner(''); stopPolling(); setDepositLoading(false); setPollSerial(''); setDepositSuccess(false); setMatrixAddress(''); setMatrixCryptoAmount(''); setCopiedAddress(false); setCopiedDepositAmount(false) }

  function switchTab(next: 'deposit'|'withdraw'|'history') {
    if (next === tab) return
    setTab(next)
    resetToSelect()
    setDepositMessage(''); setDepositSuccess(false)
    setWithdrawMessage(''); setWithdrawSuccess(false)
  }

  function renderCryptoFirstDepGuide() {
    if (!showCryptoFirstDepGuide) return null
    return (
      <div className="space-y-3 rounded-2xl border border-primary/35 bg-gradient-to-br from-primary/14 via-emerald-500/10 to-[#101a2c] p-3 shadow-[0_0_22px_rgba(245,158,11,0.16)]">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <Gift size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white">{t('wallet.cryptoFirstDepTitle')}</p>
            <p className="mt-0.5 text-[11px] font-bold leading-snug text-white/62">{t('wallet.cryptoFirstDepSubtitle', { currency: cryptoFirstDepDisplayCurrency })}</p>
          </div>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {recommendedCryptoFirstDepTiers.map((tier) => {
            const sel = amount === String(tier.depositAmount)
            return (
              <button
                key={tier.depositAmount}
                type="button"
                onClick={() => { setAmount(String(tier.depositAmount)); setCopiedDepositAmount(false) }}
                className={`w-[calc((100%-1.5rem)/4.5)] flex-shrink-0 rounded-xl border px-1 py-2 text-center transition-colors ${sel ? 'border-primary bg-primary/20' : 'border-white/10 bg-[#07111f]/80'}`}
              >
                <span className="block text-xs font-black text-white leading-none">{fmtCryptoAmount(tier.depositAmount, cryptoFirstDepDisplayCurrency)}</span>
                <span className="mt-1 block text-[10px] font-black leading-none text-primary">+{fmtCryptoAmount(tier.bonusAmount, cryptoFirstDepDisplayCurrency)}</span>
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative rounded-xl border border-white/10 bg-[#07111f]">
            <input
              value={amount}
              type="number"
              min={0}
              placeholder={t('wallet.cryptoFirstDepAmount', { currency: cryptoFirstDepDisplayCurrency })}
              className="w-full bg-transparent px-3 py-2.5 pr-14 text-sm font-black text-white focus:outline-none"
              onChange={(e) => { setAmount(e.target.value); setCopiedDepositAmount(false) }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/45">{cryptoFirstDepDisplayCurrency}</span>
          </div>
          <button
            type="button"
            disabled={!amount}
            onClick={() => void copyDepositAmount()}
            className={`flex min-w-[92px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition-colors disabled:opacity-45 ${copiedDepositAmount ? 'bg-emerald-500/18 text-emerald-300' : 'bg-primary text-black hover:bg-yellow-400'}`}
          >
            {copiedDepositAmount ? <Check size={13} strokeWidth={3} /> : <Copy size={13} strokeWidth={3} />}
            {copiedDepositAmount ? t('common.copied') : t('wallet.copyAmount')}
          </button>
        </div>
        {cryptoFirstDepAmount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/45">{t('wallet.cryptoFirstDepExpected')}</p>
              <p className="mt-0.5 text-sm font-black text-white">
                {fmtCryptoAmount(cryptoFirstDepAmount + cryptoFirstDepBonus, cryptoFirstDepDisplayCurrency)}
              </p>
            </div>
            <div className="text-right text-[11px] font-bold">
              <p className="text-white/70">{fmtCryptoAmount(cryptoFirstDepAmount, cryptoFirstDepDisplayCurrency)}</p>
              {cryptoFirstDepBonus > 0 ? (
                <p className="mt-0.5 text-primary">+{fmtCryptoAmount(cryptoFirstDepBonus, cryptoFirstDepDisplayCurrency)}</p>
              ) : nextCryptoFirstDepTier ? (
                <p className="mt-0.5 max-w-[150px] text-amber-300">{t('wallet.cryptoFirstDepNext', { amount: fmtCryptoAmount(nextCryptoFirstDepTier.depositAmount, cryptoFirstDepDisplayCurrency), bonus: fmtCryptoAmount(nextCryptoFirstDepTier.bonusAmount, cryptoFirstDepDisplayCurrency) })}</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderCryptoRedepGuide() {
    if (!showCryptoRedepGuide) return null
    const minDeposit = redepOffer?.minDeposit ?? 0
    const bonusAmount = redepOffer?.bonusAmount ?? 0
    const currentAmount = Number(amount)
    const unlocked = currentAmount >= minDeposit && bonusAmount > 0
    return (
      <div className="space-y-3 rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-[#101a2c] p-3 shadow-[0_0_22px_rgba(245,158,11,0.16)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
              <Clock size={18} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-amber-300">{t('wallet.limitedOfferTitle')}</p>
              <p className="mt-0.5 text-[11px] font-bold leading-snug text-white/70">
                {t('wallet.limitedOfferDesc', { min: fmtCryptoAmount(minDeposit, depositCurrency), bonus: fmtCryptoAmount(bonusAmount, depositCurrency) })}
              </p>
            </div>
          </div>
          <span className="flex-shrink-0 rounded-lg bg-amber-400/10 px-2 py-1 font-mono text-sm font-black tabular-nums text-amber-300">{redepCountdown()}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={() => { setAmount(String(minDeposit)); setCopiedDepositAmount(false) }}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${amount === String(minDeposit) ? 'border-amber-300 bg-amber-400/20' : 'border-white/10 bg-[#07111f]/80'}`}
          >
            <span className="block text-xs font-black text-white leading-none">{fmtCryptoAmount(minDeposit, depositCurrency)}</span>
            <span className="mt-1 block text-[10px] font-black leading-none text-amber-300">+{fmtCryptoAmount(bonusAmount, depositCurrency)}</span>
          </button>
          <button
            type="button"
            disabled={!amount}
            onClick={() => void copyDepositAmount()}
            className={`flex min-w-[92px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition-colors disabled:opacity-45 ${copiedDepositAmount ? 'bg-emerald-500/18 text-emerald-300' : 'bg-amber-400 text-black hover:bg-yellow-300'}`}
          >
            {copiedDepositAmount ? <Check size={13} strokeWidth={3} /> : <Copy size={13} strokeWidth={3} />}
            {copiedDepositAmount ? t('common.copied') : t('wallet.copyAmount')}
          </button>
        </div>
        {currentAmount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/45">{t('wallet.cryptoFirstDepExpected')}</p>
              <p className="mt-0.5 text-sm font-black text-white">
                {fmtCryptoAmount(currentAmount + (unlocked ? bonusAmount : 0), depositCurrency)}
              </p>
            </div>
            <div className="text-right text-[11px] font-bold">
              <p className="text-white/70">{fmtCryptoAmount(currentAmount, depositCurrency)}</p>
              {unlocked ? (
                <p className="mt-0.5 text-amber-300">+{fmtCryptoAmount(bonusAmount, depositCurrency)}</p>
              ) : (
                <p className="mt-0.5 max-w-[150px] text-amber-300">{t('wallet.cryptoFirstDepNext', { amount: fmtCryptoAmount(minDeposit, depositCurrency), bonus: fmtCryptoAmount(bonusAmount, depositCurrency) })}</p>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!open) return null

  return createPortal(
    <>
      <div ref={backdropRef} className={fullscreen ? 'fixed inset-0 z-50 bg-[#07111f]' : 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm'} onClick={fullscreen ? undefined : onClose} />
      <div
        ref={sheetRef}
        className={fullscreen
          ? 'fixed bottom-0 left-1/2 top-0 z-50 flex w-full max-w-[430px] flex-col border-x border-amber-300/10 bg-[#07111f]'
          : 'fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] flex-col rounded-t-[1.8rem] border border-amber-300/10 bg-[#07111f] shadow-[0_-18px_70px_rgba(0,0,0,0.55)]'}
        style={fullscreen ? { transform: 'translateX(-50%)', paddingTop: 'var(--app-safe-top)' } : { height: '86vh', maxHeight: '86vh', transform: 'translateX(-50%)' }}
        onPointerDown={fullscreen ? undefined : (e) => onPointerDown(e.nativeEvent)}
        onPointerUp={fullscreen ? undefined : (e) => onPointerUp(e.nativeEvent)}
        onPointerCancel={fullscreen ? undefined : (e) => onPointerCancel(e.nativeEvent)}
      >
        {!fullscreen && <div className="flex flex-shrink-0 justify-center pb-1 pt-3"><div className="h-1 w-11 rounded-full bg-white/20" /></div>}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5"><Wallet size={20} className="text-primary" /><span className="font-display text-lg font-black uppercase tracking-wide text-white">{t('wallet.title')}</span></div>
          <span className="text-lg font-black tabular-nums text-primary">{displayActive}</span>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 transition-colors hover:bg-white/10" onClick={onClose}><X size={18} className="text-white/55" /></button>
        </div>

        {/* 顶部 tab 条：从"提款"入口进入时整段保持充值/提款/记录三tab(点充值或记录也不消失)；
            从充值或记录入口进入则只展示充值·记录，保持充值纯粹性 */}
        <div className="flex flex-shrink-0 gap-2 px-5 pt-3">
          {([
            { id: 'deposit' as const, label: t('wallet.deposit'), Icon: ArrowDownToLine },
            ...(initialTab === 'withdraw' ? [{ id: 'withdraw' as const, label: t('wallet.withdraw'), Icon: ArrowUpFromLine }] : []),
            { id: 'history' as const, label: t('wallet.history'), Icon: History },
          ]).map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => switchTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-3 text-xs font-black transition-colors ${tab===id?'border-primary bg-primary text-black shadow-[0_0_20px_rgba(245,158,11,0.34)]':'border-white/10 bg-[#101a2c] text-white/40 hover:text-white/80'}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {tab === 'history' && (
          <div className="px-5 pt-3 space-y-2 flex-shrink-0">
            <div className="flex gap-1.5">
              {(['all','deposit','withdraw'] as const).map((f) => (
                <button key={f} type="button" className={`px-3 py-1 rounded-lg text-[11px] font-black capitalize transition-colors border ${historyFilter===f?f==='deposit'?'bg-emerald-500/20 text-emerald-400 border-emerald-500/40':f==='withdraw'?'bg-red-500/20 text-red-400 border-red-500/40':'bg-primary/20 text-primary border-primary/40':'bg-secondary text-muted-foreground border-transparent'}`} onClick={() => setHistoryFilter(f)}>
                  {f==='deposit'?t('wallet.filterDeposit'):f==='withdraw'?t('wallet.filterWithdraw'):t('wallet.filterAll')}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['all','success','pending','rejected','admin_rejected','failed'] as const).map((s) => (
                <button key={s} type="button" className={`px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors ${historyStatus===s?s==='success'?'bg-emerald-500 text-white':s==='pending'?'bg-yellow-500 text-black':s==='rejected'?'bg-orange-500 text-white':s==='admin_rejected'?'bg-rose-700 text-white':s==='failed'?'bg-red-500 text-white':'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`} onClick={() => setHistoryStatus(s)}>
                  {t(`common.${s}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={scrollRef} data-sheet-scroll className="page-scroll flex-1 px-5 pb-4 pt-4 hide-scrollbar overflow-y-auto">
          {tab !== 'history' ? (
            <>
              {/* Banner 随内容滚动，可向上滑动隐藏 */}
              <div className="overflow-hidden rounded-2xl border border-primary/50 bg-[#0b1424] shadow-[0_0_24px_rgba(245,158,11,0.18)] mb-4">
                <img src={walletBannerUrl} alt="" className="block w-full aspect-[5.6/1] object-cover" />
              </div>
              {tab === 'deposit' ? (
                <div className="space-y-4">
                  {/* 充值分类 tab：电子钱包 / 虚拟币 / Telegram */}
                  <div className="grid grid-cols-3 rounded-2xl border border-white/10 bg-[#0a1424] p-1">
                    {depositCategoryTabs.map(({id, label, Icon})=>(
                      <button key={id} type="button" onClick={()=>setDepositCategory(id)} className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-black transition-colors border ${depositCategory===id?'border-primary bg-primary/10 text-primary shadow-[0_0_18px_rgba(245,158,11,0.20)]':'border-transparent text-white/45 hover:text-white/75'}`}><Icon size={14} />{label}</button>
                    ))}
                  </div>
                  {/* 渠道 chips：单行横向滑动，可见约 3.5 个 */}
                  {currentCategoryMethods.length===0 ? (channelsLoading ? (
                    <div className="flex gap-2 overflow-hidden -mx-1 px-1 pb-1">
                      {Array.from({length:4}).map((_,i)=><div key={i} className="flex-shrink-0 w-[27%] h-[92px] rounded-2xl bg-white/5 animate-pulse" />)}
                    </div>
                  ) : <p className="text-xs text-muted-foreground py-3">{t('wallet.comingSoon')}</p>) : (
                  <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
                    {currentCategoryMethods.map((m)=>{
                      const disabled=m.enabled===false; const sel=selectedMethod===m.id
                      return (
                        <button key={m.id} type="button" disabled={disabled} onClick={()=>{setSelectedMethod(m.id);setAmount('');setCopiedDepositAmount(false);setDepositMessage('')}}
                          className={`relative flex-shrink-0 w-[27%] rounded-2xl border p-2 flex flex-col items-center justify-center gap-1.5 transition-colors ${sel?'border-primary bg-primary/10 shadow-[0_0_22px_rgba(245,158,11,0.20)]':'border-white/10 bg-[#101a2c]'} ${disabled?'opacity-40':''}`}>
                          {sel&&<span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-black"><Check size={10} strokeWidth={3}/></span>}
                          {m.iconUrl ? <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0"><img src={m.iconUrl} alt={m.name} className="w-full h-full object-contain" /></div>
                            : <div className={`w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${m.color}`}>{m.iconKind==='telegram'?<Send size={18} className="text-white" strokeWidth={2.5}/>:<span className="text-white text-base font-black">{m.icon}</span>}</div>}
                          <span className="text-xs font-black text-white truncate w-full text-center leading-tight">{m.name}</span>
                          {m.tag&&<span className="text-[9px] font-bold text-white/45 truncate w-full text-center leading-none uppercase tracking-wide">{m.tag}</span>}
                        </button>
                      )
                    })}
                  </div>
                  )}
                  {renderCryptoFirstDepGuide()}
                  {renderCryptoRedepGuide()}
                  {selectedPayMethod ? (
                    isMatrixDeposit ? (
                      <div className="space-y-4">
                        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.matrixDepositTitle')}</p>
                        {matrixAddressLoading ? (
                          <div className="flex flex-col items-center gap-3 py-8"><Loader2 size={28} className="text-primary animate-spin opacity-70" /></div>
                        ) : matrixAddress ? (
                          <>
                            <p className="text-xs text-muted-foreground text-center">{t('wallet.matrixDepositNote', { symbol: selectedPayMethod.matrixSymbol, chain: selectedPayMethod.matrixChain })}</p>
                            <div className="flex justify-center">
                              <div className="bg-white rounded-2xl p-3 shadow-lg shadow-black/20">
                                <QRCodeSVG value={matrixAddress} size={180} bgColor="#ffffff" fgColor="#111111" level="M" />
                              </div>
                            </div>
                            <div className="bg-secondary rounded-2xl px-4 py-3 space-y-2.5">
                              <p className="font-mono text-sm font-bold text-foreground break-all leading-relaxed tracking-wide text-center">{matrixAddress}</p>
                              <button type="button" className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors w-full justify-center ${copiedAddress?'bg-emerald-500/20 text-emerald-400':'bg-primary/10 text-primary hover:bg-primary/20'}`} onClick={()=>void copyMatrixAddress()}>
                                {copiedAddress?<Check size={13}/>:<Copy size={13}/>}{copiedAddress?t('common.copied'):t('common.copy')}
                              </button>
                            </div>
                            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                              <ShieldCheck size={13} className="text-amber-400 flex-shrink-0" />
                              <span className="text-[11px] text-amber-300/80">{t('wallet.matrixDepositLimitNote', { chain: selectedPayMethod.matrixChain, symbol: selectedPayMethod.matrixSymbol })}</span>
                            </div>
                          </>
                        ) : depositMessage ? (
                          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#101a2c] px-4 py-4 text-center">
                            <p className="text-xs font-bold leading-relaxed text-amber-400">
                              {depositMessage}
                            </p>
                          </div>
                        ) : (
                          null
                        )}
                      </div>
                    ) : (
                    <>
                      {/* 复充限时优惠：仅窗口生效期间显示倒计时横幅 */}
                      {redepShow && (
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-gradient-to-r from-amber-500/15 to-orange-500/10 px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300"><Clock size={18}/></div>
                            <div>
                              <p className="text-xs font-black text-amber-300 uppercase tracking-wide">{t('wallet.limitedOfferTitle')}</p>
                              <p className="text-[11px] font-bold text-white/75">{t('wallet.limitedOfferDesc',{min:fmtPreset(redepOffer?.minDeposit??0,depositCurrency),bonus:fmtPreset(redepOffer?.bonusAmount??0,depositCurrency)})}</p>
                            </div>
                          </div>
                          <span className="font-mono text-base font-black text-amber-300 tabular-nums">{redepCountdown()}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-white/40 text-[11px] font-black uppercase tracking-widest">{t('wallet.depositAmount')}</p>
                        {selectedBonus > 0 && (
                          <div className="inline-flex items-center gap-1.5 rounded-xl border border-primary/45 bg-primary/10 px-3 py-1.5 text-primary">
                            <Gift size={13} strokeWidth={3} />
                            <span className="text-[11px] font-black">{t('wallet.firstDepBonusBadge',{amount:fmtPreset(selectedBonus,depositCurrency)})}</span>
                          </div>
                        )}
                      </div>
                      {/* 金额档位网格（带首存/复充奖励角标） */}
                      <div className="grid grid-cols-3 gap-2">
                        {depositPresets.map((amt)=>{
                          const sel=amount===String(amt); const bonus=firstDepEligible?matchTierBonus(depositTierList,amt):redepBonusFor(amt)
                          return (
                            <button key={amt} type="button" onClick={()=>selectDepositAmount(String(amt))} className={`relative rounded-xl border py-2.5 px-1 flex flex-col items-center transition-colors ${sel?'border-primary bg-primary/15 shadow-[0_0_18px_rgba(245,158,11,0.24)]':'border-white/10 bg-[#101a2c]'}`}>
                              {sel&&<span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-black"><Check size={10} strokeWidth={3}/></span>}
                              <span className="text-base font-black text-white">+{fmtPreset(amt,depositCurrency)}</span>
                              {bonus>0 && <span className="text-[11px] font-black text-primary mt-1 leading-none">+{fmtPreset(bonus,depositCurrency)}</span>}
                            </button>
                          )
                        })}
                      </div>
                      <div className="relative rounded-2xl border border-white/10 bg-[#07111f]">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/45 font-bold text-sm">{depositCurrency==='USDT'||depositCurrency==='USDC'?'$':isCryptoMethod?'≈ $':'₱'}</span>
                        <input value={amount} type="number" min={selectedPayMethod?.minAmount} max={selectedPayMethod?.maxAmount} placeholder="0.00" className="w-full bg-transparent pr-32 py-3 text-white font-black text-xl focus:outline-none pl-10" onChange={(e)=>setAmount(e.target.value)} />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-white/65">{t('wallet.editAmount')}</span>
                      </div>
                      {firstDepEligible&&Number(amount)>0&&selectedBonus>0&&<p className="text-[11px] font-bold text-primary text-center -mt-1">{t('wallet.firstDepBonusHint',{amount:fmtPreset(selectedBonus,depositCurrency)})}</p>}
                      {redepShow&&Number(amount)>0&&selectedBonus>0&&<p className="text-[11px] font-bold text-amber-300 text-center -mt-1">{t('wallet.limitedOfferHint',{amount:fmtPreset(selectedBonus,depositCurrency)})}</p>}
                      {depositMessage&&<p className={`text-xs font-bold text-center ${depositSuccess?'text-emerald-400':'text-amber-400'}`}>{depositMessage}</p>}
                      {Number(amount)>0&&<div className="flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary"><ShieldCheck size={20}/></div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/45">You will receive</p>
                            <p className="text-2xl font-black text-white">{fmtPreset(receiveAmount,depositCurrency)}</p>
                          </div>
                        </div>
                        <div className="text-right text-xs font-bold">
                          <p className="text-white/75">Deposit {fmtPreset(Number(amount),depositCurrency)}</p>
                          {selectedBonus>0&&<p className="mt-1 text-primary">Bonus +{fmtPreset(selectedBonus,depositCurrency)}</p>}
                        </div>
                      </div>}
                      {isTgWallet&&<button type="button" className="w-full py-3 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-black hover:bg-yellow-400 shadow-amber-500/25" disabled={!canSubmitDeposit} onClick={()=>void onProceedDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={22} />}{depositLoading?t('wallet.openingPay'):t('wallet.payTelegram')}</button>}
                      {isUnifiedFiat&&<button type="button" className="w-full py-3 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-primary text-black hover:bg-yellow-400 shadow-amber-500/25" disabled={!canSubmitDeposit||depositLoading} onClick={()=>void onProceedUnifiedFiatDeposit()}>{depositLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowDownToLine size={22} />}{depositLoading?t('wallet.yfpayWaitingPayment'):t('wallet.yfpayProceedDeposit')}</button>}
                    </>
                    )
                  ) : channelsLoading ? (
                    /* 弱网渠道未就绪时，先把金额档位与输入框骨架预渲染出来 */
                    <div className="space-y-4">
                      <div className="h-3 w-28 rounded bg-white/5 animate-pulse" />
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({length:9}).map((_,i)=><div key={i} className="h-[58px] rounded-xl bg-white/5 animate-pulse" />)}
                      </div>
                      <div className="h-[52px] rounded-2xl bg-white/5 animate-pulse" />
                      <div className="h-[52px] rounded-2xl bg-white/5 animate-pulse" />
                    </div>
                  ) : <p className="text-center text-sm text-muted-foreground py-8">{t('wallet.comingSoon')}</p>}
                </div>
              ) : depositView === 'select' ? (
                showDepositGuide ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-primary/25 bg-primary/10 px-5 py-6 text-center space-y-1.5">
                      <Gift size={30} className="mx-auto text-primary" />
                      <p className="text-lg font-black text-white">{t('wallet.depositGuideTitle')}</p>
                      <p className="text-xs font-bold text-muted-foreground">{guideMaxBonus > 0 ? t('wallet.depositGuideSubtitleMax', { max: fmtPreset(guideMaxBonus, guideTierCurrency) }) : t('wallet.depositGuideSubtitle')}</p>
                    </div>
                    {guideTiers.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {guideTiers.map((tier) => (
                          <div key={tier.depositAmount} className="rounded-xl border border-white/10 bg-secondary px-2 py-3 text-center">
                            <p className="text-sm font-black text-white">{fmtPreset(tier.depositAmount, guideTierCurrency)}</p>
                            <p className="mt-0.5 text-[11px] font-black text-primary">+{fmtPreset(tier.bonusAmount, guideTierCurrency)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg bg-primary text-black hover:bg-yellow-400 shadow-amber-500/25" onClick={() => { setTab('deposit'); setDepositView('select') }}>
                      <ArrowDownToLine size={20} />{t('wallet.depositGuideCta')}
                    </button>
                    <button type="button" className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground/70" onClick={() => setGuideRulesExpanded((v) => !v)}>
                      {t('wallet.depositGuideRules')}
                      <ChevronDown size={12} className={`transition-transform ${guideRulesExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {guideRulesExpanded && (
                      <div className="rounded-xl bg-secondary px-4 py-3 space-y-1.5">
                        {pendingPromoReqs.map((req) => (
                          <p key={req.id} className="text-[11px] leading-relaxed text-muted-foreground">
                            {promoLabel(req.sourceRef)} {fmtTurnoverAmount(req.baseAmount, req.currency)} · {t('wallet.guideRuleNeedTurnover', { required: fmtTurnoverAmount(req.requiredAmount, req.currency) })}
                          </p>
                        ))}
                        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('wallet.guideRuleDeposit')}</p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('wallet.guideRuleCryptoMinDeposit')}</p>
                        {promoConfig?.firstdep.enabled && <p className="text-[11px] leading-relaxed text-muted-foreground">{t('wallet.guideRuleFirstdep', { x: promoConfig.firstdep.turnoverX || 1 })}</p>}
                      </div>
                    )}
                  </div>
                ) : (
                <div className="space-y-5">
                      {turnoverLoading ? (
                        <div className="h-11 bg-secondary rounded-xl animate-pulse" />
                      ) : turnoverProgress ? (
                        turnoverProgress.canWithdraw ? (
                          // 只在确实有流水记录时才显示"已完成"提示，新用户从未存款则不展示
                          turnoverProgress.requirements.length > 0 ? (
                            <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2">
                              <CheckCircle2 size={13} className="text-emerald-400/60 flex-shrink-0" />
                              <span className="text-xs text-muted-foreground">{t('wallet.turnoverAllClear')}</span>
                            </div>
                          ) : null
                        ) : (() => {
                          const pend = turnoverProgress.requirements.filter(r=>r.status==='pending')
                          const totalReq = pend.reduce((s,r)=>s+r.requiredAmount,0)
                          const totalDone = pend.reduce((s,r)=>s+r.completedAmount,0)
                          const totalPct = totalReq>0 ? Math.min(100, (totalDone/totalReq)*100) : 0
                          const cur = pend[0]?.currency ?? 'PHP'
                          const reqLabel = (req: typeof pend[number]) => req.sourceType==='deposit'?t('wallet.turnoverDeposit'):promoLabel(req.sourceRef)
                          return (
                          <div className={`bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 space-y-2.5${turnoverShake?' turnover-shake':''}`}>
                            <button type="button" className="w-full space-y-2" onClick={()=>setTurnoverExpanded(v=>!v)}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Lock size={13} className="text-amber-400 flex-shrink-0" />
                                  <span className="text-[11px] font-bold text-amber-300">{t('wallet.turnoverBlocked')}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-black text-amber-400">{Math.round(totalPct)}%</span>
                                  <ChevronDown size={14} className={`text-amber-300/70 transition-transform ${turnoverExpanded?'rotate-180':''}`} />
                                </div>
                              </div>
                              <div className="h-2 bg-amber-500/20 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-400 rounded-full transition-all" style={{width:`${totalPct}%`}} />
                              </div>
                              <div className="flex justify-between gap-2 text-[10px] font-bold text-amber-300/70">
                                <span className="truncate">{fmtTurnoverAmount(totalDone,cur)} / {fmtTurnoverAmount(totalReq,cur)}</span>
                                <span className="flex-shrink-0">{t('wallet.turnoverRemaining')} {fmtTurnoverAmount(Math.max(0,totalReq-totalDone),cur)}</span>
                              </div>
                            </button>
                            {turnoverExpanded && (
                              <div className="space-y-2 border-t border-amber-500/15 pt-2">
                                {pend.map(req=>{
                                  const pct=Math.min(100,(req.completedAmount/req.requiredAmount)*100)
                                  return (
                                    <div key={req.id} className="space-y-1">
                                      <div className="flex justify-between gap-2">
                                        <span className="min-w-0 truncate text-[10px] text-amber-300/70">{reqLabel(req)} · {fmtTurnoverAmount(req.completedAmount,req.currency??'PHP')} / {fmtTurnoverAmount(req.requiredAmount,req.currency??'PHP')}</span>
                                        <span className="flex-shrink-0 text-[10px] font-bold text-amber-300/70">{Math.round(pct)}%</span>
                                      </div>
                                      <div className="h-1 bg-amber-500/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-amber-400 rounded-full" style={{width:`${pct}%`}} />
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                          )
                        })()
                      ) : null}
                      {filteredFiatWithdraw.length > 0 && <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.fiatSection')}</p><PayMethodGrid methods={filteredFiatWithdraw} selected={selectedMethod} onSelect={onSelectWithdrawMethod} /></div>}
                      {filteredCryptoWithdraw.length > 0 && <div><p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5">{t('wallet.cryptoSection')}</p><PayMethodGrid methods={filteredCryptoWithdraw} selected={selectedMethod} onSelect={onSelectWithdrawMethod} /></div>}
                  {filteredFiatWithdraw.length === 0 && filteredCryptoWithdraw.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">{t('wallet.noWithdrawMethodsForCurrency', { currency: activeCurrency })}</p>}
                </div>
                )
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary hover:bg-muted transition-colors flex-shrink-0" onClick={resetToSelect}><ArrowLeft size={16} className="text-foreground" /></button>
                    <div className="flex items-center gap-2.5 flex-1 bg-secondary rounded-xl px-3 py-2.5">
                      {selectedPayMethod?.iconUrl ? <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"><img src={selectedPayMethod.iconUrl} alt={selectedPayMethod.name} className="w-full h-full object-cover" /></div>
                        : <div className={`w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 ${selectedPayMethod?.color??'from-muted to-muted'}`}>{selectedPayMethod?.iconKind==='telegram'?<Send size={16} className="text-white" strokeWidth={2.5}/>:<span className="text-white font-black text-sm">{selectedPayMethod?.icon}</span>}</div>}
                      <div className="flex-1"><span className="text-foreground font-black text-sm">{selectedPayMethod?.name}</span></div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">{selectedPayMethod?.tag}</span>
                    </div>
                  </div>
                  {!isMatrixWithdraw&&<p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">{t('wallet.withdrawAmount')}</p>}
                  {!isMatrixWithdraw&&<div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">{isTgWallet&&depositCurrency==='USDT'?'$':isCryptoMethod?'≈ $':'₱'}</span>
                    <input value={amount} type="number" placeholder="0.00" className="w-full bg-secondary border border-border rounded-xl pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary pl-10" onChange={(e)=>setAmount(e.target.value)} />
                  </div>}
                  {tab==='withdraw'&&isFiatWithdraw&&(fiatWithdrawMin!=null||fiatWithdrawMax!=null)&&<p className={`text-[11px] font-bold ${amount&&!fiatWithdrawAmountValid?'text-amber-400':'text-muted-foreground'}`}>{amount&&!fiatWithdrawAmountValid?t('wallet.yfpayAmountOutOfRange',{min:fiatWithdrawMin??0,max:fiatWithdrawMax??'—'}):t('wallet.withdrawAmountRange',{min:fiatWithdrawMin??0,max:fiatWithdrawMax??'—'})}</p>}
                  {tab==='withdraw'&&isFiatWithdraw&&<>
                    <input value={withdrawAccount} type="tel" readOnly={withdrawAccountLocked} placeholder={t('wallet.yfpayAccountNumber')} className={`w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary${withdrawAccountLocked ? ' opacity-60' : ''}`} onChange={withdrawAccountLocked ? undefined : (e)=>setWithdrawAccount(e.target.value)} />
                    {withdrawAccountLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
                    <input value={withdrawOwner} type="text" placeholder={t('wallet.yfpayFullName')} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setWithdrawOwner(e.target.value)} />
                  </>}
                  {withdrawMessage&&!isMatrixWithdraw&&<p className={`text-xs font-bold text-center ${withdrawSuccess?'text-emerald-400':'text-amber-400'}`}>{withdrawMessage}</p>}
                  {tab==='withdraw'&&isMatrixWithdraw&&<>
                    <input value={matrixCryptoAmount} type="number" placeholder={t('wallet.matrixCryptoAmount', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary" onChange={(e)=>setMatrixCryptoAmount(e.target.value)} />
                    {matrixWithdrawGasFee > 0 && <div className="flex flex-col gap-0.5 text-[11px] font-bold">
                      <p className="text-muted-foreground">{t('wallet.matrixWithdrawGas', { gas: matrixWithdrawGasFee, symbol: selectedPayMethod?.matrixSymbol ?? '' })}</p>
                      {matrixWithdrawGasConfig.discountThreshold !== null && matrixWithdrawGasConfig.discountFee !== null && <p className="text-muted-foreground">{t('wallet.matrixWithdrawGasDiscount', { threshold: matrixWithdrawGasConfig.discountThreshold, gas: matrixWithdrawGasConfig.discountFee, symbol: selectedPayMethod?.matrixSymbol ?? '' })}</p>}
                      <p className="text-amber-400">{t('wallet.matrixWithdrawReceive', { amount: +matrixReceiveAmount.toFixed(8), symbol: selectedPayMethod?.matrixSymbol ?? '' })}</p>
                    </div>}
                    <input value={withdrawAccount} type="text" placeholder={t('wallet.matrixWithdrawAddress', { symbol: selectedPayMethod?.matrixSymbol ?? 'TRX' })} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground font-bold text-sm focus:outline-none focus:border-primary font-mono" onChange={(e)=>setWithdrawAccount(e.target.value)} />
                    {withdrawMessage&&<p className={`text-xs font-bold text-center ${withdrawSuccess?'text-emerald-400':'text-amber-400'}`}>{withdrawMessage}</p>}
                    <button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-red-600 text-white hover:bg-red-500 shadow-red-500/20" disabled={!canSubmitMatrixWithdraw} onClick={()=>void onProceedMatrixWithdraw()}>{withdrawLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowUpFromLine size={18} />}{withdrawLoading?t('wallet.openingPay'):t('wallet.matrixWithdrawSubmit')}</button>
                  </>}
                  {tab==='withdraw'&&isFiatWithdraw&&<button type="button" className="w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20" disabled={!canSubmitWithdraw} onClick={()=>void onProceedWithdraw()}>{withdrawLoading?<Loader2 size={18} className="animate-spin"/>:<ArrowUpFromLine size={18} />}{withdrawLoading?t('wallet.openingPay'):t('wallet.yfpayWithdrawSubmit')}</button>}
                  {tab==='withdraw'&&!isFiatWithdraw&&!isMatrixWithdraw&&<div className="flex flex-col items-center gap-3 py-6 text-center"><div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center"><span className="text-2xl">🔜</span></div><p className="text-sm font-black text-foreground">{t('wallet.comingSoon')}</p><p className="text-xs text-muted-foreground">{t('wallet.cryptoWithdrawSoon')}</p></div>}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {historyLoading?<div className="py-12 flex flex-col items-center gap-2 text-muted-foreground"><Loader2 size={28} className="opacity-50 animate-spin" /></div>
                : filteredHistory.length===0?<div className="py-12 flex flex-col items-center gap-2 text-muted-foreground"><History size={32} className="opacity-30" /><span className="text-sm">{t('common.noRecords')}</span></div>
                : filteredHistory.map((tx) => {
                  const StatusIcon=statusIconComp(tx.status)
                  const isPendingDeposit = tx.type === 'deposit' && tx.status === 'pending'
                  const pendingStale = isPendingDeposit && Date.now() - new Date(tx.sortKey).getTime() >= STALE_DEPOSIT_PENDING_MS
                  return (
                    <div key={tx.id} className="bg-secondary rounded-2xl px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tx.type==='deposit'?'bg-emerald-500/15':'bg-red-500/15'}`}>{tx.type==='deposit'?<ArrowDownToLine size={16} className="text-emerald-400"/>:<ArrowUpFromLine size={16} className="text-red-400"/>}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between"><span className="text-foreground font-bold text-sm">{tx.method}</span><span className={`font-black text-sm ${tx.type==='deposit'?'text-emerald-400':'text-red-400'}`}>{tx.amount}</span></div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-muted-foreground text-xs">{tx.date}</span>
                            <span className="flex items-center gap-1">
                              <StatusIcon size={14} className={tx.status==='success'?'text-emerald-400':tx.status==='pending'?'text-yellow-400 animate-spin':tx.status==='rejected'?'text-orange-400':tx.status==='admin_rejected'?'text-rose-400':'text-red-400'} />
                              <span className={`text-[11px] font-bold capitalize ${tx.status==='success'?'text-emerald-400':tx.status==='pending'?'text-yellow-400':tx.status==='rejected'?'text-orange-400':tx.status==='admin_rejected'?'text-rose-400':'text-red-400'}`}>{t(`common.${tx.status}`)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pl-12 gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground truncate">{tx.orderId}</span>
                        <button type="button" className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg transition-colors ${copiedId===tx.id?'text-emerald-400 bg-emerald-500/10':'text-muted-foreground hover:text-foreground bg-muted/50'}`} onClick={()=>void copyOrderId(tx.id)}>
                          {copiedId===tx.id?<Check size={10}/>:<Copy size={10}/>}{copiedId===tx.id?t('common.copied'):t('common.copy')}
                        </button>
                      </div>
                      {isPendingDeposit&&<p className="pl-12 text-[10px] font-semibold leading-snug text-amber-300/85">{pendingStale?t('wallet.depositPendingStale'):t('wallet.depositProcessing')}</p>}
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        {tab !== 'history' && depositView === 'input' && tab === 'deposit' && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-border/50">
            <div className="flex items-center justify-around">
              <div className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-amber-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustSsl')}</span></div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5"><Zap size={12} className="text-emerald-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustInstant')}</span></div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1.5"><Headphones size={12} className="text-sky-400 flex-shrink-0" /><span className="text-[10px] font-bold text-muted-foreground">{t('wallet.trustSupport')}</span></div>
            </div>
          </div>
        )}
      </div>
      <KycModal open={kycOpen} onClose={handleKycClose} onApproved={handleKycApproved} />
    </>,
    document.body,
  )
}
